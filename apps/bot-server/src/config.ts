import { z } from 'zod';

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
});

export type Config = z.infer<typeof envSchema>;

export const config = envSchema.parse(process.env);
