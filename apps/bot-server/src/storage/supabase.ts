import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { TriageResult } from '../triage/schema.js';

export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

export interface InsertIssueParams {
  waMessageId: string;
  senderJid: string;
  senderName: string | null;
  rawText: string | null;
  screenshotUrl: string | null;
  triage: TriageResult;
}

export async function messageExists(waMessageId: string): Promise<boolean> {
  const { count } = await supabase
    .from('issues')
    .select('*', { count: 'exact', head: true })
    .eq('wa_message_id', waMessageId);

  return (count ?? 0) > 0;
}

export async function insertIssue(params: InsertIssueParams): Promise<void> {
  const { error } = await supabase.from('issues').insert({
    wa_message_id: params.waMessageId,
    sender_jid: params.senderJid,
    sender_name: params.senderName,
    raw_text: params.rawText,
    screenshot_url: params.screenshotUrl,
    category: params.triage.category,
    title: params.triage.title,
    severity: params.triage.severity,
    description: params.triage.description ?? null,
    steps: params.triage.steps_to_reproduce ?? [],
    affected_feature: params.triage.affected_feature ?? null,
    confidence: params.triage.confidence,
  });

  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }
}
