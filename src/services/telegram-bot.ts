import { Bot, InlineKeyboard, InputMediaBuilder } from 'grammy';
import type { Context } from 'grammy';
import type { ChannelConfig, ChannelSource, SourceType, AdminState, TelegramMediaMessage, FormatSettings } from '../types/telegram';
import type { FeedMediaFilter, FetchResult } from '../types/feed';
import { fetchFeed } from './feed-fetcher';
import { fetchInstagramUser, fetchInstagramTag } from './instagram-fetcher';
import { resolveUserId } from './user-resolver';
import { formatFeedItem, resolveFormatSettings } from '../utils/telegram-format';
import { buildHeaders } from '../utils/headers';
import { escapeHtml as escapeHtmlBot } from '../utils/text';
import { getCached, setCached } from '../utils/cache';
import {
	IG_WEB_PROFILE,
	IG_TOP_SEARCH,
	CACHE_KEY_TELEGRAM_CHANNELS,
	CACHE_PREFIX_TELEGRAM_CHANNEL,
	CACHE_PREFIX_TELEGRAM_LASTSEEN,
	CACHE_PREFIX_TELEGRAM_STATE,
	TELEGRAM_CONFIG_TTL,
	DEFAULT_FORMAT_SETTINGS,
	FORMAT_LABELS,
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

// ─── Source Helpers ──────────────────────────────────────────

/** Generate a short hash for a URL to use as source ID suffix. */
function shortHash(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
	}
	return Math.abs(hash).toString(36);
}

