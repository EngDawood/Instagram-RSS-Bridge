import type { Bot } from 'grammy';
import { getChannelConfig } from '../storage/kv-operations';
import { resolveChannelArg } from '../helpers/channel-resolver';
import { resolveFormatSettings } from '../../../utils/telegram-format';
import { buildFormatKeyboard } from '../views/keyboard-builders';
import { escapeHtml as escapeHtmlBot } from '../../../utils/text';

/**
 * Register format settings commands.
 */
export function registerFormatCommands(bot: Bot, env: Env, kv: KVNamespace): void {
	// /set_default @channel — channel default format settings
	bot.command('set_default', async (ctx) => {
		const arg = ctx.match?.trim();
		if (!arg) {
			await ctx.reply('Usage: <code>/set_default @channel</code>', { parse_mode: 'HTML' });
			return;
		}
		const resolved = await resolveChannelArg(bot, kv, arg);
		if (!resolved) { await ctx.reply(`Channel "${arg}" not found.`); return; }
		const config = await getChannelConfig(kv, resolved.id);
		if (!config) { await ctx.reply('Channel not registered.'); return; }

		const current = resolveFormatSettings(config.defaultFormat);
		const keyboard = buildFormatKeyboard(
			current,
			`fd:${resolved.id}`,
			`ch:${resolved.id}`,
			`fd_r:${resolved.id}`
		);
		await ctx.reply(
			`<b>Set the default settings for subscriptions.</b>\n\n` +
			`The unset settings of a subscription will fall back to the settings on this page.`,
			{ parse_mode: 'HTML', reply_markup: keyboard }
		);
	});

	// /set @channel @source — per-source format settings
	bot.command('set', async (ctx) => {
		const args = ctx.match?.trim().split(/\s+/);
		if (!args || args.length < 2) {
			await ctx.reply(
				'Usage: <code>/set @channel source</code>\n\nExample: <code>/set @mychannel @natgeo</code>',
				{ parse_mode: 'HTML' }
			);
			return;
		}
		const [channelRef, ...sourceRefParts] = args;
		const sourceRef = sourceRefParts.join(' ');
		const resolvedChannel = await resolveChannelArg(bot, kv, channelRef);
		if (!resolvedChannel) { await ctx.reply(`Channel "${channelRef}" not found.`); return; }
		const config = await getChannelConfig(kv, resolvedChannel.id);
		if (!config) { await ctx.reply('Channel not registered.'); return; }

		const sourceValue = sourceRef.replace(/^[@#]/, '');
		const source = config.sources.find((s) => s.value === sourceValue || s.id === sourceValue || s.value === sourceRef);
		if (!source) {
			await ctx.reply(`Source "${sourceRef}" not found in <b>${config.channelTitle}</b>.`, { parse_mode: 'HTML' });
			return;
		}

		const current = resolveFormatSettings(config.defaultFormat, source.format);
		const keyboard = buildFormatKeyboard(
			current,
			`fs:${resolvedChannel.id}:${source.id}`,
			`src_detail:${resolvedChannel.id}:${source.id}`,
			`fs_r:${resolvedChannel.id}:${source.id}`
		);
		await ctx.reply(
			`<b>Format settings for ${escapeHtmlBot(source.value)}</b>\n` +
			`Channel: <b>${config.channelTitle}</b>`,
			{ parse_mode: 'HTML', reply_markup: keyboard }
		);
	});
}
