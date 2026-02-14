import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import type { SourceType } from '../../../types/telegram';
import type { FeedMediaFilter } from '../../../types/feed';
import { getChannelConfig, saveChannelConfig } from '../storage/kv-operations';
import { setAdminState } from '../storage/admin-state';
import { showSourceDetail } from '../views/source-views';
import { showChannelConfig } from '../views/channel-views';
import { editOrReply } from '../helpers/edit-or-reply';

/**
 * Register callback query handlers for subscription source management.
 */
export function registerSourceCallbacks(bot: Bot, env: Env, kv: KVNamespace): void {
	const adminId = parseInt(env.ADMIN_TELEGRAM_ID, 10);

	// Add source → source type selection
	bot.callbackQuery(/^add_src:([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const keyboard = new InlineKeyboard()
			.text('👤 Instagram User', `src_type:${channelId}:instagram_user`)
			.row()
			.text('#️⃣ Instagram Tag', `src_type:${channelId}:instagram_tag`)
			.row()
			.text('🌐 RSS/Atom URL', `src_type:${channelId}:rss_url`)
			.row()
			.text('« Back', `ch:${channelId}`);

		await editOrReply(ctx, '<b>Select source type:</b>', { parse_mode: 'HTML', reply_markup: keyboard });
		await ctx.answerCallbackQuery();
	});

	// Source type selected → ask for value
	bot.callbackQuery(/^src_type:([^:]+):([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const sourceType = ctx.match[2] as SourceType;
		await setAdminState(kv, adminId, {
			action: 'adding_source',
			context: { channelId, sourceType },
		});

		const prompts: Record<string, string> = {
			instagram_user: '👤 Send the Instagram <b>username</b> (without @):',
			instagram_tag: '#️⃣ Send the <b>hashtag</b> (without #):',
			rss_url: '🌐 Send the <b>RSS/Atom feed URL</b>:',
		};
		await editOrReply(ctx, (prompts[sourceType] || 'Send the value:') + '\n\nUse /cancel to abort.', { parse_mode: 'HTML' });
		await ctx.answerCallbackQuery();
	});

	// Source detail view
	bot.callbackQuery(/^src_detail:([^:]+):([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const sourceId = ctx.match[2];
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }

		const source = config.sources.find((s) => s.id === sourceId);
		if (!source) { await ctx.answerCallbackQuery({ text: 'Source not found' }); return; }

		await showSourceDetail(ctx, channelId, source);
		await ctx.answerCallbackQuery();
	});

	// Toggle source enabled/disabled
	bot.callbackQuery(/^src_toggle:([^:]+):([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const sourceId = ctx.match[2];
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }

		const source = config.sources.find((s) => s.id === sourceId);
		if (!source) { await ctx.answerCallbackQuery({ text: 'Source not found' }); return; }

		source.enabled = !source.enabled;
		await saveChannelConfig(kv, channelId, config);
		await showSourceDetail(ctx, channelId, source);
		await ctx.answerCallbackQuery({ text: source.enabled ? '✅ Enabled' : '❌ Disabled' });
	});

	// Remove source
	bot.callbackQuery(/^src_remove:([^:]+):([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const sourceId = ctx.match[2];
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }

		config.sources = config.sources.filter((s) => s.id !== sourceId);
		await saveChannelConfig(kv, channelId, config);
		await showChannelConfig(ctx, kv, channelId);
		await ctx.answerCallbackQuery({ text: 'Source removed' });
	});

	// Set source media filter
	bot.callbackQuery(/^src_filter:([^:]+):([^:]+):([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const sourceId = ctx.match[2];
		const mediaFilter = ctx.match[3] as FeedMediaFilter;
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }

		const source = config.sources.find((s) => s.id === sourceId);
		if (!source) { await ctx.answerCallbackQuery({ text: 'Source not found' }); return; }

		source.mediaFilter = mediaFilter;
		await saveChannelConfig(kv, channelId, config);
		await showSourceDetail(ctx, channelId, source);
		await ctx.answerCallbackQuery({ text: `Filter: ${mediaFilter}` });
	});
}