/** Parse a source reference into type + value. */
function parseSourceRef(ref: string): { type: SourceType; value: string; id: string } | null {
	if (ref.startsWith('http://') || ref.startsWith('https://')) {
		return { type: 'rss_url', value: ref, id: `rss_${shortHash(ref)}` };
	}
	if (ref.startsWith('#')) {
		const value = ref.replace(/^#/, '');
		return { type: 'instagram_tag', value, id: `ig_tag_${value}` };
	}
	// Default: Instagram user (strip @ if present)
	const value = ref.replace(/^@/, '');
	return { type: 'instagram_user', value, id: `ig_user_${value}` };
}

/** Route to correct fetcher based on source type (with legacy shim). */
function fetchForSource(source: ChannelSource): Promise<FetchResult> {
	const type = source.type as string;
	switch (type) {
		case 'instagram_user':
		case 'username': // legacy
			return fetchInstagramUser(source.value);
		case 'instagram_tag':
		case 'hashtag': // legacy
			return fetchInstagramTag(source.value);
		case 'rss_url':
			return fetchFeed(source.value);
		default:
			return Promise.resolve({
				items: [],
				feedTitle: '',
				feedLink: '',
				errors: [{ tier: 'config', message: `Unknown source type: ${source.type}` }],
			});
	}
}

/** Icon for source type. */
function sourceTypeIcon(type: string): string {
	switch (type) {
		case 'instagram_user':
		case 'username': // legacy
			return '👤';
		case 'instagram_tag':
		case 'hashtag': // legacy
			return '#️⃣';
		case 'rss_url':
			return '🌐';
		default:
			return '📡';
	}
}

/** Display name for source type. */
function sourceTypeLabel(type: string): string {
	switch (type) {
		case 'instagram_user':
		case 'username':
			return 'IG User';
		case 'instagram_tag':
		case 'hashtag':
			return 'IG Tag';
		case 'rss_url':
			return 'RSS';
		default:
			return type;
	}
}

// ─── Format Settings Helpers ─────────────────────────────────

const FORMAT_SETTING_KEYS: (keyof FormatSettings)[] = [
	'notification', 'media', 'author', 'sourceFormat', 'linkPreview', 'lengthLimit',
];

/** Get the next option value for a setting (cycles through options list). */
function cycleFormatValue(setting: keyof FormatSettings, current: string): string {
	const options = FORMAT_LABELS[setting].options;
	const idx = options.findIndex((o) => o.value === current);
	return options[(idx + 1) % options.length].value;
}

/** Get display text for a setting's current value. */
function formatValueText(setting: keyof FormatSettings, value: string): string {
	const opt = FORMAT_LABELS[setting].options.find((o) => o.value === value);
	return opt?.text ?? value;
}

/** Build RSStT-style format settings keyboard (one button per setting, click to cycle). */
function buildFormatKeyboard(
	current: FormatSettings,
	callbackPrefix: string, // 'fs:CHID:SRCID' or 'fd:CHID'
	backCallback: string,
	resetCallback: string
): InlineKeyboard {
	const kb = new InlineKeyboard();
	kb.text('Reset to defaults', resetCallback).row();
	for (const key of FORMAT_SETTING_KEYS) {
		const label = FORMAT_LABELS[key].label;
		const valueText = formatValueText(key, String(current[key]));
		kb.text(`${label}: ${valueText}`, `${callbackPrefix}:${key}`).row();
	}
	kb.text('Cancel', backCallback);
	return kb;
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
			'<b>RSS Feed Bridge Bot</b>\n\n' +
				'<b>Quick Commands:</b>\n' +
				'/sub @channel @iguser — Subscribe to IG user\n' +
				'/sub @channel #hashtag — Subscribe to IG hashtag\n' +
				'/sub @channel https://... — Subscribe to RSS feed\n' +
				'/unsub @channel source — Unsubscribe\n' +
				'/interval @channel 30 — Set check interval (min)\n\n' +
				'<b>Format:</b>\n' +
				'/set @channel source — Source format settings\n' +
				'/set_default @channel — Channel default format\n\n' +
				'<b>Management:</b>\n' +
				'/channels — List & manage channels\n' +
				'/add @channel — Register a channel\n' +
				'/status — Status overview\n' +
				'/enable @channel — Enable channel\n' +
				'/disable @channel — Disable channel\n' +
				'/test source — Fetch & send latest post\n' +
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
				'<b>Source types:</b>\n' +
				'<code>@username</code> — Instagram user\n' +
				'<code>#hashtag</code> — Instagram hashtag\n' +
				'<code>https://example.com/feed.xml</code> — RSS/Atom feed\n\n' +
				'<b>Examples:</b>\n' +
				'<code>/sub @mychannel @cristiano</code> — IG user\n' +
				'<code>/sub @mychannel #photography</code> — hashtag\n' +
				'<code>/sub @mychannel https://feeds.bbci.co.uk/news/rss.xml</code> — RSS\n' +
				'<code>/unsub @mychannel @cristiano</code> — remove\n' +
				'<code>/interval @mychannel 60</code> — every 1h\n' +
				'<code>/set @mychannel @natgeo</code> — format settings\n' +
				'<code>/set_default @mychannel</code> — channel defaults\n' +
				'<code>/debug @natgeo</code> — test IG connectivity\n\n' +
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

	// /test <source> — Fetch and send the latest post from any source
	bot.command('test', async (ctx) => {
		const arg = ctx.match?.trim() || '';
		if (!arg) {
			await ctx.reply('Usage: <code>/test @username</code> or <code>/test https://feed-url</code>', { parse_mode: 'HTML' });
			return;
		}

		const parsed = parseSourceRef(arg);
		if (!parsed) {
			await ctx.reply('Invalid source. Use @username, #hashtag, or a feed URL.');
			return;
		}

		await ctx.reply(`Fetching latest from <b>${escapeHtmlBot(parsed.value)}</b>...`, { parse_mode: 'HTML' });

		try {
			const source: ChannelSource = {
				id: parsed.id,
				type: parsed.type,
				value: parsed.value,
				mediaFilter: 'all',
				enabled: true,
			};
			const result = await fetchForSource(source);

			if (result.items.length === 0) {
				const errorInfo = result.errors.length > 0
					? result.errors.map((e) => `- ${e.tier}: ${e.message}`).join('\n')
					: 'No items found';
				await ctx.reply(`No data for <b>${escapeHtmlBot(parsed.value)}</b>:\n<pre>${errorInfo}</pre>`, { parse_mode: 'HTML' });
				return;
			}

			const latest = result.items[0];
			const message = formatFeedItem(latest);
			await sendMediaToChannel(bot, ctx.chat!.id, message);
		} catch (err: any) {
			await ctx.reply(`Error: ${err.message || String(err)}`);
		}
	});

	// /debug [@username] — Quick Instagram connectivity test
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
		let postCount = 1;
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
		await ctx.reply(
			`✅ <b>${resolved.title}</b> subscribed to ${typeLabel}: <b>${escapeHtmlBot(parsed.value)}</b>\n\nFetching latest posts...`,
			{ parse_mode: 'HTML' }
		);

		// Fetch and send latest posts immediately
		await fetchAndSendLatest(bot, kv, parseInt(resolved.id, 10), source, postCount);
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

	// ─── Format Settings Commands ────────────────────────

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
		const resolved = await resolveChannelArg(bot, kv, channelRef);
		if (!resolved) { await ctx.reply(`Channel "${channelRef}" not found.`); return; }
		const config = await getChannelConfig(kv, resolved.id);
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
			`fs:${resolved.id}:${source.id}`,
			`src_detail:${resolved.id}:${source.id}`,
			`fs_r:${resolved.id}:${source.id}`
		);
		await ctx.reply(
			`<b>Format settings for ${escapeHtmlBot(source.value)}</b>\n` +
			`Channel: <b>${config.channelTitle}</b>`,
			{ parse_mode: 'HTML', reply_markup: keyboard }
		);
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
				await handleAddSourceValue(ctx, bot, kv, adminId, state, text);
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
			.text('👤 Instagram User', `src_type:${channelId}:instagram_user`)
			.row()
			.text('#️⃣ Instagram Tag', `src_type:${channelId}:instagram_tag`)
			.row()
			.text('🌐 RSS/Atom URL', `src_type:${channelId}:rss_url`)
			.row()
			.text('« Back', `ch:${channelId}`);

		await editOrReply(ctx, '<b>Select source type:</b>', { parse_mode: 'HTML', reply_markup: keyboard });
		await ctx.answerCallbackQuery();
	});

	// Source type selected → ask for value
	bot.callbackQuery(/^src_type:([^:]+):([^:]+)$/, async (ctx) => {
		const channelId = ctx.match[1];
		const sourceType = ctx.match[2] as SourceType;
		await setAdminState(kv, adminId, {
			action: 'adding_source',
			context: { channelId, sourceType },
		});

		const prompts: Record<string, string> = {
			instagram_user: '👤 Send the Instagram <b>username</b> (without @):',
			instagram_tag: '#️⃣ Send the <b>hashtag</b> (without #):',
			rss_url: '🌐 Send the <b>RSS/Atom feed URL</b>:',
		};
		await editOrReply(ctx, (prompts[sourceType] || 'Send the value:') + '\n\nUse /cancel to abort.', { parse_mode: 'HTML' });
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
		const mediaFilter = ctx.match[3] as FeedMediaFilter;
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }

		const source = config.sources.find((s) => s.id === sourceId);
		if (!source) { await ctx.answerCallbackQuery({ text: 'Source not found' }); return; }

		source.mediaFilter = mediaFilter;
		await saveChannelConfig(kv, channelId, config);
		await showSourceDetail(ctx, channelId, source);
		await ctx.answerCallbackQuery({ text: `Filter: ${mediaFilter}` });
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

	// ─── Format Settings Callbacks ───────────────────────

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
		const nextVal = cycleFormatValue(setting, String(current[setting]));
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
		console.log('[DEBUG] fd handler matched:', ctx.callbackQuery.data);
		const channelId = ctx.match[1];
		const setting = ctx.match[2] as keyof FormatSettings;
		const config = await getChannelConfig(kv, channelId);
		if (!config) { await ctx.answerCallbackQuery({ text: 'Channel not found' }); return; }

		if (!config.defaultFormat) config.defaultFormat = {};
		const current = resolveFormatSettings(config.defaultFormat);
		const nextVal = cycleFormatValue(setting, String(current[setting]));
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

	// Back to channels list
	bot.callbackQuery('back:channels', async (ctx) => {
		await showChannelsListEdit(ctx, kv);
		await ctx.answerCallbackQuery();
	});

	// Debug: catch-all for unmatched callback queries
	bot.on('callback_query:data', async (ctx) => {
		console.log('[DEBUG] Unmatched callback:', ctx.callbackQuery.data);
		await ctx.answerCallbackQuery({ text: `Unknown: ${ctx.callbackQuery.data?.substring(0, 30)}` });
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
			const icon = sourceTypeIcon(src.type);
			const filter = src.mediaFilter ?? (src as any).mediaType ?? 'all';
			text += `${s} ${icon} <b>${escapeHtmlBot(src.value)}</b> [${filter}]\n`;
		}
	}

	const keyboard = new InlineKeyboard()
		.text(config.enabled ? '❌ Disable' : '✅ Enable', `ch_toggle:${channelId}`)
		.text('⏱ Set Interval', `set_interval:${channelId}`)
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

async function showSourceDetail(ctx: Context, channelId: string, source: ChannelSource): Promise<void> {
	const status = source.enabled ? '✅ Enabled' : '❌ Disabled';
	const icon = sourceTypeIcon(source.type);
	const currentFilter = source.mediaFilter ?? (source as any).mediaType ?? 'all';

	const text =
		`${icon} <b>Source: ${escapeHtmlBot(source.value)}</b>\n` +
		`Type: ${sourceTypeLabel(source.type)}\n` +
		`Status: ${status}\n` +
		`Media filter: <b>${currentFilter}</b>`;

	const filters: FeedMediaFilter[] = ['all', 'photo', 'video', 'album'];
	const keyboard = new InlineKeyboard()
		.text(source.enabled ? '❌ Disable' : '✅ Enable', `src_toggle:${channelId}:${source.id}`)
		.text('🗑 Remove', `src_remove:${channelId}:${source.id}`)
		.row();

	// Filter buttons — mark current with bullet
	for (const f of filters) {
		const label = f === currentFilter ? `• ${f}` : f;
		keyboard.text(label, `src_filter:${channelId}:${source.id}:${f}`);
	}
	keyboard.row()
		.text('Format', `fs_v:${channelId}:${source.id}`)
		.row()
		.text('« Back to channel', `ch:${channelId}`);

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
		`✅ <b>${resolved.title}</b> added!\n\nNow subscribe to sources:\n<code>/sub @${arg.replace(/^@/, '')} @iguser</code> or\n<code>/sub @${arg.replace(/^@/, '')} https://feed-url</code>`,
		{ parse_mode: 'HTML', reply_markup: keyboard }
	);
}

