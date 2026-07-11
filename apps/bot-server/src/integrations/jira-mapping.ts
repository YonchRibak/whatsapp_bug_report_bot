/**
 * Adaptive Jira field mapping. Turns a triage result + the bot's Jira config +
 * (optionally) discovered space schema into the `fields` object for issue creation.
 *
 * The goal: send only fields the target space actually accepts, so the same bot
 * works against a bare team-managed space or a fully-configured company-managed one.
 */

import type { JiraConfig } from '../config.js';
import type { IssueTypeMeta } from './jira-discovery.js';

/** Default triage-severity -> Jira-priority-name mapping (matches Jira's global priorities). */
export const DEFAULT_PRIORITY_MAP: Record<string, string> = {
  critical: 'Highest',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export interface FieldMappingInput {
  summary: string;
  /** Pre-built Atlassian Document Format description node. */
  descriptionAdf: unknown;
  category: string;
  severity: string;
}

export interface FieldMappingResult {
  fields: Record<string, unknown>;
  /** Human-readable notes about decisions/omissions, surfaced in logs and the doctor. */
  notes: string[];
}

/** Jira labels cannot contain whitespace. */
function sanitizeLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, '-');
}

/** Case-insensitively snap a desired priority name to one the space actually allows. */
function snapPriority(desired: string, allowed: string[]): string | null {
  const hit = allowed.find((a) => a.toLowerCase() === desired.toLowerCase());
  return hit ?? null;
}

function resolvePriority(input: FieldMappingInput, config: JiraConfig, meta: IssueTypeMeta | null, notes: string[]): { name: string } | null {
  if (config.priorityMode === 'off') return null;

  const desired = config.priorityMap[input.severity] ?? config.priorityMap[input.severity.toLowerCase()];
  if (!desired) {
    notes.push(`No priority mapping for severity "${input.severity}"; priority omitted`);
    return null;
  }

  if (config.priorityMode === 'on') {
    return { name: desired };
  }

  // priorityMode === 'auto': include only when we know the space supports it.
  if (!meta) {
    notes.push('Space schema unknown; priority omitted (set JIRA_PRIORITY_MODE=on to force)');
    return null;
  }
  if (!meta.hasPriority) {
    notes.push('Space has no Priority field on this issue type; priority omitted');
    return null;
  }
  if (meta.priorityAllowedValues.length === 0) {
    // Field exists but createmeta exposed no allowed values — send the mapped name and let Jira decide.
    return { name: desired };
  }
  const snapped = snapPriority(desired, meta.priorityAllowedValues);
  if (!snapped) {
    notes.push(
      `Priority "${desired}" not in allowed values [${meta.priorityAllowedValues.join(', ')}]; priority omitted`,
    );
    return null;
  }
  return { name: snapped };
}

function applyCategory(fields: Record<string, unknown>, input: FieldMappingInput, config: JiraConfig, meta: IssueTypeMeta | null, notes: string[]): void {
  const target = config.categoryTarget;
  const value = config.labelPrefix + input.category;

  if (target === 'none') return;

  if (target === 'labels') {
    if (meta && !meta.hasLabels) {
      notes.push('Space has no Labels field on this issue type; category omitted');
      return;
    }
    fields.labels = [sanitizeLabel(value)];
    return;
  }

  if (target === 'components') {
    if (meta && !meta.hasComponents) {
      notes.push('Space has no Components field on this issue type; category omitted');
      return;
    }
    fields.components = [{ name: input.category }];
    return;
  }

  if (target.startsWith('customfield_')) {
    fields[target] = value;
    return;
  }

  notes.push(`Unrecognized JIRA_CATEGORY_TARGET "${target}"; category omitted`);
}

export function buildFields(input: FieldMappingInput, config: JiraConfig, meta: IssueTypeMeta | null): FieldMappingResult {
  const notes: string[] = [];

  const fields: Record<string, unknown> = {
    project: { key: config.projectKey },
    // Prefer the discovered id (unambiguous); fall back to the configured name.
    issuetype: meta ? { id: meta.id } : { name: config.issueType },
    summary: input.summary,
    description: input.descriptionAdf,
  };

  const priority = resolvePriority(input, config, meta, notes);
  if (priority) fields.priority = priority;

  applyCategory(fields, input, config, meta, notes);

  // Extra fields win last so operators can force required custom fields.
  Object.assign(fields, config.extraFields);

  return { fields, notes };
}
