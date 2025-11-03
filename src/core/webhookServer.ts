import express, { Request, Response } from 'express';
import { configManager } from './configManager';
import logger from './logger';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change_me_in_production';
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3001', 10);

/**
 * Webhook Server
 * Listens for config update notifications from dashboard
 */
export class WebhookServer {
  private app: express.Application;
  private server: any;

  constructor() {
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  /**
   * Setup webhook routes
   */
  private setupRoutes(): void {
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });

    this.app.post('/api/config-updated', async (req: Request, res: Response): Promise<void> => {
      try {
        const { guildId, secret } = req.body;

        if (!guildId) {
          res.status(400).json({ error: 'Missing guildId' });
          return;
        }

        if (secret !== WEBHOOK_SECRET) {
          logger.warn(`Unauthorized config update attempt for guild ${guildId}`);
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

        logger.info(`Received config update webhook for guild ${guildId}`);

        // Validate this is the correct guild (single-guild optimization)
        const cachedGuildId = configManager.getCachedGuildId();
        if (cachedGuildId && cachedGuildId !== guildId) {
          logger.warn(
            `Webhook received config update for guild ${guildId} but bot is configured for guild ${cachedGuildId}. Rejecting.`
          );
          res.status(400).json({
            error: `Invalid guildId. This bot is configured for guild ${cachedGuildId}`,
          });
          return;
        }

        await configManager.reloadConfig(guildId);

        const newConfig = configManager.getConfig(guildId);
        logger.info(`Config reloaded successfully (version ${newConfig.version})`);

        res.json({
          success: true,
          version: newConfig.version,
          reloadedAt: new Date().toISOString(),
        });
      } catch (error) {
        logger.error('Error processing config update webhook:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });
  }

  /**
   * Start the webhook server
   */
  start(): void {
    this.server = this.app.listen(WEBHOOK_PORT, () => {
      logger.info(`Webhook server listening on port ${WEBHOOK_PORT}`);
      logger.info(`Health check available at: http://localhost:${WEBHOOK_PORT}/health`);
      logger.info(`Config webhook endpoint: http://localhost:${WEBHOOK_PORT}/api/config-updated`);
    });

    this.server.on('error', (error: Error) => {
      logger.error('Webhook server error:', error);
    });
  }

  /**
   * Stop the webhook server
   */
  stop(): void {
    if (this.server) {
      this.server.close(() => {
        logger.info('Webhook server stopped');
      });
    }
  }
}

export const webhookServer = new WebhookServer();
