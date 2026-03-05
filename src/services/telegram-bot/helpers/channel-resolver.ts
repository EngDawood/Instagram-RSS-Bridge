import type { Bot } from 'grammy';
import { getChannelsList, getChannelConfig } from '../storage/kv-operations';

/**
 * Resolve a channel reference (@username or numeric ID) to a numeric ID string + title.
 * Also checks if the bot is currently a member of that chat.
 */
export async function resolveChannel(bot: Bot, ref: string): Promise<{ id: string; title: string; isMember: boolean } | null> {
	try {
		const chatId = ref.startsWith('@') ? ref : parseInt(ref, 10);
		if (typeof chatId === 'number' && isNaN(chatId)) return null;
		const chat = await bot.api.getChat(chatId);

		// Check if bot is a member/admin. getChatMember throws if bot is not in the chat.
		let isMember = false;
		try {
			// Cloudflare Workers: we don't have bot.botInfo.id until init(), so use getMe() once.
			const me = await bot.api.getMe();
			const member = await bot.api.getChatMember(chat.id, me.id);
			isMember = ['administrator', 'creator', 'member'].includes(member.status);
		} catch (e) {
			// Not a member or restricted
		}

		return { id: String(chat.id), title: ('title' in chat && chat.title) || ref, isMember };
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
): Promise<{ id: string; title: string; isMember: boolean } | null> {
	// 1. If it's a numeric ID (-100123...)
	if (/^-\d+$/.test(arg)) {
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
		return resolveChannel(bot, found);
	}

	return null;
}
