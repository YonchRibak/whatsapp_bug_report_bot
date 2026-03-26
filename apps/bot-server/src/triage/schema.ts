import { z } from 'zod';

export const triageResultSchema = z.object({
  category: z.enum(['bug', 'ux_issue', 'feature_request', 'question', 'other']),
  title: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  description: z.string().optional(),
  steps_to_reproduce: z.array(z.string()).optional(),
  affected_feature: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export type TriageResult = z.infer<typeof triageResultSchema>;
