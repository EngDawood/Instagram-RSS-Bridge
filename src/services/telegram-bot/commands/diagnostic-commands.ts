import type { Bot } from 'grammy';
import type { ChannelSource } from '../../../types/telegram';
import { parseSourceRef } from '../helpers/source-parser';
import { fetchForSource } from '../../instagram-fetcher';
import { formatFeedItem } from '../../../utils/telegram-format';
import { sendMediaToChannel } from '../handlers/send-media';
import { escapeHtml as escapeHtmlBot } from '../../../utils/text';
import { buildHeaders } from '../../../utils/headers';
import { IG_WEB_PROFILE, IG_TOP_SEARCH } from '../../../constants';

/**
 * Register diagnostic and testing commands.
 */
export function registerDiagnosticCommands(bot: Bot, env: Env, kv: KVNamespace): void {
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
			const result = await fetchForSource(source, env);

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

		await ctx.reply(lines.join('\n'), {
			parse_mode: 'HTML',
			reply_markup: new InlineKeyboard().text('Test Callback (Ping)', 'ping_test')
		});
	});

	// Simple ping test handler
	bot.callbackQuery('ping_test', async (ctx) => {
		await ctx.answerCallbackQuery({ text: 'Pong! Callback system is working.', show_alert: true });
	});
}
