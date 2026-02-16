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
				'<b>Subscriptions:</b>\n' +
				'/sub @channel @user — Subscribe to IG user\n' +
				'/sub @channel #hashtag — Subscribe to IG hashtag\n' +
				'/sub @channel https://... — Subscribe to RSS feed\n' +
				'/unsub @channel source — Unsubscribe\n' +
				'/list — List all subscriptions\n' +
				'/seed @channel — Mark all sources as read\n' +
				'/seed @channel @user — Mark single source as read\n' +
				'/delay @channel 30 — Set check delay (min)\n\n' +
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
				'/debug @user — Test Instagram connectivity\n\n' +
				'<b>Media Download:</b>\n' +
				'Send a URL (TikTok, IG, X, YouTube, etc.) to download media\n\n' +
				'/cancel — Cancel current action\n' +
				'/help — Full help',
			{ parse_mode: 'HTML' }
		);
	});

	bot.command('help', async (ctx) => {
		await ctx.reply(
			'<b>How to use:</b>\n\n' +
				'1. Add the bot to your Telegram channel as admin\n' +
				'2. Register: <code>/add @channel</code>\n' +
				'3. Subscribe: <code>/sub @channel @iguser</code>\n' +
				'4. The bot auto-checks for new posts!\n\n' +
				'<b>Source types:</b>\n' +
				'<code>@username</code> — Instagram user\n' +
				'<code>#hashtag</code> — Instagram hashtag\n' +
				'<code>https://example.com/feed.xml</code> — RSS/Atom feed\n\n' +
				'<b>Examples:</b>\n' +
				'<code>/sub @channel @edraakorg</code> — IG user\n' +
				'<code>/sub @channel #photography</code> — hashtag\n' +
				'<code>/sub @channel https://feeds.bbci.co.uk/news/rss.xml</code> — RSS\n' +
				'<code>/unsub @channel @user</code> — remove\n' +
				'<code>/seed @channel</code> — mark all as read (no send)\n' +
				'<code>/seed @channel @user</code> — mark one as read\n' +
				'<code>/list</code> — show all subs\n' +
				'<code>/delay @channel 60</code> — every 1h\n' +
				'<code>/set @channel @natgeo</code> — format settings\n' +
				'<code>/set_default @channel</code> — channel defaults\n' +
				'<code>/debug @user</code> — test IG connectivity\n\n' +
				'<b>Media Download:</b>\n' +
				'Send a supported URL to download media directly.\n' +
				'Supported: TikTok, Instagram, X/Twitter, YouTube,\n' +
				'Facebook, Threads, SoundCloud, Spotify, Pinterest\n\n' +
				'You can use @channel or channel ID (-100xxx)',
			{ parse_mode: 'HTML' }
		);
	});

	bot.command('cancel', async (ctx) => {
		await clearAdminState(kv, adminId);
		await ctx.reply('Action cancelled.');
	});
}
