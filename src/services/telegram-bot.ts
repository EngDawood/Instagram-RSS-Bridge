import { Bot, InlineKeyboard, InputMediaBuilder } from 'grammy';
import type { Context } from 'grammy';
import type { ChannelConfig, ChannelSource, AdminState, TelegramMediaMessage } from '../types/telegram';
import type { FeedContext, MediaTypeFilter } from '../types/instagram';
import { fetchInstagramData } from './instagram-client';
import { resolveUserId } from './user-resolver';
import { formatMediaForTelegram } from '../utils/telegram-format';
import { buildHeaders } from '../utils/headers';
import { getCached, setCached } from '../utils/cache';
import {
	IG_WEB_PROFILE,
	IG_TOP_SEARCH,
	CACHE_KEY_TELEGRAM_CHANNELS,
	CACHE_PREFIX_TELEGRAM_CHANNEL,
	CACHE_PREFIX_TELEGRAM_LASTSEEN,
	CACHE_PREFIX_TELEGRAM_STATE,
	TELEGRAM_CONFIG_TTL,
} from '../constants';

// ─── KV Helpers ──────────────────────────────────────────────

async function getChannelsList(kv: KVNamespace): Promise<string[]> {
	const raw = await getCached(kv, CACHE_KEY_TELEGRAM_CHANNELS);
	return raw ? JSON.parse(raw) : [];
}

async function saveChannelsList(kv: KVNamespace, list: string[]): Promise<void> {
	await setCached(kv, CACHE_KEY_TELEGRAM_CHANNELS, JSON.stringify(list), TELEGRAM_CONFIG_TTL);
}

export async function getChannelConfig(kv: KVNamespace, channelId: string): Promise<ChannelConfig | null> {
	const raw = await getCached(kv, `${CACHE_PREFIX_TELEGRAM_CHANNEL}${channelId}:config`);
	return raw ? JSON.parse(raw) : null;
}

export async function saveChannelConfig(kv: KVNamespace, channelId: string, config: ChannelConfig): Promise<void> {
	await setCached(kv, `${CACHE_PREFIX_TELEGRAM_CHANNEL}${channelId}:config`, JSON.stringify(config), TELEGRAM_CONFIG_TTL);
}

async function getAdminState(kv: KVNamespace, userId: number): Promise<AdminState | null> {
	const raw = await getCached(kv, `${CACHE_PREFIX_TELEGRAM_STATE}${userId}`);
	return raw ? JSON.parse(raw) : null;
}

async function setAdminState(kv: KVNamespace, userId: number, state: AdminState): Promise<void> {
	await setCached(kv, `${CACHE_PREFIX_TELEGRAM_STATE}${userId}`, JSON.stringify(state), 3600);
}

async function clearAdminState(kv: KVNamespace, userId: number): Promise<void> {
	await kv.delete(`${CACHE_PREFIX_TELEGRAM_STATE}${userId}`);
}

// Safe edit-or-reply: tries editMessageText, falls back to reply
async function editOrReply(ctx: Context, text: string, opts?: { parse_mode?: string; reply_markup?: InlineKeyboard }): Promise<void> {
	try {
		if (ctx.callbackQuery?.message) {
			await ctx.editMessageText(text, opts as Parameters<typeof ctx.editMessageText>[1]);
		} else {
			await ctx.reply(text, opts as Parameters<typeof ctx.reply>[1]);
		}
	} catch {
		await ctx.reply(text, opts as Parameters<typeof ctx.reply>[1]);
	}
}

// Resolve a channel reference (@username or -ID) to a numeric ID string + title
async function resolveChannel(bot: Bot, ref: string): Promise<{ id: string; title: string } | null> {
	try {
		const chatId = ref.startsWith('@') ? ref : parseInt(ref, 10);
		const chat = await bot.api.getChat(chatId);
		return { id: String(chat.id), title: ('title' in chat && chat.title) || ref };
	} catch {
		return null;
	}
}

