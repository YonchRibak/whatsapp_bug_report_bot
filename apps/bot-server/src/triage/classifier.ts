import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { triageResultSchema, type TriageResult } from './schema.js';
import { logger } from '../logger.js';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `אתה מערכת סיווג באגים לאפליקציה בשלב טסטינג.
תפקידך לנתח הודעות WhatsApp מקבוצת טסטרים ולחלץ מהן מידע מובנה.

הודעות עשויות להיות בעברית, אנגלית, או תערובת.
סלנג, מילות קישור, ואמוג'ים הם חלק מההקשר — אל תתעלם מהם.

כללי סיווג:
- bug: אפליקציה נקרסת, לא מגיבה, מייצרת תוצאה שגויה
- ux_issue: מסך מבלבל, כפתור לא נגיש, זרימה לא אינטואיטיבית
- feature_request: "כדאי להוסיף...", "חסר לי..."
- question: שאלה על איך לעשות משהו באפליקציה
- other: הכל השאר (תגובות רגשיות, חוסר רלוונטיות)

לבאגים: חלץ צעדים לשחזור אם קיימים בהודעה.
severity: critical = קריסה/חסימה מוחלטת, high = תקלה משמעותית, medium = הפרעה, low = קוסמטי.
confidence: כמה בטוח אתה בסיווג (0-1).`;

const TRIAGE_TOOL: Anthropic.Messages.Tool = {
  name: 'create_issue',
  description: 'Extract and classify a bug report or feedback from a WhatsApp message',
  input_schema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        enum: ['bug', 'ux_issue', 'feature_request', 'question', 'other'],
      },
      title: { type: 'string', description: 'Concise title, preserve original language' },
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      description: { type: 'string' },
      steps_to_reproduce: { type: 'array', items: { type: 'string' } },
      affected_feature: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['category', 'title', 'severity', 'confidence'],
  },
};

export async function triageMessage(
  text: string,
  screenshotBase64?: string,
  mimeType?: string,
): Promise<TriageResult> {
  const content: Anthropic.Messages.ContentBlockParam[] = [];

  if (screenshotBase64) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: (mimeType ?? 'image/png') as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data: screenshotBase64,
      },
    });
  }

  content.push({ type: 'text', text: text || '(image only — no text caption)' });

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [TRIAGE_TOOL],
    tool_choice: { type: 'tool', name: 'create_issue' },
    messages: [{ role: 'user', content }],
  });

  const toolBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
  );

  if (!toolBlock) {
    throw new Error('Claude did not return a tool_use block');
  }

  const result = triageResultSchema.parse(toolBlock.input);

  if (result.confidence < 0.6) {
    logger.warn({ messageText: text.slice(0, 100), confidence: result.confidence }, 'Low confidence triage');
  }

  return result;
}
