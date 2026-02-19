import { Bot } from 'grammy';
import { registerInfoCommands } from './commands/info-commands';
import { registerChannelCommands } from './commands/channel-commands';
import { registerSubscriptionCommands } from './commands/subscription-commands';
import { registerFormatCommands } from './commands/format-commands';
import { registerDiagnosticCommands } from './commands/diagnostic-commands';
import { registerTextInputHandler } from './handlers/text-input-handler';
import { registerChannelCallbacks } from './callbacks/channel-callbacks';
import { registerSourceCallbacks } from './callbacks/source-callbacks';
import { registerFormatCallbacks } from './callbacks/format-callbacks';
import { registerDownloadCallbacks } from './callbacks/download-callbacks';

/**
 * Create and configure Telegram bot instance with all handlers.
 * @param env - Cloudflare Workers environment with secrets and bindings
 * @returns Configured grammY Bot instance
 */
export function createBot(env: Env): Bot {
	const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
	const adminId = parseInt(env.ADMIN_TELEGRAM_ID, 10);
	const kv = env.CACHE;

	// Global error handler
	bot.catch(async (err) => {
		console.error('Bot error:', err);
		const ctx = err.ctx;
		if (ctx.callbackQuery) {
			try {
				await ctx.answerCallbackQuery({ text: '⚠️ Error occurred. Please try again.' });
			} catch (e) {
				console.error('Failed to send error callback notification:', e);
			}
		} else {
			try {
				await ctx.reply('⚠️ An unexpected error occurred. Please try again.');
			} catch (e) {
				console.error('Failed to send error reply:', e);
			}
		}
	});

	// Debug logging for all incoming updates (middleware)
	bot.use(async (ctx, next) => {
		if (ctx.callbackQuery) {
			console.log('[DEBUG] Incoming Callback:', ctx.callbackQuery.data, '| from:', ctx.from?.id, '| adminId:', adminId);
		}
		await next();
	});

	// Admin authentication middleware
	bot.use(async (ctx, next) => {
		if (isNaN(adminId)) {
			console.warn('[WARN] ADMIN_TELEGRAM_ID not configured — auth check skipped');
			await next();
			return;
		}
		if (ctx.from?.id !== adminId) {
			console.log('[AUTH] Blocked user:', ctx.from?.id);
			if (ctx.callbackQuery) {
				await ctx.answerCallbackQuery({ text: 'Unauthorized' });
			}
			return;
		}
		await next();
	});

	// Register all command handlers (PRESERVE ORIGINAL ORDER)
	registerInfoCommands(bot, env, kv);          // /start, /help, /cancel
	registerChannelCommands(bot, env, kv);       // /add, /channels, /status, /enable, /disable
	registerSubscriptionCommands(bot, env, kv);  // /sub, /unsub, /delay, /seed, /list
	registerFormatCommands(bot, env, kv);        // /set_default, /set
	registerDiagnosticCommands(bot, env, kv);    // /test, /debug

	// Register text input handler (multi-step flows)
	registerTextInputHandler(bot, env, kv);

	// Register all callback query handlers (PRESERVE ORIGINAL ORDER)
	bot.on('callback_query:data', async (ctx, next) => {
		console.log('[DEBUG] Received callback:', ctx.callbackQuery.data);
		await next();
	});

	registerChannelCallbacks(bot, env, kv);      // ch:*, ch_toggle:*, ch_remove:*, set_interval:*, interval:*, back:channels
	registerSourceCallbacks(bot, env, kv);       // add_src:*, src_type:*, src_detail:*, src_toggle:*, src_remove:*, src_filter:*
	registerFormatCallbacks(bot, env, kv);       // fs:*, fd:*, fs_v:*, fd_v:*, fs_r:*, fd_r:*
	registerDownloadCallbacks(bot, env, kv);     // dl:video, dl:audio

	// Debug: catch unmatched callback queries
	bot.on('callback_query:data', async (ctx) => {
		console.log('[DEBUG] Unmatched callback:', ctx.callbackQuery.data);
		await ctx.answerCallbackQuery({ text: `Unknown: ${ctx.callbackQuery.data?.substring(0, 30)}` });
	});

	return bot;
}
