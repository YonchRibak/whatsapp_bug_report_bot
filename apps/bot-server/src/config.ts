import { z } from 'zod';
import { logger } from './logger.js';
import { DEFAULT_PRIORITY_MAP } from './integrations/jira-mapping.js';

/** Treat a blank env value as "unset" so a defaulted field falls back instead of failing validation. */
function optionalWithDefault<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> {
  return z.preprocess((v) => (v === '' ? undefined : v), schema);
}

const envSchema = z.object({
  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE_NAME: z.string().min(1),
  TARGET_GROUP_JID: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  GOOGLE_CLOUD_CREDENTIALS_JSON: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().default('screenshots'),
  PORT: z.coerce.number().default(3000),
  WEBHOOK_SECRET: z.string().min(1),
  // Jira connection (optional — all four required to enable Jira)
  JIRA_HOST: z.string().min(1).optional(),
  JIRA_EMAIL: z.string().email().optional(),
  JIRA_API_TOKEN: z.string().min(1).optional(),
  JIRA_PROJECT_KEY: z.string().min(1).optional(),
  // Jira mapping (optional — sensible defaults, override to match your space)
  JIRA_ISSUE_TYPE: optionalWithDefault(z.string().min(1).default('Bug')),
  JIRA_PRIORITY_MODE: optionalWithDefault(z.enum(['auto', 'on', 'off']).default('auto')),
  JIRA_PRIORITY_MAP: z.string().optional(),
  JIRA_CATEGORY_TARGET: optionalWithDefault(z.string().min(1).default('labels')),
  JIRA_LABEL_PREFIX: z.string().default(''),
  JIRA_EXTRA_FIELDS: z.string().optional(),
  JIRA_API_VERSION: optionalWithDefault(z.string().min(1).default('3')),
  JIRA_DRY_RUN: optionalWithDefault(
    z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  ),
});

const parsed = envSchema.parse(process.env);

/** Parse a JSON-object env var, merging over a fallback. Malformed JSON logs a warning and keeps the fallback. */
function parseJsonObjectEnv<T extends Record<string, unknown>>(raw: string | undefined, fallback: T, name: string): T {
  if (!raw) return fallback;
  try {
    const parsedValue = JSON.parse(raw);
    if (typeof parsedValue !== 'object' || parsedValue === null || Array.isArray(parsedValue)) {
      logger.warn({ envVar: name }, `${name} is not a JSON object; ignoring and using defaults`);
      return fallback;
    }
    return { ...fallback, ...parsedValue };
  } catch {
    logger.warn({ envVar: name }, `${name} is not valid JSON; ignoring and using defaults`);
    return fallback;
  }
}

export interface JiraConfig {
  host: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
  /** 'auto' = include priority only if the space supports it; 'on' = always send; 'off' = never send. */
  priorityMode: 'auto' | 'on' | 'off';
  /** Maps triage severity -> Jira priority name. */
  priorityMap: Record<string, string>;
  /** Where the triage category goes: 'labels' | 'components' | 'none' | a 'customfield_xxxxx' id. */
  categoryTarget: string;
  labelPrefix: string;
  /** Arbitrary extra fields merged into every created issue (e.g. required custom fields). */
  extraFields: Record<string, unknown>;
  apiVersion: string;
  /** When true, log the would-be payload instead of creating an issue. */
  dryRun: boolean;
}

const jiraConnected =
  parsed.JIRA_HOST && parsed.JIRA_EMAIL && parsed.JIRA_API_TOKEN && parsed.JIRA_PROJECT_KEY;

const jira: JiraConfig | undefined = jiraConnected
  ? {
      host: parsed.JIRA_HOST!,
      email: parsed.JIRA_EMAIL!,
      apiToken: parsed.JIRA_API_TOKEN!,
      projectKey: parsed.JIRA_PROJECT_KEY!,
      issueType: parsed.JIRA_ISSUE_TYPE,
      priorityMode: parsed.JIRA_PRIORITY_MODE,
      priorityMap: parseJsonObjectEnv(parsed.JIRA_PRIORITY_MAP, DEFAULT_PRIORITY_MAP, 'JIRA_PRIORITY_MAP'),
      categoryTarget: parsed.JIRA_CATEGORY_TARGET,
      labelPrefix: parsed.JIRA_LABEL_PREFIX,
      extraFields: parseJsonObjectEnv(parsed.JIRA_EXTRA_FIELDS, {}, 'JIRA_EXTRA_FIELDS'),
      apiVersion: parsed.JIRA_API_VERSION,
      dryRun: parsed.JIRA_DRY_RUN,
    }
  : undefined;

logger.info(
  { jiraEnabled: !!jira, jiraDryRun: jira?.dryRun ?? false },
  jira ? 'Jira integration enabled' : 'Jira integration disabled (connection env vars not set)',
);

export const config = { ...parsed, jira };
