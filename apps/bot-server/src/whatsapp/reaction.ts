import { config } from '../config.js';
import { logger } from '../logger.js';

const REACTION_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendReaction(remoteJid: string, messageId: string): Promise<void> {
  try {
    await delay(REACTION_DELAY_MS);

    const url = `${config.EVOLUTION_API_URL}/message/sendReaction/${config.EVOLUTION_INSTANCE_NAME}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        key: {
          remoteJid,
          fromMe: false,
          id: messageId,
        },
        reaction: '\uD83E\uDD16',
      }),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, messageId, stage: 'reaction' },
        'Reaction send returned non-OK status',
      );
    } else {
      logger.info({ messageId }, 'Reaction sent successfully');
    }
  } catch (error) {
    logger.warn({ error, messageId, stage: 'reaction' }, 'Failed to send reaction');
  }
}
