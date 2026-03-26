import { createHmac } from 'node:crypto';
import { type Router as RouterType, Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { messageExists, insertIssue, updateJiraKey } from '../storage/supabase.js';
import { createJiraIssue } from '../integrations/jira.js';
import { uploadScreenshot } from '../storage/upload.js';
import { extractText } from '../triage/ocr.js';
import { triageMessage } from '../triage/classifier.js';
import { sendReaction } from '../whatsapp/reaction.js';

export const webhookRouter: RouterType = Router();

interface MessageKey {
  remoteJid: string;
  fromMe: boolean;
  id: string;
  participant?: string;
}

interface WebhookPayload {
  event: string;
  data: {
    key: MessageKey;
    pushName?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
      imageMessage?: {
        caption?: string;
        mimetype?: string;
      };
    };
  };
}

function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const hmac = createHmac('sha256', config.WEBHOOK_SECRET);
  hmac.update(rawBody);
  const expected = hmac.digest('hex');
  return signature === expected;
}

async function downloadMedia(rawMessage: unknown): Promise<{ base64: string; mimeType: string }> {
  const url = `${config.EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${config.EVOLUTION_INSTANCE_NAME}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.EVOLUTION_API_KEY,
    },
    body: JSON.stringify(rawMessage),
  });

  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status}`);
  }

  const data = (await response.json()) as { base64: string; mimetype: string };
  return { base64: data.base64, mimeType: data.mimetype };
}

interface ProcessPayload {
  messageId: string;
  remoteJid: string;
  senderJid: string;
  senderName: string | null;
  textContent: string | null;
  hasMedia: boolean;
  rawMessage: unknown;
}

async function processMessage(payload: ProcessPayload): Promise<void> {
  const startTime = Date.now();

  try {
    // Idempotency check
    if (await messageExists(payload.messageId)) {
      logger.debug({ messageId: payload.messageId }, 'Duplicate message, skipping');
      return;
    }

    let combinedText = payload.textContent ?? '';
    let screenshotBase64: string | undefined;
    let screenshotMimeType: string | undefined;
    let screenshotUrl: string | null = null;

    // Handle media
    if (payload.hasMedia) {
      try {
        const media = await downloadMedia(payload.rawMessage);
        screenshotBase64 = media.base64;
        screenshotMimeType = media.mimeType;

        // Upload to Supabase Storage
        screenshotUrl = await uploadScreenshot(media.base64, media.mimeType);

        // OCR extraction (non-fatal)
        const ocrText = await extractText(media.base64);
        if (ocrText) {
          combinedText = combinedText ? `${combinedText}\n\n[OCR]: ${ocrText}` : ocrText;
        }
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : error, messageId: payload.messageId, stage: 'media' }, 'Media processing failed');
        // If media processing fails entirely but we have text, continue with text only
        if (!combinedText) return;
      }
    }

    // Triage via Claude
    const triage = await triageMessage(combinedText, screenshotBase64, screenshotMimeType);

    // Insert into Supabase
    await insertIssue({
      waMessageId: payload.messageId,
      senderJid: payload.senderJid,
      senderName: payload.senderName,
      rawText: payload.textContent,
      screenshotUrl,
      triage,
    });

    // Jira integration (non-fatal)
    try {
      const jiraKey = await createJiraIssue({
        title: triage.title,
        description: triage.description ?? null,
        steps: triage.steps_to_reproduce ?? [],
        category: triage.category,
        severity: triage.severity,
        affectedFeature: triage.affected_feature ?? null,
        screenshotUrl,
      });
      if (jiraKey) {
        await updateJiraKey(payload.messageId, jiraKey);
      }
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : error, messageId: payload.messageId, stage: 'jira' }, 'Jira integration failed');
    }

    // Send reaction
    await sendReaction(payload.remoteJid, payload.messageId);

    const durationMs = Date.now() - startTime;
    logger.info({
      messageId: payload.messageId,
      senderJid: payload.senderJid,
      category: triage.category,
      severity: triage.severity,
      confidence: triage.confidence,
      durationMs,
    }, 'Message processed successfully');
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : error, messageId: payload.messageId, stage: 'pipeline' }, 'Pipeline error');
  }
}

webhookRouter.post('/webhook', (req: Request, res: Response) => {
  // Verify HMAC signature (skip if Evolution API doesn't send one)
  const signature = req.headers['x-webhook-signature'] as string | undefined;
  if (signature && !verifySignature(req.body as Buffer, signature)) {
    logger.warn('Invalid webhook signature');
    res.sendStatus(200);
    return;
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse((req.body as Buffer).toString('utf-8')) as WebhookPayload;
  } catch {
    res.sendStatus(200);
    return;
  }

  // Only handle MESSAGES_UPSERT events
  if (payload.event !== 'messages.upsert') {
    res.sendStatus(200);
    return;
  }

  const data = payload.data;

  // Only process messages from the target group
  if (data.key.remoteJid !== config.TARGET_GROUP_JID) {
    res.sendStatus(200);
    return;
  }

  // Ignore our own messages that have no useful content (e.g. reactions)
  if (data.key.fromMe && !data.message?.conversation && !data.message?.extendedTextMessage?.text && !data.message?.imageMessage) {
    res.sendStatus(200);
    return;
  }

  const textContent =
    data.message?.conversation ??
    data.message?.extendedTextMessage?.text ??
    data.message?.imageMessage?.caption ??
    null;

  const hasMedia = !!data.message?.imageMessage;

  // Ignore messages with no text and no media
  if (!textContent && !hasMedia) {
    res.sendStatus(200);
    return;
  }

  // Fire-and-forget async processing
  processMessage({
    messageId: data.key.id,
    remoteJid: data.key.remoteJid,
    senderJid: data.key.participant ?? data.key.remoteJid,
    senderName: data.pushName ?? null,
    textContent,
    hasMedia,
    rawMessage: data,
  }).catch(error => {
    logger.error({ error, messageId: data.key.id }, 'Unhandled pipeline error');
  });

  // Return 200 immediately
  res.sendStatus(200);
});
