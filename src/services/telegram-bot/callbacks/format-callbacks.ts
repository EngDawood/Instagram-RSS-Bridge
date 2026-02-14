import type { Bot } from 'grammy';
import type { FormatSettings } from '../../../types/telegram';
import { getChannelConfig, saveChannelConfig } from '../storage/kv-operations';
import { resolveFormatSettings } from '../../../utils/telegram-format';
import { cycleFormatValue, formatValueText } from '../helpers/format-settings';
import { buildFormatKeyboard } from '../views/keyboard-builders';
import { editOrReply } from '../helpers/edit-or-reply';
import { escapeHtml as escapeHtmlBot } from '../../../utils/text';
import { FORMAT_LABELS } from '../../../constants';

/**
 * Register callback query handlers for format settings management.
 */
export function registerFormatCallbacks(bot: Bot, env: Env, kv: KVNamespace): void {
	// Cycle source format setting: fs:CHID:SRCID:SETTING
	bot.callbackQuery(/^fs:([^:]+):([^:]+):([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const sourceId = ctx.match[2];
		const setting = ctx.match[3] as keyof FormatSettings;
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }
		const source = config.sources.find((s) => s.id === sourceId);
		if (!source) { await ctx.answerCallbackQuery({ text: 'Source not found' }); return; }

		if (!source.format) source.format = {};
		const current = resolveFormatSettings(config.defaultFormat, source.format);
		const nextVal = cycleFormatValue(setting, current[setting]);
		if (setting === 'lengthLimit') {
			source.format[setting] = parseInt(nextVal, 10);
		} else {
			(source.format as any)[setting] = nextVal;
		}
		await saveChannelConfig(kv, channelId, config);

		const updated = resolveFormatSettings(config.defaultFormat, source.format);
		const keyboard = buildFormatKeyboard(
			updated,
			`fs:${channelId}:${sourceId}`,
			`src_detail:${channelId}:${sourceId}`,
			`fs_r:${channelId}:${sourceId}`
		);
		await editOrReply(ctx,
			`<b>Format settings for ${escapeHtmlBot(source.value)}</b>\n` +
			`Channel: <b>${config.channelTitle}</b>`,
			{ parse_mode: 'HTML', reply_markup: keyboard }
		);
		await ctx.answerCallbackQuery({ text: `${FORMAT_LABELS[setting].label}: ${formatValueText(setting, nextVal)}` });
	});

	// Cycle channel default format setting: fd:CHID:SETTING
	bot.callbackQuery(/^fd:([^:]+):([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const setting = ctx.match[2] as keyof FormatSettings;
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }

		if (!config.defaultFormat) config.defaultFormat = {};
		const current = resolveFormatSettings(config.defaultFormat);
		const nextVal = cycleFormatValue(setting, current[setting]);
		if (setting === 'lengthLimit') {
			config.defaultFormat[setting] = parseInt(nextVal, 10);
		} else {
			(config.defaultFormat as any)[setting] = nextVal;
		}
		await saveChannelConfig(kv, channelId, config);

		const updated = resolveFormatSettings(config.defaultFormat);
		const keyboard = buildFormatKeyboard(
			updated,
			`fd:${channelId}`,
			`ch:${channelId}`,
			`fd_r:${channelId}`
		);
		await editOrReply(ctx,
			`<b>Set the default settings for subscriptions.</b>\n\n` +
			`The unset settings of a subscription will fall back to the settings on this page.`,
			{ parse_mode: 'HTML', reply_markup: keyboard }
		);
		await ctx.answerCallbackQuery({ text: `${FORMAT_LABELS[setting].label}: ${formatValueText(setting, nextVal)}` });
	});

	// View source format settings: fs_v:CHID:SRCID
	bot.callbackQuery(/^fs_v:([^:]+):([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const sourceId = ctx.match[2];
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }
		const source = config.sources.find((s) => s.id === sourceId);
		if (!source) { await ctx.answerCallbackQuery({ text: 'Source not found' }); return; }

		const current = resolveFormatSettings(config.defaultFormat, source.format);
		const keyboard = buildFormatKeyboard(
			current,
			`fs:${channelId}:${sourceId}`,
			`src_detail:${channelId}:${sourceId}`,
			`fs_r:${channelId}:${sourceId}`
		);
		await editOrReply(ctx,
			`<b>Format settings for ${escapeHtmlBot(source.value)}</b>\n` +
			`Channel: <b>${config.channelTitle}</b>`,
			{ parse_mode: 'HTML', reply_markup: keyboard }
		);
		await ctx.answerCallbackQuery();
	});

	// View channel default format settings: fd_v:CHID
	bot.callbackQuery(/^fd_v:([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }

		const current = resolveFormatSettings(config.defaultFormat);
		const keyboard = buildFormatKeyboard(
			current,
			`fd:${channelId}`,
			`ch:${channelId}`,
			`fd_r:${channelId}`
		);
		await editOrReply(ctx,
			`<b>Set the default settings for subscriptions.</b>\n\n` +
			`The unset settings of a subscription will fall back to the settings on this page.`,
			{ parse_mode: 'HTML', reply_markup: keyboard }
		);
		await ctx.answerCallbackQuery();
	});

	// Reset source format to channel defaults: fs_r:CHID:SRCID
	bot.callbackQuery(/^fs_r:([^:]+):([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const sourceId = ctx.match[2];
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }
		const source = config.sources.find((s) => s.id === sourceId);
		if (!source) { await ctx.answerCallbackQuery({ text: 'Source not found' }); return; }

		delete source.format;
		await saveChannelConfig(kv, channelId, config);

		const current = resolveFormatSettings(config.defaultFormat);
		const keyboard = buildFormatKeyboard(
			current,
			`fs:${channelId}:${sourceId}`,
			`src_detail:${channelId}:${sourceId}`,
			`fs_r:${channelId}:${sourceId}`
		);
		await editOrReply(ctx,
			`<b>Format settings for ${escapeHtmlBot(source.value)}</b>\n` +
			`Channel: <b>${config.channelTitle}</b>\n\n<i>Reset to channel defaults.</i>`,
			{ parse_mode: 'HTML', reply_markup: keyboard }
		);
		await ctx.answerCallbackQuery({ text: 'Reset to defaults' });
	});

	// Reset channel defaults to system defaults: fd_r:CHID
	bot.callbackQuery(/^fd_r:([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }

		delete config.defaultFormat;
		await saveChannelConfig(kv, channelId, config);

		const current = resolveFormatSettings();
		const keyboard = buildFormatKeyboard(
			current,
			`fd:${channelId}`,
			`ch:${channelId}`,
			`fd_r:${channelId}`
		);
		await editOrReply(ctx,
			`<b>Set the default settings for subscriptions.</b>\n\n` +
			`The unset settings of a subscription will fall back to the settings on this page.\n\n<i>Reset to system defaults.</i>`,
			{ parse_mode: 'HTML', reply_markup: keyboard }
		);
		await ctx.answerCallbackQuery({ text: 'Reset to defaults' });
	});
}
