import type { Context } from 'hono';
import { createBot } from '../services/telegram-bot';

type HonoEnv = { Bindings: Env };

export async function handleTelegramWebhook(c: Context<HonoEnv>): Promise<Response> {
	// Verify webhook secret (TELEGRAM_WEBHOOK_SECRET set via wrangler secret put)
	const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
	const expectedSecret = (c.env as unknown as Record<string, string>)['TELEGRAM_WEBHOOK_SECRET'];
	if (expectedSecret && secret !== expectedSecret) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	try {
		const update = await c.req.json();
		console.log('[Webhook] Received update:', JSON.stringify(update).substring(0, 200));

		const bot = createBot(c.env);
		console.log('[Webhook] Bot created');

		// Initialize bot (required when calling handleUpdate directly)
		await bot.init();
		console.log('[Webhook] Bot initialized');

		// Process update directly, bypassing grammY adapters
		await bot.handleUpdate(update);
		console.log('[Webhook] Update processed');

		return c.json({ ok: true });
	} catch (error) {
		console.error('[Webhook] Error processing update:', error);
		return c.json({ ok: false, error: String(error) }, 500);
	}
}
