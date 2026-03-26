import { z } from 'zod';
import { logger } from './logger.js';

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
  // Jira (optional)
  JIRA_HOST: z.string().min(1).optional(),
  JIRA_EMAIL: z.string().email().optional(),
  JIRA_API_TOKEN: z.string().min(1).optional(),
  JIRA_PROJECT_KEY: z.string().min(1).optional(),
});

const parsed = envSchema.parse(process.env);

export interface JiraConfig {
  host: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

const jira: JiraConfig | undefined =
  parsed.JIRA_HOST && parsed.JIRA_EMAIL && parsed.JIRA_API_TOKEN && parsed.JIRA_PROJECT_KEY
    ? { host: parsed.JIRA_HOST, email: parsed.JIRA_EMAIL, apiToken: parsed.JIRA_API_TOKEN, projectKey: parsed.JIRA_PROJECT_KEY }
    : undefined;

logger.info({ jiraEnabled: !!jira }, jira ? 'Jira integration enabled' : 'Jira integration disabled (env vars not set)');

export const config = { ...parsed, jira };
