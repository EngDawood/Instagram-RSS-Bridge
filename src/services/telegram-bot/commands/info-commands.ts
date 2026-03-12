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
			'<b>Welcome to RSS Feed Bridge!</b>\n\n' +
				'I help you track Instagram profiles, TikTok users, and RSS feeds, and automatically post updates to your Telegram channels.\n\n' +
				'<b>Quick Subscriptions:</b>\n' +
				'/sub @channel @user — Subscribe to IG user\n' +
				'/sub @channel #tag — Subscribe to IG hashtag\n' +
				'/sub @channel tiktok @user — Subscribe to TikTok user\n' +
				'/sub @channel https://... — Subscribe to RSS feed\n' +
				'/unsub @channel source — Unsubscribe\n\n' +
				'<b>Management:</b>\n' +
				'/channels — Manage your channels\n' +
				'/add @channel — Register a new channel\n' +
				'/list — See all active subscriptions\n' +
				'/status — Overview of all channels\n\n' +
				'<b>Configuration:</b>\n' +
				'/set @channel source — Custom format for a source\n' +
				'/set_default @channel — Default format for a channel\n' +
				'/delay @channel 30 — Set check interval (min)\n\n' +
				'<b>More:</b>\n' +
				'• Send any supported URL (TikTok, IG, X, YT) to download media\n' +
				'• Use /folo for Folo integration\n' +
				'• Use /cancel to stop any current action\n' +
				'• Use /help for detailed instructions',
			{ parse_mode: 'HTML' }
		);
		await ctx.api.setMyCommands(BOT_COMMANDS).catch(() => {});
	});

	bot.command('help', async (ctx) => {
		await ctx.reply(
			'<b>Getting Started:</b>\n\n' +
				'1. Add this bot to your Telegram channel as an administrator.\n' +
				'2. Link the channel: <code>/add @your_channel_name</code>\n' +
				'3. Subscribe to a source: <code>/sub @your_channel_name @instagram_user</code>\n' +
				'4. Sit back! The bot will now automatically check for and post updates.\n\n' +
				'<b>Supported Source Types:</b>\n' +
				'• <code>@username</code> — Instagram profile\n' +
				'• <code>#hashtag</code> — Instagram hashtag\n' +
				'• <code>tiktok @username</code> — TikTok profile\n' +
				'• <code>https://...</code> — Any valid RSS/Atom feed URL\n\n' +
				'<b>Helpful Examples:</b>\n' +
				'• <code>/sub @my_channel @natgeo</code>\n' +
				'• <code>/sub @my_channel #nature</code>\n' +
				'• <code>/unsub @my_channel @natgeo</code>\n' +
				'• <code>/delay @my_channel 60</code> (check every hour)\n\n' +
				'<b>Media Download:</b>\n' +
				'Simply paste a link from TikTok, Instagram, X/Twitter, YouTube, Facebook, Threads, SoundCloud, Spotify, or Pinterest to download and receive the media file directly.\n\n' +
				'<b>Folo Integration:</b>\n' +
				'Use <code>/folo</code> to manage your Folo webhook subscriptions.',
			{ parse_mode: 'HTML' }
		);
	});

	bot.command('cancel', async (ctx) => {
		await clearAdminState(kv, adminId);
		await ctx.reply('Current action cancelled. How else can I help?');
	});
}
