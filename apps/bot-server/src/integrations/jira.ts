import { config } from '../config.js';
import { logger } from '../logger.js';
import { buildAuthHeader, discoverIssueType, type DiscoveryResult } from './jira-discovery.js';
import { buildFields } from './jira-mapping.js';

export interface CreateJiraParams {
  title: string;
  description: string | null;
  steps: string[];
  category: string;
  severity: string;
  affectedFeature: string | null;
  screenshotUrl: string | null;
}

interface AdfNode {
  type: string;
  /** Present only on the top-level `doc` node. */
  version?: number;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  /** Inline text formatting (e.g. bold via `strong`). */
  marks?: Array<{ type: string }>;
}

function buildAdfDescription(description: string | null, steps: string[], affectedFeature: string | null): AdfNode {
  const content: AdfNode[] = [];

  if (description) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: description }],
    });
  }

  if (affectedFeature) {
    content.push(
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Affected feature: ', marks: [{ type: 'strong' }] },
          { type: 'text', text: affectedFeature },
        ],
      },
    );
  }

  if (steps.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Steps to Reproduce' }],
    });
    content.push({
      type: 'orderedList',
      content: steps.map(step => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: step }] }],
      })),
    });
  }

  // ADF requires at least one content node
  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: '(No description provided)' }] });
  }

  return { type: 'doc', version: 1, content };
}

function authHeader(): string {
  const { email, apiToken } = config.jira!;
  return buildAuthHeader(email, apiToken);
}

/**
 * Space schema discovery, resolved once and cached for the process lifetime.
 * A failure here is non-fatal: we fall back to null meta so mapping degrades gracefully.
 */
let discoveryCache: Promise<DiscoveryResult> | null = null;

function getDiscovery(): Promise<DiscoveryResult> {
  if (!config.jira) return Promise.resolve({ meta: null, availableTypes: [] });
  if (!discoveryCache) {
    const jira = config.jira;
    discoveryCache = discoverIssueType(
      { host: jira.host, auth: authHeader(), projectKey: jira.projectKey, apiVersion: jira.apiVersion },
      jira.issueType,
    )
      .then((result) => {
        if (!result.meta) {
          logger.warn(
            { issueType: jira.issueType, availableTypes: result.availableTypes, stage: 'jira' },
            'Configured JIRA_ISSUE_TYPE not found in space; will send by name and let Jira validate',
          );
        }
        return result;
      })
      .catch((error) => {
        logger.warn(
          { error: error instanceof Error ? error.message : error, stage: 'jira' },
          'Jira schema discovery failed; proceeding without adaptive mapping',
        );
        return { meta: null, availableTypes: [] } as DiscoveryResult;
      });
  }
  return discoveryCache;
}

/** Parse a failed Jira response into the structured `errors`/`errorMessages` when possible. */
async function parseJiraError(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

async function attachScreenshot(issueKey: string, screenshotUrl: string): Promise<void> {
  const { host, apiVersion } = config.jira!;

  // Download from Supabase public URL
  const imageResponse = await fetch(screenshotUrl);
  if (!imageResponse.ok) {
    logger.warn({ status: imageResponse.status, issueKey, stage: 'jira-attachment' }, 'Failed to download screenshot for Jira attachment');
    return;
  }

  const blob = await imageResponse.blob();
  const formData = new FormData();
  formData.append('file', blob, 'screenshot.png');

  const response = await fetch(`https://${host}/rest/api/${apiVersion}/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'X-Atlassian-Token': 'no-check',
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.warn({ status: response.status, body: text, issueKey, stage: 'jira-attachment' }, 'Failed to attach screenshot to Jira issue');
  }
}

export async function createJiraIssue(params: CreateJiraParams): Promise<string | null> {
  if (!config.jira) return null;

  try {
    const jira = config.jira;
    const { meta } = await getDiscovery();

    const descriptionAdf = buildAdfDescription(params.description, params.steps, params.affectedFeature);
    const { fields, notes } = buildFields(
      { summary: params.title, descriptionAdf, category: params.category, severity: params.severity },
      jira,
      meta,
    );

    if (notes.length > 0) {
      logger.debug({ notes, stage: 'jira' }, 'Jira field mapping notes');
    }

    if (jira.dryRun) {
      logger.info({ fields, stage: 'jira', dryRun: true }, 'Jira dry-run: issue NOT created (JIRA_DRY_RUN=true)');
      return null;
    }

    const response = await fetch(`https://${jira.host}/rest/api/${jira.apiVersion}/issue`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });

    if (!response.ok) {
      const jiraError = await parseJiraError(response);
      logger.warn({ status: response.status, jiraError, stage: 'jira' }, 'Jira issue creation failed');
      return null;
    }

    const data = (await response.json()) as { key: string };
    logger.info({ jiraKey: data.key, stage: 'jira' }, 'Jira issue created');

    // Attach screenshot (non-fatal)
    if (params.screenshotUrl) {
      try {
        await attachScreenshot(data.key, params.screenshotUrl);
      } catch (error) {
        logger.warn({ error: error instanceof Error ? error.message : error, jiraKey: data.key, stage: 'jira-attachment' }, 'Failed to attach screenshot');
      }
    }

    return data.key;
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : error, stage: 'jira' }, 'Jira integration failed');
    return null;
  }
}