// Find channel ID by title or username from stored configs
async function findChannelByName(kv: KVNamespace, name: string): Promise<string | null> {
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

// Resolve channel arg: accepts @username, -ID, or stored channel name
async function resolveChannelArg(bot: Bot, kv: KVNamespace, arg: string): Promise<{ id: string; title: string } | null> {
	// If it's a numeric ID
	if (/^-\d+$/.test(arg)) {
		const config = await getChannelConfig(kv, arg);
		if (config) return { id: arg, title: config.channelTitle };
		return resolveChannel(bot, arg);
	}
	// If it starts with @, try Telegram API first
	if (arg.startsWith('@')) {
		const resolved = await resolveChannel(bot, arg);
		if (resolved) return resolved;
	}
	// Try finding by stored name
	const found = await findChannelByName(kv, arg);
	if (found) {
		const config = await getChannelConfig(kv, found);
		return { id: found, title: config?.channelTitle || found };
	}
	return null;
}

// ─── Bot Factory ─────────────────────────────────────────────

export function createBot(env: Env): Bot {
	const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
	const adminId = parseInt(env.ADMIN_TELEGRAM_ID, 10);
	const kv = env.CACHE;

	// Global error handler
	bot.catch((err) => {
		console.error('Bot error:', err);
	});

	// Admin guard middleware
	bot.use(async (ctx, next) => {
		if (ctx.from?.id !== adminId) {
			if (ctx.callbackQuery) {
				await ctx.answerCallbackQuery({ text: 'Unauthorized' });
			}
			return;
		}
		await next();
	});

	// ─── Commands ──────────────────────────────────────────

	bot.command('start', async (ctx) => {
		await ctx.reply(
			'<b>Instagram RSS Bridge Bot</b>\n\n' +
				'<b>Quick Commands:</b>\n' +
				'/sub @channel @iguser — Subscribe channel to IG user\n' +
				'/sub @channel #hashtag — Subscribe to hashtag\n' +
				'/unsub @channel @iguser — Unsubscribe\n' +
				'/interval @channel 30 — Set check interval (min)\n\n' +
				'<b>Management:</b>\n' +
				'/channels — List & manage channels\n' +
				'/add @channel — Register a channel\n' +
				'/status — Status overview\n' +
				'/enable @channel — Enable channel\n' +
				'/disable @channel — Disable channel\n' +
				'/debug @iguser — Test Instagram connectivity\n\n' +
				'/cancel — Cancel current action\n' +
				'/help — Full help',
			{ parse_mode: 'HTML' }
		);
	});

	bot.command('help', async (ctx) => {
		await ctx.reply(
			'<b>How to use:</b>\n\n' +
				'1. Add the bot to your Telegram channel as admin\n' +
				'2. Register: <code>/add @yourchannel</code>\n' +
				'3. Subscribe: <code>/sub @yourchannel @natgeo</code>\n' +
				'4. The bot auto-checks for new posts!\n\n' +
				'<b>Examples:</b>\n' +
				'<code>/sub @mychannel @cristiano</code> — IG user\n' +
				'<code>/sub @mychannel #photography</code> — hashtag\n' +
				'<code>/unsub @mychannel @cristiano</code> — remove\n' +
				'<code>/interval @mychannel 60</code> — every 1h\n' +
				'<code>/debug @natgeo</code> — test connectivity\n\n' +
				'You can use @channel_username or channel ID (-100xxx)',
			{ parse_mode: 'HTML' }
		);
	});

	bot.command('cancel', async (ctx) => {
		await clearAdminState(kv, adminId);
		await ctx.reply('Action cancelled.');
	});

	// /add @channel or /add -100xxx
	bot.command('add', async (ctx) => {
		const arg = ctx.match?.trim();
		if (arg) {
			// Direct add with argument
			await addChannelDirect(ctx, bot, kv, adminId, arg);
		} else {
			await setAdminState(kv, adminId, { action: 'adding_channel' });
			await ctx.reply(
				'Send me the channel <b>@username</b> or <b>ID</b>\n\n' +
					'Example: <code>@mychannel</code> or <code>-1001234567890</code>\n\n' +
					'Use /cancel to abort.',
				{ parse_mode: 'HTML' }
			);
		}
	});

	bot.command('channels', async (ctx) => {
		await showChannelsList(ctx, kv);
	});

	bot.command('status', async (ctx) => {
		const channels = await getChannelsList(kv);
		if (channels.length === 0) {
			await ctx.reply('No channels configured. Use /add @channel to add one.');
			return;
		}

		let text = '<b>Status Overview</b>\n\n';
		for (const channelId of channels) {
			const config = await getChannelConfig(kv, channelId);
			if (!config) continue;
			const status = config.enabled ? '✅' : '❌';
			const lastCheck = config.lastCheckTimestamp
				? new Date(config.lastCheckTimestamp).toLocaleString()
				: 'Never';
			text += `${status} <b>${config.channelTitle}</b>\n`;
			text += `   Sources: ${config.sources.length} | Interval: ${config.checkIntervalMinutes}m\n`;
			text += `   Last check: ${lastCheck}\n\n`;
		}
		await ctx.reply(text, { parse_mode: 'HTML' });
	});

	// /debug [@username] — Quick connectivity test (lightweight, avoids timeout)
	bot.command('debug', async (ctx) => {
		const arg = ctx.match?.trim().replace(/^@/, '') || '';
		const testUsername = arg || 'instagram';

		const lines: string[] = [];
		lines.push(`<b>Diagnostics: ${testUsername}</b>\n`);

		// Check session cookies
		const hasCookies = !!env.IG_SESSION_ID && !!env.IG_DS_USER_ID;
		lines.push(`Session cookies: ${hasCookies ? 'Present' : 'MISSING'}`);

		// Single quick REST API test with 8s timeout
		const headers = buildHeaders(env);
		try {
			const testUrl = `${IG_WEB_PROFILE}?username=${testUsername}`;
			const res = await fetch(testUrl, { headers, signal: AbortSignal.timeout(8000) });
			const contentType = res.headers.get('content-type') || '';
			if (!res.ok) {
				lines.push(`REST API: HTTP ${res.status} FAILED`);
			} else if (!contentType.includes('json')) {
				lines.push(`REST API: HTTP ${res.status} but returned HTML (login redirect — cookies expired)`);
			} else {
				const data = await res.json() as { data?: { user?: { edge_owner_to_timeline_media?: { count?: number } } } };
				const count = data?.data?.user?.edge_owner_to_timeline_media?.count;
				lines.push(`REST API: OK (${count ?? '?'} posts)`);
			}
		} catch (err) {
			lines.push(`REST API: ${String(err).substring(0, 100)}`);
		}

		// Quick user ID resolution with 5s timeout
		try {
			const searchUrl = `${IG_TOP_SEARCH}?query=${encodeURIComponent(testUsername)}`;
			const res = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(5000) });
			if (!res.ok) {
				lines.push(`User search: HTTP ${res.status}`);
			} else {
				const contentType = res.headers.get('content-type') || '';
				if (!contentType.includes('json')) {
					lines.push(`User search: returned HTML (cookies expired)`);
				} else {
					const data = await res.json() as { users?: Array<{ user: { pk: string; username: string } }> };
					const match = data?.users?.find((u) => u.user.username.toLowerCase() === testUsername.toLowerCase());
					lines.push(`User search: ${match ? `found (ID: ${match.user.pk})` : `not found in ${data?.users?.length ?? 0} results`}`);
				}
			}
		} catch (err) {
			lines.push(`User search: ${String(err).substring(0, 100)}`);
		}

		await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
	});

	// ─── /sub and /unsub Commands ─────────────────────────

	// /sub @channel @iguser [count]  OR  /sub @channel #hashtag [count]
	bot.command('sub', async (ctx) => {
		const args = ctx.match?.trim().split(/\s+/);
		if (!args || args.length < 2) {
			await ctx.reply(
				'Usage:\n<code>/sub @channel @iguser</code> — last 3 posts\n<code>/sub @channel @iguser 5</code> — last 5 posts\n<code>/sub @channel #hashtag</code>',
				{ parse_mode: 'HTML' }
			);
			return;
		}
		const [channelRef, sourceRef] = args;
		const postCount = Math.min(Math.max(parseInt(args[2], 10) || 1, 1), 12); // default 1, max 12
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

		// Determine source type from prefix
		let type: 'username' | 'hashtag' | 'location';
		let value: string;
		if (sourceRef.startsWith('#')) {
			type = 'hashtag';
			value = sourceRef.replace(/^#/, '');
		} else {
			type = 'username';
			value = sourceRef.replace(/^@/, '');
		}

		if (config.sources.some((s) => s.type === type && s.value === value)) {
			await ctx.reply(`Already subscribed to <b>${value}</b> in <b>${resolved.title}</b>.`, { parse_mode: 'HTML' });
			return;
		}

		const source: ChannelSource = { id: `${type}_${value}`, type, value, mediaType: 'all', enabled: true };
		config.sources.push(source);
		await saveChannelConfig(kv, resolved.id, config);

		await ctx.reply(
			`✅ <b>${resolved.title}</b> subscribed to ${type}: <b>${value}</b>\n\nFetching latest posts...`,
			{ parse_mode: 'HTML' }
		);

		// Fetch and send latest posts immediately
		await fetchAndSendLatest(bot, kv, parseInt(resolved.id, 10), source, env, postCount);
	});

	// /unsub @channel @iguser
	bot.command('unsub', async (ctx) => {
		const args = ctx.match?.trim().split(/\s+/);
		if (!args || args.length < 2) {
			await ctx.reply('Usage: <code>/unsub @channel @iguser</code>', { parse_mode: 'HTML' });
			return;
		}
		const [channelRef, sourceRef] = args;
		const resolved = await resolveChannelArg(bot, kv, channelRef);
		if (!resolved) { await ctx.reply(`Channel "${channelRef}" not found.`); return; }

		const config = await getChannelConfig(kv, resolved.id);
		if (!config) { await ctx.reply('Channel not registered.'); return; }

		const value = sourceRef.replace(/^[@#]/, '');
		const before = config.sources.length;
		config.sources = config.sources.filter((s) => s.value !== value);
		if (config.sources.length === before) {
			await ctx.reply(`Source "${value}" not found in <b>${resolved.title}</b>.`, { parse_mode: 'HTML' });
			return;
		}
		await saveChannelConfig(kv, resolved.id, config);
		await ctx.reply(`✅ Removed <b>${value}</b> from <b>${resolved.title}</b>.`, { parse_mode: 'HTML' });
	});

	// /interval @channel <minutes>
	bot.command('interval', async (ctx) => {
		const args = ctx.match?.trim().split(/\s+/);
		if (!args || args.length < 2) {
			await ctx.reply('Usage: <code>/interval @channel 30</code>', { parse_mode: 'HTML' });
			return;
		}
		const [channelRef, mins] = args;
		const minutes = parseInt(mins, 10);
		if (isNaN(minutes) || minutes < 5) {
			await ctx.reply('Interval must be at least 5 minutes.');
			return;
		}
		const resolved = await resolveChannelArg(bot, kv, channelRef);
		if (!resolved) { await ctx.reply(`Channel "${channelRef}" not found.`); return; }

		const config = await getChannelConfig(kv, resolved.id);
		if (!config) { await ctx.reply('Channel not registered.'); return; }

		config.checkIntervalMinutes = minutes;
		await saveChannelConfig(kv, resolved.id, config);
		await ctx.reply(`⏱ <b>${resolved.title}</b> interval set to <b>${minutes} min</b>`, { parse_mode: 'HTML' });
	});

	// /enable @channel
	bot.command('enable', async (ctx) => {
		const arg = ctx.match?.trim();
		if (!arg) { await ctx.reply('Usage: <code>/enable @channel</code>', { parse_mode: 'HTML' }); return; }
		const resolved = await resolveChannelArg(bot, kv, arg);
		if (!resolved) { await ctx.reply('Channel not found.'); return; }
		const config = await getChannelConfig(kv, resolved.id);
		if (!config) { await ctx.reply('Channel not registered.'); return; }
		config.enabled = true;
		await saveChannelConfig(kv, resolved.id, config);
		await ctx.reply(`✅ <b>${resolved.title}</b> enabled.`, { parse_mode: 'HTML' });
	});

	// /disable @channel
	bot.command('disable', async (ctx) => {
		const arg = ctx.match?.trim();
		if (!arg) { await ctx.reply('Usage: <code>/disable @channel</code>', { parse_mode: 'HTML' }); return; }
		const resolved = await resolveChannelArg(bot, kv, arg);
		if (!resolved) { await ctx.reply('Channel not found.'); return; }
		const config = await getChannelConfig(kv, resolved.id);
		if (!config) { await ctx.reply('Channel not registered.'); return; }
		config.enabled = false;
		await saveChannelConfig(kv, resolved.id, config);
		await ctx.reply(`❌ <b>${resolved.title}</b> disabled.`, { parse_mode: 'HTML' });
	});

	// ─── Text Input Handler (multi-step flows) ────────────

	bot.on('message:text', async (ctx) => {
		const text = ctx.message.text;
		if (text.startsWith('/')) return;

		const state = await getAdminState(kv, adminId);
		if (!state) {
			await ctx.reply('No active action. Use /start to see commands.');
			return;
		}

		switch (state.action) {
			case 'adding_channel':
				await addChannelDirect(ctx, bot, kv, adminId, text.trim());
				break;
			case 'adding_source':
				await handleAddSourceValue(ctx, bot, kv, env, adminId, state, text);
				break;
			case 'removing_channel':
				await handleRemoveChannelConfirm(ctx, kv, adminId, state, text);
				break;
		}
	});

	// ─── Callback Query Handlers ──────────────────────────
	// IMPORTANT: Use ([^:]+) instead of (.+) to prevent greedy matching through colons

	// Channel list → channel config
	bot.callbackQuery(/^ch:([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		await showChannelConfig(ctx, kv, channelId);
		await ctx.answerCallbackQuery();
	});

	// Toggle channel enabled/disabled
	bot.callbackQuery(/^ch_toggle:([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }

		config.enabled = !config.enabled;
		await saveChannelConfig(kv, channelId, config);
		await showChannelConfig(ctx, kv, channelId);
		await ctx.answerCallbackQuery({ text: config.enabled ? '✅ Enabled' : '❌ Disabled' });
	});

	// Remove channel
	bot.callbackQuery(/^ch_remove:([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const keyboard = new InlineKeyboard()
			.text('Yes, remove it', `ch_remove_confirm:${channelId}`)
			.text('Cancel', `ch:${channelId}`);
		await editOrReply(ctx,
			`Remove channel <code>${channelId}</code>?\n\nThis will delete all its sources.`,
			{ parse_mode: 'HTML', reply_markup: keyboard }
		);
		await ctx.answerCallbackQuery();
	});

	// Confirm channel removal
	bot.callbackQuery(/^ch_remove_confirm:([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const channels = await getChannelsList(kv);
		const updated = channels.filter((id) => id !== channelId);
		await saveChannelsList(kv, updated);
		await kv.delete(`${CACHE_PREFIX_TELEGRAM_CHANNEL}${channelId}:config`);
		await editOrReply(ctx, `Channel <code>${channelId}</code> removed.`, { parse_mode: 'HTML' });
		await ctx.answerCallbackQuery({ text: 'Channel removed' });
	});

	// Add source → source type selection
	bot.callbackQuery(/^add_src:([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const keyboard = new InlineKeyboard()
			.text('👤 Username', `src_type:${channelId}:username`)
			.row()
			.text('#️⃣ Hashtag', `src_type:${channelId}:hashtag`)
			.row()
			.text('📍 Location', `src_type:${channelId}:location`)
			.row()
			.text('« Back', `ch:${channelId}`);

		await editOrReply(ctx, '<b>Select source type:</b>', { parse_mode: 'HTML', reply_markup: keyboard });
		await ctx.answerCallbackQuery();
	});

	// Source type selected → ask for value
	bot.callbackQuery(/^src_type:([^:]+):([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const sourceType = ctx.match[2] as 'username' | 'hashtag' | 'location';
		await setAdminState(kv, adminId, {
			action: 'adding_source',
			context: { channelId, sourceType },
		});

		const prompts: Record<string, string> = {
			username: '👤 Send the Instagram <b>username</b> (without @):',
			hashtag: '#️⃣ Send the <b>hashtag</b> (without #):',
			location: '📍 Send the <b>location ID</b>:',
		};
		await editOrReply(ctx, prompts[sourceType] + '\n\nUse /cancel to abort.', { parse_mode: 'HTML' });
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
		const mediaType = ctx.match[3] as MediaTypeFilter;
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }

		const source = config.sources.find((s) => s.id === sourceId);
		if (!source) { await ctx.answerCallbackQuery({ text: 'Source not found' }); return; }

		source.mediaType = mediaType;
		await saveChannelConfig(kv, channelId, config);
		await showSourceDetail(ctx, channelId, source);
		await ctx.answerCallbackQuery({ text: `Filter: ${mediaType}` });
	});

	// Set check interval options
	bot.callbackQuery(/^set_interval:([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const keyboard = new InlineKeyboard()
			.text('15 min', `interval:${channelId}:15`)
			.text('30 min', `interval:${channelId}:30`)
			.row()
			.text('1 hour', `interval:${channelId}:60`)
			.text('2 hours', `interval:${channelId}:120`)
			.row()
			.text('6 hours', `interval:${channelId}:360`)
			.text('12 hours', `interval:${channelId}:720`)
			.row()
			.text('« Back', `ch:${channelId}`);

		await editOrReply(ctx, '<b>Select check interval:</b>', { parse_mode: 'HTML', reply_markup: keyboard });
		await ctx.answerCallbackQuery();
	});

	// Apply interval
	bot.callbackQuery(/^interval:([^:]+):(\d+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const minutes = parseInt(ctx.match[2], 10);
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }

		config.checkIntervalMinutes = minutes;
		await saveChannelConfig(kv, channelId, config);
		await showChannelConfig(ctx, kv, channelId);
		await ctx.answerCallbackQuery({ text: `Interval: ${minutes} min` });
	});

	// Back to channels list
	bot.callbackQuery('back:channels', async (ctx) => {
		await showChannelsListEdit(ctx, kv);
		await ctx.answerCallbackQuery();
	});

	return bot;
}

// ─── View Helpers ────────────────────────────────────────────

async function showChannelsList(ctx: Context, kv: KVNamespace): Promise<void> {
	const channels = await getChannelsList(kv);
	if (channels.length === 0) {
		await ctx.reply('No channels configured. Use /add to add one.');
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

	await ctx.reply('<b>Your channels:</b>\n\nTap a channel to manage it.', { parse_mode: 'HTML', reply_markup: keyboard });
}

async function showChannelsListEdit(ctx: Context, kv: KVNamespace): Promise<void> {
	const channels = await getChannelsList(kv);
	if (channels.length === 0) {
		await editOrReply(ctx, 'No channels configured. Use /add to add one.');
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

	await editOrReply(ctx, '<b>Your channels:</b>\n\nTap a channel to manage it.', { parse_mode: 'HTML', reply_markup: keyboard });
}

async function showChannelConfig(ctx: Context, kv: KVNamespace, channelId: string): Promise<void> {
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
		`Interval: every ${config.checkIntervalMinutes} min\n`;

	if (config.sources.length === 0) {
		text += '\n<i>No sources — tap + Add Source below</i>';
	} else {
		text += `\n<b>Sources (${config.sources.length}):</b>\n`;
		for (const src of config.sources) {
			const s = src.enabled ? '✅' : '❌';
			text += `${s} ${src.type}: <b>${src.value}</b> [${src.mediaType}]\n`;
		}
	}

	const keyboard = new InlineKeyboard()
		.text(config.enabled ? '❌ Disable' : '✅ Enable', `ch_toggle:${channelId}`)
		.text('⏱ Set Interval', `set_interval:${channelId}`)
		.row()
		.text('+ Add Source', `add_src:${channelId}`)
		.text('🗑 Remove Channel', `ch_remove:${channelId}`)
		.row();

	for (const src of config.sources) {
		const icon = src.enabled ? '✅' : '❌';
		const typeIcon = src.type === 'username' ? '👤' : src.type === 'hashtag' ? '#️⃣' : '📍';
		keyboard.text(`${icon} ${typeIcon} ${src.value}`, `src_detail:${channelId}:${src.id}`).row();
	}

	keyboard.text('« Back to channels', 'back:channels');

	await editOrReply(ctx, text, { parse_mode: 'HTML', reply_markup: keyboard });
}

async function showSourceDetail(ctx: Context, channelId: string, source: ChannelSource): Promise<void> {
	const status = source.enabled ? '✅ Enabled' : '❌ Disabled';
	const typeIcon = source.type === 'username' ? '👤' : source.type === 'hashtag' ? '#️⃣' : '📍';
	const currentFilter = source.mediaType;

	const text =
		`${typeIcon} <b>Source: ${source.value}</b>\n` +
		`Type: ${source.type}\n` +
		`Status: ${status}\n` +
		`Media filter: <b>${currentFilter}</b>`;

	const filters: MediaTypeFilter[] = ['all', 'video', 'picture', 'multiple'];
	const keyboard = new InlineKeyboard()
		.text(source.enabled ? '❌ Disable' : '✅ Enable', `src_toggle:${channelId}:${source.id}`)
		.text('🗑 Remove', `src_remove:${channelId}:${source.id}`)
		.row();

	// Filter buttons — mark current with bullet
	for (const f of filters) {
		const label = f === currentFilter ? `• ${f}` : f;
		keyboard.text(label, `src_filter:${channelId}:${source.id}:${f}`);
	}
	keyboard.row().text('« Back to channel', `ch:${channelId}`);

	await editOrReply(ctx, text, { parse_mode: 'HTML', reply_markup: keyboard });
}

// ─── Multi-step Flow Handlers ────────────────────────────────

async function addChannelDirect(ctx: Context, bot: Bot, kv: KVNamespace, adminId: number, arg: string): Promise<void> {
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
		`✅ <b>${resolved.title}</b> added!\n\nNow subscribe to sources:\n<code>/sub @${arg.replace(/^@/, '')} @iguser</code>`,
		{ parse_mode: 'HTML', reply_markup: keyboard }
	);
}

async function handleAddSourceValue(
	ctx: Context,
	bot: Bot,
	kv: KVNamespace,
	env: Env,
	adminId: number,
	state: AdminState,
	text: string
): Promise<void> {
	const value = text.trim().replace(/^[@#]/, '');
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

	if (config.sources.some((s) => s.type === sourceType && s.value === value)) {
		await clearAdminState(kv, adminId);
		await ctx.reply(`Source "${value}" already exists for this channel.`);
		return;
	}

	const source: ChannelSource = {
		id: `${sourceType}_${value}`,
		type: sourceType,
		value,
		mediaType: 'all',
		enabled: true,
	};

	config.sources.push(source);
	await saveChannelConfig(kv, channelId, config);
	await clearAdminState(kv, adminId);

	const keyboard = new InlineKeyboard()
		.text('View channel', `ch:${channelId}`)
		.text('+ Add another', `add_src:${channelId}`);

	await ctx.reply(
		`✅ Source added: <b>${sourceType}</b> — <code>${value}</code>\n\nFetching latest posts...`,
		{ parse_mode: 'HTML', reply_markup: keyboard }
	);

	// Fetch and send latest posts immediately
	await fetchAndSendLatest(bot, kv, parseInt(channelId, 10), source, env);
}

async function handleRemoveChannelConfirm(
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

// ─── Fetch & Send Latest Posts on Subscribe ─────────────────

async function fetchAndSendLatest(
	bot: Bot,
	kv: KVNamespace,
	chatId: number,
	source: ChannelSource,
	env: Env,
	count: number = 1
): Promise<void> {
	try {
		const context: FeedContext = { type: source.type, value: source.value };
		const result = await fetchInstagramData(context, env);
		if (result.nodes.length === 0) {
			if (result.errors.length > 0) {
				const errorSummary = result.errors
					.map((e) => `- ${e.tier}: ${e.message}${e.status ? ` (HTTP ${e.status})` : ''}`)
					.join('\n');
				try {
					await bot.api.sendMessage(
						chatId,
						`Failed to fetch posts for <b>${source.value}</b>:\n\n<pre>${errorSummary}</pre>\n\nUse /debug to diagnose.`,
						{ parse_mode: 'HTML' }
					);
				} catch (sendErr) {
					console.error('Failed to send error notification:', sendErr);
				}
			}
			return;
		}
		const nodes = result.nodes;

		// Send latest posts (oldest first)
		const posts = nodes.slice(0, count).reverse();
		for (const post of posts) {
			try {
				const message = formatMediaForTelegram(post);
				await sendMediaToChannel(bot, chatId, message);
			} catch (err) {
				console.error(`Failed to send post ${post.shortcode}:`, err);
			}
		}

		// Set lastseen to most recent post so cron doesn't re-send
		const lastSeenKey = `${CACHE_PREFIX_TELEGRAM_LASTSEEN}${chatId}:${source.id}`;
		await setCached(kv, lastSeenKey, nodes[0].shortcode, TELEGRAM_CONFIG_TTL);
	} catch (err) {
		console.error(`fetchAndSendLatest error for ${source.value}:`, err);
	}
}

// ─── Send Media to Channel ──────────────────────────────────

export async function sendMediaToChannel(
	bot: Bot,
	chatId: number,
	message: TelegramMediaMessage
): Promise<void> {
	switch (message.type) {
		case 'photo':
			await bot.api.sendPhoto(chatId, message.url!, { caption: message.caption, parse_mode: 'HTML' });
			break;

		case 'video':
			await bot.api.sendVideo(chatId, message.url!, {
				caption: message.caption,
				parse_mode: 'HTML',
			});
			break;

		case 'mediagroup': {
			if (!message.media || message.media.length === 0) return;
			const media = message.media.map((item) => {
				if (item.type === 'video') {
					return InputMediaBuilder.video(item.media, {
						caption: item.caption,
						parse_mode: item.parse_mode as 'HTML' | undefined,
					});
				}
				return InputMediaBuilder.photo(item.media, {
					caption: item.caption,
					parse_mode: item.parse_mode as 'HTML' | undefined,
				});
			});
			await bot.api.sendMediaGroup(chatId, media);
			break;
		}
	}
}
