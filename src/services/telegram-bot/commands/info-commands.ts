import type { Bot } from 'grammy';
import { clearAdminState } from '../storage/admin-state';

/**
 * Register basic information and control commands.
 */
export function registerInfoCommands(bot: Bot, env: Env, kv: KVNamespace): void {
	const adminId = parseInt(env.ADMIN_TELEGRAM_ID, 10);

	bot.command('start', async (ctx) => {
		await ctx.reply(
			'<b>RSS Feed Bridge Bot</b>\n\n' +
				'<b>Quick Commands:</b>\n' +
				'/sub @dawood_rss @dawo5d — Subscribe to IG user\n' +
				'/sub @dawood_rss #hashtag — Subscribe to IG hashtag\n' +
				'/sub @dawood_rss https://... — Subscribe to RSS feed\n' +
				'/unsub @dawood_rss source — Unsubscribe\n' +
				'/list — List all subscriptions\n' +
				'/delay @dawood_rss 30 — Set check delay (min)\n\n' +
				'<b>Format:</b>\n' +
				'/set @dawood_rss source — Source format settings\n' +
				'/set_default @dawood_rss — Channel default format\n\n' +
				'<b>Management:</b>\n' +
				'/channels — List & manage channels\n' +
				'/add @dawood_rss — Register a channel\n' +
				'/status — Status overview\n' +
				'/enable @dawood_rss — Enable channel\n' +
				'/disable @dawood_rss — Disable channel\n' +
				'/test source — Fetch & send latest post\n' +
				'/debug @dawo5d — Test Instagram connectivity\n\n' +
				'/cancel — Cancel current action\n' +
				'/help — Full help',
			{ parse_mode: 'HTML' }
		);
	});

	bot.command('help', async (ctx) => {
		await ctx.reply(
			'<b>How to use:</b>\n\n' +
				'1. Add the bot to your Telegram channel as admin\n' +
				'2. Register: <code>/add @dawood_rss</code>\n' +
				'3. Subscribe: <code>/sub @dawood_rss @dawo5d</code>\n' +
				'4. The bot auto-checks for new posts!\n\n' +
				'<b>Source types:</b>\n' +
				'<code>@dawo5d</code> — Instagram user\n' +
				'<code>#hashtag</code> — Instagram hashtag\n' +
				'<code>https://example.com/feed.xml</code> — RSS/Atom feed\n\n' +
				'<b>Examples:</b>\n' +
				'<code>/sub @dawood_rss @edraakorg</code> — IG user\n' +
				'<code>/sub @dawood_rss #photography</code> — hashtag\n' +
				'<code>/sub @dawood_rss https://feeds.bbci.co.uk/news/rss.xml</code> — RSS\n' +
				'<code>/unsub @dawood_rss @dawo5d</code> — remove\n' +
				'<code>/list</code> — show all subs\n' +
				'<code>/delay @dawood_rss 60</code> — every 1h\n' +
				'<code>/set @dawood_rss @natgeo</code> — format settings\n' +
				'<code>/set_default @dawood_rss</code> — channel defaults\n' +
				'<code>/debug @dawo5d</code> — test IG connectivity\n\n' +
				'You can use @dawood_rss or channel ID (-100xxx)',
			{ parse_mode: 'HTML' }
		);
	});

	bot.command('cancel', async (ctx) => {
		await clearAdminState(kv, adminId);
		await ctx.reply('Action cancelled.');
	});
}
