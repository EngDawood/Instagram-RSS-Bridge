import type { Context } from 'hono';
import { webhookCallback } from 'grammy';
import { createBot } from '../services/telegram-bot';

type HonoEnv = { Bindings: Env };

export async function handleTelegramWebhook(c: Context<HonoEnv>): Promise<Response> {
	// Verify webhook secret (TELEGRAM_WEBHOOK_SECRET set via wrangler secret put)
	const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
	const expectedSecret = (c.env as unknown as Record<string, string>)['TELEGRAM_WEBHOOK_SECRET'];
	if (expectedSecret && secret !== expectedSecret) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const bot = createBot(c.env);
	const handler = webhookCallback(bot, 'cloudflare-mod');

	return handler(c.req.raw);
}
