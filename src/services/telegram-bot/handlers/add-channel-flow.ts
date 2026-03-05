import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';
import type { ChannelConfig } from '../../../types/telegram';
import { resolveChannel } from '../helpers/channel-resolver';
import { getChannelsList, saveChannelsList, getChannelConfig, saveChannelConfig } from '../storage/kv-operations';
import { clearAdminState } from '../storage/admin-state';

/**
 * Directly add a channel by @username or ID.
 */
export async function addChannelDirect(
	ctx: Context,
	bot: Bot,
	kv: KVNamespace,
	adminId: number,
	arg: string
): Promise<void> {
	const resolved = await resolveChannel(bot, arg);
	if (!resolved) {
		await ctx.reply(
			`Could not find channel "${arg}". Make sure:\n` +
				'• The bot is added as admin to the channel\n' +
				'• You use @username or the numeric ID',
			{ parse_mode: 'HTML' }
		);
		return;
	}

	if (!resolved.isMember) {
		await ctx.reply(
			`⚠️ <b>Warning:</b> The bot is not a member of <b>${resolved.title}</b>.\n\n` +
				'Please add the bot to the channel/group as an <b>administrator</b> so it can post updates.',
			{ parse_mode: 'HTML' }
		);
	}

	const channels = await getChannelsList(kv);
	if (channels.includes(resolved.id)) {
		await clearAdminState(kv, adminId);
		await ctx.reply(`<b>${resolved.title}</b> is already registered. Use /channels to manage.`, { parse_mode: 'HTML' });
		return;
	}

	const config: ChannelConfig = {
		channelTitle: resolved.title,
		enabled: true,
		checkIntervalMinutes: 30,
		lastCheckTimestamp: 0,
		sources: [],
	};

	channels.push(resolved.id);
	await saveChannelsList(kv, channels);
	await saveChannelConfig(kv, resolved.id, config);
	await clearAdminState(kv, adminId);

	const keyboard = new InlineKeyboard()
		.text('Configure this channel', `ch:${resolved.id}`);

	await ctx.reply(
		`✅ <b>${resolved.title}</b> added!\n\nNow subscribe to sources:\n<code>/sub @${arg.replace(/^@/, '')} @iguser</code> or\n<code>/sub @${arg.replace(/^@/, '')} https://feed-url</code>`,
		{ parse_mode: 'HTML', reply_markup: keyboard }
	);
}
