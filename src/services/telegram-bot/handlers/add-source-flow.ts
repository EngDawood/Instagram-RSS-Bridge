import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';
import type { AdminState, ChannelSource } from '../../../types/telegram';
import { getChannelConfig, saveChannelConfig, getChannelsList, saveChannelsList } from '../storage/kv-operations';
import { clearAdminState } from '../storage/admin-state';
import { shortHash, sourceTypeLabel } from '../helpers/source-parser';
import { escapeHtml as escapeHtmlBot } from '../../../utils/text';
import { fetchAndSendLatest } from './fetch-and-send';
import { CACHE_PREFIX_TELEGRAM_CHANNEL } from '../../../constants';

/**
 * Handle the text input for adding a new source (URL, username, or hashtag).
 */
export async function handleAddSourceValue(
	ctx: Context,
	bot: Bot,
	kv: KVNamespace,
	adminId: number,
	state: AdminState,
	text: string,
	env: Env
): Promise<void> {
	const channelId = state.context?.channelId;
	const sourceType = state.context?.sourceType;

	if (!channelId || !sourceType) {
		await clearAdminState(kv, adminId);
		await ctx.reply('Something went wrong. Please try again with /channels.');
		return;
	}

	const config = await getChannelConfig(kv, channelId);
	if (!config) {
		await clearAdminState(kv, adminId);
		await ctx.reply('Channel not found.');
		return;
	}

	const rawValue = text.trim();

	// For RSS URLs, validate it looks like a URL
	if (sourceType === 'rss_url' && !rawValue.startsWith('http://') && !rawValue.startsWith('https://')) {
		await ctx.reply('Please send a valid URL starting with http:// or https://\n\nUse /cancel to abort.');
		return;
	}

	const value = sourceType === 'rss_url' ? rawValue : rawValue.replace(/^[@#]/, '');
	let id = '';
	if (sourceType === 'rss_url') {
		id = `rss_${shortHash(value)}`;
	} else if (sourceType === 'instagram_user') {
		id = `usr_${shortHash(value)}`;
	} else if (sourceType === 'instagram_tag') {
		id = `tag_${shortHash(value)}`;
	}

	if (config.sources.some((s) => s.id === id)) {
		await clearAdminState(kv, adminId);
		await ctx.reply(`Source "${value}" already exists for this channel.`);
		return;
	}

	const source: ChannelSource = {
		id,
		type: sourceType,
		value,
		mediaFilter: 'all',
		enabled: true,
	};

	config.sources.push(source);
	await saveChannelConfig(kv, channelId, config);
	await clearAdminState(kv, adminId);

	const keyboard = new InlineKeyboard()
		.text('View channel', `ch:${channelId}`)
		.text('+ Add another', `add_src:${channelId}`);

	await ctx.reply(
		`✅ Source added: <b>${sourceTypeLabel(sourceType)}</b> — <code>${escapeHtmlBot(value)}</code>\n\nFetching latest posts...`,
		{ parse_mode: 'HTML', reply_markup: keyboard }
	);

	// Fetch and send latest posts immediately
	await fetchAndSendLatest(bot, env, parseInt(channelId, 10), source);
}

/**
 * Handle the text input confirmation ('yes') for removing a channel.
 */
export async function handleRemoveChannelConfirm(
	ctx: Context,
	kv: KVNamespace,
	adminId: number,
	state: AdminState,
	text: string
): Promise<void> {
	if (text.trim().toLowerCase() !== 'yes') {
		await clearAdminState(kv, adminId);
		await ctx.reply('Channel removal cancelled.');
		return;
	}

	const channelId = state.context?.channelId;
	if (!channelId) {
		await clearAdminState(kv, adminId);
		return;
	}

	const channels = await getChannelsList(kv);
	const updated = channels.filter((id) => id !== channelId);
	await saveChannelsList(kv, updated);
	await kv.delete(`${CACHE_PREFIX_TELEGRAM_CHANNEL}${channelId}:config`);
	await clearAdminState(kv, adminId);
	await ctx.reply(`Channel <code>${channelId}</code> removed.`, { parse_mode: 'HTML' });
}
