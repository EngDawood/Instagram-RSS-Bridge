import type { Bot } from 'grammy';
import { getAdminState } from '../storage/admin-state';
import { addChannelDirect } from './add-channel-flow';
import { handleAddSourceValue, handleRemoveChannelConfirm } from './add-source-flow';

/**
 * Register the main text handler to process multi-step admin flows.
 */
export function registerTextInputHandler(bot: Bot, env: Env, kv: KVNamespace): void {
	const adminId = parseInt(env.ADMIN_TELEGRAM_ID, 10);

	bot.on('message:text', async (ctx) => {
		const text = ctx.message.text;
		if (text.startsWith('/')) return;

		const state = await getAdminState(kv, adminId);
		if (!state) {
			await ctx.reply('No active action. Use /start to see commands.');
			return;
		}

		switch (state.action) {
			case 'adding_channel':
				await addChannelDirect(ctx, bot, kv, adminId, text.trim());
				break;
			case 'adding_source':
				await handleAddSourceValue(ctx, bot, kv, adminId, state, text, env);
				break;
			case 'removing_channel':
				await handleRemoveChannelConfirm(ctx, kv, adminId, state, text);
				break;
		}
	});
}
