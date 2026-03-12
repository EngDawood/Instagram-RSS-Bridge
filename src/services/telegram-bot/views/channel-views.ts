import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { getChannelsList, getChannelConfig, getFailedPosts } from '../storage/kv-operations';
import { editOrReply } from '../helpers/edit-or-reply';
import { sourceTypeIcon } from '../helpers/source-parser';
import { escapeHtml as escapeHtmlBot } from '../../../utils/text';

/**
 * Display list of all registered channels with status and source count.
 */
export async function showChannelsList(
	ctx: Context,
	kv: KVNamespace,
	mode: 'reply' | 'edit' = 'reply'
): Promise<void> {
	const channels = await getChannelsList(kv);

	if (channels.length === 0) {
		const message = "You haven't added any channels yet. Use /add @channel to get started.";
		if (mode === 'edit') {
			await editOrReply(ctx, message);
		} else {
			await ctx.reply(message);
		}
		return;
	}

	const keyboard = new InlineKeyboard();
	for (const channelId of channels) {
		const config = await getChannelConfig(kv, channelId);
		const status = config?.enabled ? '✅' : '❌';
		const label = config?.channelTitle || channelId;
		const srcCount = config?.sources.length || 0;
		keyboard.text(`${status} ${label} (${srcCount} sources)`, `ch:${channelId}`).row();
	}

	const text = '<b>Your channels:</b>\n\nSelect a channel to manage its settings.';
	const options = { parse_mode: 'HTML' as const, reply_markup: keyboard };

	if (mode === 'edit') {
		await editOrReply(ctx, text, options);
	} else {
		await ctx.reply(text, options);
	}
}

/**
 * Display configuration and sources for a specific channel.
 */
export async function showChannelConfig(
	ctx: Context,
	kv: KVNamespace,
	channelId: string
): Promise<void> {
	const config = await getChannelConfig(kv, channelId);
	if (!config) {
		await editOrReply(ctx, `Channel <code>${channelId}</code> not found.`, { parse_mode: 'HTML' });
		return;
	}

	const status = config.enabled ? '✅ Enabled' : '❌ Disabled';
	let text =
		`<b>${config.channelTitle || channelId}</b>\n` +
		`ID: <code>${channelId}</code>\n` +
		`Status: ${status}\n` +
		`Delay: every ${config.checkIntervalMinutes} min\n`;

	if (config.sources.length === 0) {
		text += '\n<i>No sources added yet. Tap + Add Source to start tracking feeds.</i>';
	} else {
		text += `\n<b>Sources (${config.sources.length}):</b>\n`;
		for (const src of config.sources) {
			const s = src.enabled ? '✅' : '❌';
			const icon = sourceTypeIcon(src.type);
			const filter = src.mediaFilter ?? (src as any).mediaType ?? 'all';
			text += `${s} ${icon} <b>${escapeHtmlBot(src.value)}</b> [${filter}]\n`;
		}
	}

	const keyboard = new InlineKeyboard()
		.text(config.enabled ? '❌ Disable' : '✅ Enable', `ch_toggle:${channelId}`)
		.text('⏱ Set Delay', `set_interval:${channelId}`)
		.row()
		.text('+ Add Source', `add_src:${channelId}`)
		.text('Default Format', `fd_v:${channelId}`)
		.row()
		.text('❌ Failed Posts', `failed_posts:${channelId}`)
		.text('🗑 Remove Channel', `ch_remove:${channelId}`)
		.row();

	for (const src of config.sources) {
		const icon = src.enabled ? '✅' : '❌';
		const typeIcon = sourceTypeIcon(src.type);
		const displayValue = src.type === 'rss_url' && src.value.length > 30
			? src.value.substring(0, 30) + '...'
			: src.value;
		keyboard.text(`${icon} ${typeIcon} ${displayValue}`, `src_detail:${channelId}:${src.id}`).row();
	}

	keyboard.text('« Back to channels', 'back:channels');

	await editOrReply(ctx, text, { parse_mode: 'HTML', reply_markup: keyboard });
}

/**
 * Display list of posts that failed to send for a specific channel.
 */
export async function showFailedPosts(
	ctx: Context,
	kv: KVNamespace,
	channelId: string
): Promise<void> {
	const posts = await getFailedPosts(kv, channelId);
	const config = await getChannelConfig(kv, channelId);
	const title = config?.channelTitle || channelId;

	let text = `<b>Failed Posts for ${escapeHtmlBot(title)}</b>\n\n`;

	if (posts.length === 0) {
		text += '<i>Everything is looking good! No failed posts to show.</i>';
	} else {
		text += `Showing last ${posts.length} posts that failed to send or were skipped:\n\n`;
		for (const post of posts) {
			const postTitle = post.title || 'Untitled';
			text += `• <a href="${post.link}">${escapeHtmlBot(postTitle)}</a>\n`;
		}
	}

	const keyboard = new InlineKeyboard();
	if (posts.length > 0) {
		keyboard.text('Clear Log', `clear_failed:${channelId}`).row();
	}
	keyboard.text('« Back', `ch:${channelId}`);

	await editOrReply(ctx, text, { parse_mode: 'HTML', reply_markup: keyboard, disable_web_page_preview: true });
}
