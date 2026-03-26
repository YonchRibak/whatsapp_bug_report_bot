import express from 'express';
import { config } from './config.js';
import { logger } from './logger.js';
import { webhookRouter } from './webhook/handler.js';

const app = express();

// Raw body for HMAC verification — must be before any JSON parsing middleware
app.use('/webhook', express.raw({ type: '*/*', limit: '10mb' }));

// JSON for other routes
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook handler
app.use(webhookRouter);

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'Bot server started');
});
