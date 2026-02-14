import type { Bot } from 'grammy';
import { getChannelsList, getChannelConfig } from '../storage/kv-operations';

/**
 * Resolve a channel reference (@username or numeric ID) to a numeric ID string + title.
 */
export async function resolveChannel(bot: Bot, ref: string): Promise<{ id: string; title: string } | null> {
	try {
		const chatId = ref.startsWith('@') ? ref : parseInt(ref, 10);
		if (typeof chatId === 'number' && isNaN(chatId)) return null;
		const chat = await bot.api.getChat(chatId);
		return { id: String(chat.id), title: ('title' in chat && chat.title) || ref };
	} catch (err: any) {
		console.warn(`[resolveChannel] Failed to resolve "${ref}":`, err.message || err);
		return null;
	}
}

/**
 * Find channel ID by title or username from stored configurations.
 */
export async function findChannelByName(kv: KVNamespace, name: string): Promise<string | null> {
	const clean = name.replace(/^@/, '').toLowerCase();
	const channels = await getChannelsList(kv);
	for (const channelId of channels) {
		const config = await getChannelConfig(kv, channelId);
		if (!config) continue;
		if (config.channelTitle.toLowerCase() === clean || config.channelTitle.toLowerCase() === `@${clean}`) {
			return channelId;
		}
	}
	return null;
}

/**
 * Resolve a channel argument: accepts @username, numeric ID, or stored channel name.
 */
export async function resolveChannelArg(
	bot: Bot,
	kv: KVNamespace,
	arg: string
): Promise<{ id: string; title: string } | null> {
	// 1. If it's a numeric ID (-100123...)
	if (/^-\d+$/.test(arg)) {
		const config = await getChannelConfig(kv, arg);
		if (config) return { id: arg, title: config.channelTitle };
		return resolveChannel(bot, arg);
	}

	// 2. If it starts with @, try Telegram API first
	if (arg.startsWith('@')) {
		const resolved = await resolveChannel(bot, arg);
		if (resolved) return resolved;
	}

	// 3. Try finding by stored name (case-insensitive)
	const found = await findChannelByName(kv, arg);
	if (found) {
		const config = await getChannelConfig(kv, found);
		return { id: found, title: config?.channelTitle || found };
	}

	return null;
}
