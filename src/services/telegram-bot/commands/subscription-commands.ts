import type { Bot } from 'grammy';
import type { ChannelSource } from '../../../types/telegram';
import { getChannelsList, saveChannelsList, getChannelConfig, saveChannelConfig } from '../storage/kv-operations';
import { resolveChannelArg } from '../helpers/channel-resolver';
import { parseSourceRef, sourceTypeLabel, sourceTypeIcon } from '../helpers/source-parser';
import { fetchAndSendLatest } from '../handlers/fetch-and-send';
import { fetchForSource } from '../../source-fetcher';
import { getCached, setCached } from '../../../utils/cache';
import { CACHE_PREFIX_TELEGRAM_LASTSEEN, TELEGRAM_CONFIG_TTL } from '../../../constants';
import { escapeHtml as escapeHtmlBot } from '../../../utils/text';

/**
 * Register subscription management commands.
 */
export function registerSubscriptionCommands(bot: Bot, env: Env, kv: KVNamespace): void {
	// /list — List all subscriptions across all channels
	bot.command('list', async (ctx) => {
		const channels = await getChannelsList(kv);
		if (channels.length === 0) {
			await ctx.reply('No channels configured. Use /add @channel to add one.');
			return;
		}

		let text = '<b>Your Subscriptions:</b>\n\n';
		let foundAny = false;

		for (const channelId of channels) {
			const config = await getChannelConfig(kv, channelId);
			if (!config || config.sources.length === 0) continue;

			foundAny = true;
			text += `<b>${config.channelTitle}</b>:\n`;
			for (const src of config.sources) {
				const status = src.enabled ? '✅' : '❌';
				const icon = sourceTypeIcon(src.type);
				text += `  ${status} ${icon} <code>${escapeHtmlBot(src.value)}</code>\n`;
			}
			text += '\n';
		}

		if (!foundAny) {
			text = 'No subscriptions found in any channel. Use <code>/sub</code> to add one.';
		}

		await ctx.reply(text, { parse_mode: 'HTML' });
	});

	// /sub @channel @iguser  OR  /sub @channel #hashtag  OR  /sub @channel https://...
	bot.command('sub', async (ctx) => {
		const args = ctx.match?.trim().split(/\s+/);
		if (!args || args.length < 2) {
			await ctx.reply(
				'Usage:\n' +
				'<code>/sub @channel @iguser</code> — Instagram user\n' +
				'<code>/sub @channel #hashtag</code> — Instagram hashtag\n' +
				'<code>/sub @channel https://feed-url</code> — RSS/Atom feed\n' +
				'<code>/sub @channel @iguser 5</code> — with initial post count',
				{ parse_mode: 'HTML' }
			);
			return;
		}
		const channelRef = args[0];
		// Source ref might be a URL with special chars — rejoin remaining args (except trailing number)
		let sourceRefParts = args.slice(1);
		let postCount = 0;
		const lastArg = sourceRefParts[sourceRefParts.length - 1];
		if (/^\d+$/.test(lastArg) && sourceRefParts.length > 1) {
			postCount = Math.min(Math.max(parseInt(lastArg, 10), 1), 12);
			sourceRefParts = sourceRefParts.slice(0, -1);
		}
		const sourceRef = sourceRefParts.join(' ');

		const resolved = await resolveChannelArg(bot, kv, channelRef);
		if (!resolved) {
			await ctx.reply(`Channel "${channelRef}" not found. Register it first with <code>/add ${channelRef}</code>`, { parse_mode: 'HTML' });
			return;
		}

		// Auto-register channel if not yet registered
		let config = await getChannelConfig(kv, resolved.id);
		if (!config) {
			config = { channelTitle: resolved.title, enabled: true, checkIntervalMinutes: 30, lastCheckTimestamp: 0, sources: [] };
			const channels = await getChannelsList(kv);
			channels.push(resolved.id);
			await saveChannelsList(kv, channels);
		}

		const parsed = parseSourceRef(sourceRef);
		if (!parsed) {
			await ctx.reply('Invalid source. Use @username, #hashtag, or a feed URL.');
			return;
		}

		if (config.sources.some((s) => s.id === parsed.id)) {
			await ctx.reply(`Already subscribed to <b>${escapeHtmlBot(parsed.value)}</b> in <b>${resolved.title}</b>.`, { parse_mode: 'HTML' });
			return;
		}

		const source: ChannelSource = { id: parsed.id, type: parsed.type, value: parsed.value, mediaFilter: 'all', enabled: true };
		config.sources.push(source);
		await saveChannelConfig(kv, resolved.id, config);

		const typeLabel = sourceTypeLabel(parsed.type);
		if (postCount > 0) {
			await ctx.reply(
				`✅ <b>${resolved.title}</b> subscribed to ${typeLabel}: <b>${escapeHtmlBot(parsed.value)}</b>\n\nFetching latest ${postCount} post(s)...`,
				{ parse_mode: 'HTML' }
			);
			await fetchAndSendLatest(bot, env, parseInt(resolved.id, 10), source, postCount);
		} else {
			await ctx.reply(
				`✅ <b>${resolved.title}</b> subscribed to ${typeLabel}: <b>${escapeHtmlBot(parsed.value)}</b>\n\nNew posts will arrive on next cron check.`,
				{ parse_mode: 'HTML' }
			);
		}
	});

	// /unsub @channel source
	bot.command('unsub', async (ctx) => {
		const args = ctx.match?.trim().split(/\s+/);
		if (!args || args.length < 2) {
			await ctx.reply('Usage: <code>/unsub @channel source</code>\n\nSource can be @username, #hashtag, or feed URL', { parse_mode: 'HTML' });
			return;
		}
		const [channelRef, ...sourceRefParts] = args;
		const sourceRef = sourceRefParts.join(' ');
		const resolved = await resolveChannelArg(bot, kv, channelRef);
		if (!resolved) { await ctx.reply(`Channel "${channelRef}" not found.`); return; }

		const config = await getChannelConfig(kv, resolved.id);
		if (!config) { await ctx.reply('Channel not registered.'); return; }

		const parsed = parseSourceRef(sourceRef);
		const before = config.sources.length;
		config.sources = config.sources.filter((s) => {
			// Match by id, value, or legacy value
			if (parsed && s.id === parsed.id) return false;
			if (s.value === sourceRef.replace(/^[@#]/, '')) return false;
			return true;
		});
		if (config.sources.length === before) {
			await ctx.reply(`Source "${sourceRef}" not found in <b>${resolved.title}</b>.`, { parse_mode: 'HTML' });
			return;
		}
		await saveChannelConfig(kv, resolved.id, config);
		await ctx.reply(`✅ Removed <b>${escapeHtmlBot(sourceRef)}</b> from <b>${resolved.title}</b>.`, { parse_mode: 'HTML' });
	});

	// /delay @channel <minutes>
	bot.command('delay', async (ctx) => {
		const args = ctx.match?.trim().split(/\s+/);
		if (!args || args.length < 2) {
			await ctx.reply('Usage: <code>/delay @channel 30</code>', { parse_mode: 'HTML' });
			return;
		}
		const [channelRef, mins] = args;
		const minutes = parseInt(mins, 10);
		if (isNaN(minutes) || minutes < 5) {
			await ctx.reply('Delay must be at least 5 minutes.');
			return;
		}
		const resolvedChannel = await resolveChannelArg(bot, kv, channelRef);
		if (!resolvedChannel) { await ctx.reply(`Channel "${channelRef}" not found.`); return; }

		const config = await getChannelConfig(kv, resolvedChannel.id);
		if (!config) { await ctx.reply('Channel not registered.'); return; }

		config.checkIntervalMinutes = minutes;
		await saveChannelConfig(kv, resolvedChannel.id, config);
		await ctx.reply(`⏱ <b>${resolvedChannel.title}</b> delay set to <b>${minutes} min</b>`, { parse_mode: 'HTML' });
	});

	// /seed @channel [@source] — mark sources as read without sending
	bot.command('seed', async (ctx) => {
		const args = ctx.match?.trim().split(/\s+/);
		if (!args || args.length < 1 || !args[0]) {
			await ctx.reply(
				'Usage:\n' +
				'<code>/seed @channel</code> — mark ALL sources as read\n' +
				'<code>/seed @channel @iguser</code> — mark single source as read',
				{ parse_mode: 'HTML' }
			);
			return;
		}
		const channelRef = args[0];
		const sourceRef = args.length > 1 ? args.slice(1).join(' ') : null;

		const resolved = await resolveChannelArg(bot, kv, channelRef);
		if (!resolved) {
			await ctx.reply(`Channel "${channelRef}" not found.`);
			return;
		}

		const config = await getChannelConfig(kv, resolved.id);
		if (!config || config.sources.length === 0) {
			await ctx.reply('No sources configured for this channel.');
			return;
		}

		// Determine which sources to seed
		let sourcesToSeed: ChannelSource[];
		if (sourceRef) {
			const parsed = parseSourceRef(sourceRef);
			if (!parsed) {
				await ctx.reply('Invalid source. Use @username, #hashtag, or a feed URL.');
				return;
			}
			const found = config.sources.find((s) => s.id === parsed.id);
			if (!found) {
				await ctx.reply(`Source "${sourceRef}" not found in <b>${resolved.title}</b>.`, { parse_mode: 'HTML' });
				return;
			}
			sourcesToSeed = [found];
		} else {
			sourcesToSeed = config.sources.filter((s) => s.enabled);
		}

		await ctx.reply(`Seeding ${sourcesToSeed.length} source(s) for <b>${resolved.title}</b>...`, { parse_mode: 'HTML' });

		const results: string[] = [];
		for (const source of sourcesToSeed) {
			try {
				const result = await fetchForSource(source, env);
				if (result.items.length === 0) {
					results.push(`${sourceTypeIcon(source.type)} ${escapeHtmlBot(source.value)} — no items found`);
					continue;
				}
				const lastSeenKey = `${CACHE_PREFIX_TELEGRAM_LASTSEEN}${resolved.id}:${source.id}`;
				await setCached(kv, lastSeenKey, result.items[0].id, TELEGRAM_CONFIG_TTL);
				results.push(`${sourceTypeIcon(source.type)} ${escapeHtmlBot(source.value)} — marked ${result.items.length} items as seen`);
			} catch (err) {
				results.push(`${sourceTypeIcon(source.type)} ${escapeHtmlBot(source.value)} — error: ${err}`);
			}
		}

		await ctx.reply(`<b>Seed complete:</b>\n${results.join('\n')}`, { parse_mode: 'HTML' });
	});
}
