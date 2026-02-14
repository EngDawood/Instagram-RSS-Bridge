import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { getChannelsList, getChannelConfig } from '../storage/kv-operations';
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
		const message = 'No channels configured. Use /add @channel to add one.';
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

	const text = '<b>Your channels:</b>\n\nTap a channel to manage it.';
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
		text += '\n<i>No sources — tap + Add Source below</i>';
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
