import type { Bot } from 'grammy';
import { clearAdminState } from '../storage/admin-state';
import { BOT_COMMANDS } from '../../../routes/setup';

/**
 * Register basic information and control commands.
 */
export function registerInfoCommands(bot: Bot, env: Env, kv: KVNamespace): void {
	const adminId = parseInt(env.ADMIN_TELEGRAM_ID, 10);

	bot.command('start', async (ctx) => {
		await ctx.reply(
			'<b>RSS Feed Bridge Bot</b>\n\n' +
				'<b>Subscriptions:</b>\n' +
				'/sub @dawood_rss @edraakorg — Subscribe to IG user\n' +
				'/sub @dawood_rss #hashtag — Subscribe to IG hashtag\n' +
				'/sub @dawood_rss tiktok @username — Subscribe to TikTok user\n' +
				'/sub @dawood_rss https://... — Subscribe to RSS feed\n' +
				'/unsub @dawood_rss source — Unsubscribe\n' +
				'/list — List all subscriptions\n' +
				'/seed @dawood_rss — Mark all sources as read\n' +
				'/seed @dawood_rss @edraakorg — Mark single source as read\n' +
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
				'/debug @edraakorg — Test Instagram connectivity\n\n' +
				'<b>Media Download:</b>\n' +
				'Send a URL (TikTok, IG, X, YouTube, etc.) to download media\n\n' +
				'/cancel — Cancel current action\n' +
				'/help — Full help',
			{ parse_mode: 'HTML' }
		);
		await ctx.api.setMyCommands(BOT_COMMANDS).catch(() => {});
	});

	bot.command('help', async (ctx) => {
		await ctx.reply(
			'<b>How to use:</b>\n\n' +
				'1. Add the bot to your Telegram channel as admin\n' +
				'2. Register: <code>/add @dawood_rss</code>\n' +
				'3. Subscribe: <code>/sub @dawood_rss @iguser</code>\n' +
				'4. The bot auto-checks for new posts!\n\n' +
				'<b>Source types:</b>\n' +
				'<code>@username</code> — Instagram user\n' +
				'<code>#hashtag</code> — Instagram hashtag\n' +
				'<code>https://example.com/feed.xml</code> — RSS/Atom feed\n\n' +
				'<b>Examples:</b>\n' +
				'<code>/sub @dawood_rss @edraakorg</code> — IG user\n' +
				'<code>/sub @dawood_rss #photography</code> — hashtag\n' +
				'<code>/sub @dawood_rss https://feeds.bbci.co.uk/news/rss.xml</code> — RSS\n' +
				'<code>/unsub @dawood_rss @edraakorg</code> — remove\n' +
				'<code>/seed @dawood_rss</code> — mark all as read (no send)\n' +
				'<code>/seed @dawood_rss @edraakorg</code> — mark one as read\n' +
				'<code>/list</code> — show all subs\n' +
				'<code>/delay @dawood_rss 60</code> — every 1h\n' +
				'<code>/set @dawood_rss @natgeo</code> — format settings\n' +
				'<code>/set_default @dawood_rss</code> — channel defaults\n' +
				'<code>/debug @edraakorg</code> — test IG connectivity\n\n' +
				'<b>Media Download:</b>\n' +
				'Send a supported URL to download media directly.\n' +
				'Supported: TikTok, Instagram, X/Twitter, YouTube,\n' +
				'Facebook, Threads, SoundCloud, Spotify, Pinterest\n\n' +
				'You can use @dawood_rss or channel ID (-100xxx)',
			{ parse_mode: 'HTML' }
		);
	});

	bot.command('cancel', async (ctx) => {
		await clearAdminState(kv, adminId);
		await ctx.reply('Action cancelled.');
	});
}
