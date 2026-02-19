import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import { getAdminState, setAdminState } from '../storage/admin-state';
import { addChannelDirect } from './add-channel-flow';
import { handleAddSourceValue, handleRemoveChannelConfirm } from './add-source-flow';
import { detectMediaUrl } from '../../../utils/url-detector';
import { downloadAndSendMedia } from './download-and-send';
import { fetchYouTubeQualities, fetchTikTokInfo } from '../../media-downloader';

/**
 * Register the main text handler to process multi-step admin flows.
 */
export function registerTextInputHandler(bot: Bot, env: Env, kv: KVNamespace): void {
	const adminId = parseInt(env.ADMIN_TELEGRAM_ID, 10);

	bot.on('message:text', async (ctx) => {
		const text = ctx.message.text;
		if (text.startsWith('/')) return;

		// Detect supported media URLs before checking admin state
		const detected = detectMediaUrl(text);
		if (detected) {
			const { platform, url } = detected;

			// YouTube — fetch qualities and show picker
			if (platform === 'YouTube') {
				const statusMsg = await ctx.reply('Fetching available qualities...');
				const ytInfo = await fetchYouTubeQualities(url);
				if (ytInfo && ytInfo.qualities.length > 0) {
					const keyboard = new InlineKeyboard();
					// Add quality buttons (max 4 per row)
					for (const q of ytInfo.qualities.slice(0, 4)) {
						const label = q.size ? `${q.quality} (${q.size})` : q.quality;
						keyboard.text(label, `dl:yt:${q.quality}`);
					}
					keyboard.row().text('Audio', 'dl:audio');
					await bot.api.editMessageText(
						ctx.chat!.id,
						statusMsg.message_id,
						`<b>${platform}</b> — Choose quality:`,
						{ parse_mode: 'HTML', reply_markup: keyboard }
					);
					await setAdminState(kv, adminId, {
						action: 'downloading_media',
						context: {
							downloadUrl: url,
							downloadPlatform: platform,
							qualities: ytInfo.qualities,
							downloadCaption: ytInfo.caption,
						},
					});
				} else {
					// Fallback: simple video/audio picker
					const keyboard = new InlineKeyboard()
						.text('Video', 'dl:video')
						.text('Audio', 'dl:audio');
					await bot.api.editMessageText(
						ctx.chat!.id,
						statusMsg.message_id,
						`<b>${platform}</b> — Choose format:`,
						{ parse_mode: 'HTML', reply_markup: keyboard }
					);
					await setAdminState(kv, adminId, {
						action: 'downloading_media',
						context: { downloadUrl: url, downloadPlatform: platform },
					});
				}
				return;
			}

			// TikTok — fetch info for sizes, then show HD / SD / Audio
			if (platform === 'TikTok') {
				const statusMsg = await ctx.reply('Fetching video info...');
				const ttInfo = await fetchTikTokInfo(url);
				const keyboard = new InlineKeyboard();
				const hdLabel = ttInfo?.hdSize ? `HD Video (${ttInfo.hdSize})` : 'HD Video';
				const sdLabel = ttInfo?.sdSize ? `SD Video (${ttInfo.sdSize})` : 'SD Video';
				keyboard.text(hdLabel, 'dl:hd').text(sdLabel, 'dl:sd');
				keyboard.row().text('Audio', 'dl:audio');
				await bot.api.editMessageText(
					ctx.chat!.id,
					statusMsg.message_id,
					`<b>${platform}</b> — Choose format:`,
					{ parse_mode: 'HTML', reply_markup: keyboard }
				);
				await setAdminState(kv, adminId, {
					action: 'downloading_media',
					context: { downloadUrl: url, downloadPlatform: platform },
				});
				return;
			}

			// Automatic download for other platforms
			const mode = (platform === 'SoundCloud' || platform === 'Spotify') ? 'audio' : 'auto';
			await downloadAndSendMedia(bot, ctx.chat!.id, url, platform, mode);
			return;
		}

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
				await handleAddSourceValue(ctx, bot, kv, adminId, state, text, env);
				break;
			case 'removing_channel':
				await handleRemoveChannelConfirm(ctx, kv, adminId, state, text);
				break;
		}
	});
}