async function handleAddSourceValue(
	ctx: Context,
	bot: Bot,
	kv: KVNamespace,
	adminId: number,
	state: AdminState,
	text: string
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
	const id = sourceType === 'rss_url' ? `rss_${shortHash(value)}` : `${sourceType}_${value}`;

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
	await fetchAndSendLatest(bot, kv, parseInt(channelId, 10), source);
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
	count: number = 1
): Promise<void> {
	try {
		const result = await fetchForSource(source);
		if (result.items.length === 0) {
			if (result.errors.length > 0) {
				const errorSummary = result.errors
					.map((e) => `- ${e.tier}: ${e.message}${e.status ? ` (HTTP ${e.status})` : ''}`)
					.join('\n');
				try {
					await bot.api.sendMessage(
						chatId,
						`Failed to fetch for <b>${escapeHtmlBot(source.value)}</b>:\n\n<pre>${errorSummary}</pre>`,
						{ parse_mode: 'HTML' }
					);
				} catch (sendErr) {
					console.error('Failed to send error notification:', sendErr);
				}
			}
			return;
		}

		// Send latest posts (oldest first)
		const items = result.items.slice(0, count).reverse();
		for (const item of items) {
			try {
				const message = formatFeedItem(item);
				await sendMediaToChannel(bot, chatId, message);
			} catch (err) {
				console.error(`Failed to send item ${item.id}:`, err);
			}
		}

		// Set lastseen to most recent item so cron doesn't re-send
		const lastSeenKey = `${CACHE_PREFIX_TELEGRAM_LASTSEEN}${chatId}:${source.id}`;
		await setCached(kv, lastSeenKey, result.items[0].id, TELEGRAM_CONFIG_TTL);
	} catch (err) {
		console.error(`fetchAndSendLatest error for ${source.value}:`, err);
	}
}

// ─── Send Media to Channel ──────────────────────────────────

export async function sendMediaToChannel(
	bot: Bot,
	chatId: number,
	message: TelegramMediaMessage,
	settings?: FormatSettings
): Promise<void> {
	const disableNotification = settings?.notification === 'muted';

	switch (message.type) {
		case 'text':
			await bot.api.sendMessage(chatId, message.caption, {
				parse_mode: 'HTML',
				disable_notification: disableNotification,
				link_preview_options: settings?.linkPreview === 'disable' ? { is_disabled: true } : undefined,
			});
			break;

		case 'photo':
			await bot.api.sendPhoto(chatId, message.url!, {
				caption: message.caption,
				parse_mode: 'HTML',
				disable_notification: disableNotification,
			});
			break;

		case 'video':
			await bot.api.sendVideo(chatId, message.url!, {
				caption: message.caption,
				parse_mode: 'HTML',
				disable_notification: disableNotification,
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
			await bot.api.sendMediaGroup(chatId, media, {
				disable_notification: disableNotification,
			});
			break;
		}
	}
}
