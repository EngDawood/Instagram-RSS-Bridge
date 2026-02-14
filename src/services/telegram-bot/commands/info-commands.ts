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
				'/sub @channel @iguser — Subscribe to IG user\n' +
				'/sub @channel #hashtag — Subscribe to IG hashtag\n' +
				'/sub @channel https://... — Subscribe to RSS feed\n' +
				'/unsub @channel source — Unsubscribe\n' +
				'/list — List all subscriptions\n' +
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
				'<code>/list</code> — show all subs\n' +
				'<code>/delay @mychannel 60</code> — every 1h\n' +
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
}
