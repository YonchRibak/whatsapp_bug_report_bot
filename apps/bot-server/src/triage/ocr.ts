import vision from '@google-cloud/vision';
import { config } from '../config.js';
import { logger } from '../logger.js';

let client: vision.ImageAnnotatorClient | null = null;

function getClient(): vision.ImageAnnotatorClient {
  if (!client) {
    const credentialsJson = Buffer.from(config.GOOGLE_CLOUD_CREDENTIALS_JSON, 'base64').toString('utf-8');
    const credentials = JSON.parse(credentialsJson);
    client = new vision.ImageAnnotatorClient({ credentials });
  }
  return client;
}

export async function extractText(base64Image: string): Promise<string> {
  try {
    const visionClient = getClient();
    const [result] = await visionClient.textDetection({
      image: { content: base64Image },
    });
    return result.textAnnotations?.[0]?.description ?? '';
  } catch (error) {
    logger.warn({ error, stage: 'ocr' }, 'OCR extraction failed, continuing without OCR text');
    return '';
  }
}
