import type { Bot } from 'grammy';
import { getAdminState, clearAdminState } from '../storage/admin-state';
import { downloadAndSendMedia } from '../handlers/download-and-send';

/**
 * Register callback handlers for media download buttons.
 * Supports: dl:video, dl:audio, dl:hd, dl:sd, dl:yt:<quality>, dl:confirm, dl:cancel
 */
export function registerDownloadCallbacks(bot: Bot, env: Env, kv: KVNamespace): void {
	const adminId = parseInt(env.ADMIN_TELEGRAM_ID, 10);

	// Handle all dl: callbacks with a single regex
	bot.callbackQuery(/^dl:(.+)$/, async (ctx) => {
		const action = ctx.match[1]; // e.g. 'video', 'audio', 'hd', 'sd', 'yt:720p', 'confirm', 'cancel'
		const chatId = ctx.chat!.id;
		const msgId = ctx.callbackQuery.message?.message_id;
		const state = await getAdminState(kv, adminId);

		if (!state || state.action !== 'downloading_media' || !state.context?.downloadUrl) {
			await ctx.answerCallbackQuery({ text: 'Session expired. Send the link again.' });
			return;
		}

		const { downloadUrl, downloadPlatform, qualities, directMediaUrl } = state.context;

		// Cancel — clear state and dismiss the message
		if (action === 'cancel') {
			await clearAdminState(kv, adminId);
			await ctx.answerCallbackQuery({ text: 'Cancelled.' });
			if (msgId) await bot.api.editMessageText(chatId, msgId, 'Cancelled.');
			return;
		}

		// Confirm download — force download+upload of the rejected CDN URL
		if (action === 'confirm') {
			if (!directMediaUrl) {
				await ctx.answerCallbackQuery({ text: 'Session expired. Send the link again.' });
				return;
			}
			await clearAdminState(kv, adminId);
			await ctx.answerCallbackQuery();
			// directUrl=true skips platform detection; no kv/adminId = non-interactive (auto-fallback on error)
			await downloadAndSendMedia(bot, chatId, directMediaUrl, downloadPlatform || 'media', 'auto', msgId, true);
			return;
		}

		await clearAdminState(kv, adminId);
		await ctx.answerCallbackQuery();

		let mode: 'auto' | 'audio' | 'hd' | 'sd' = 'auto';

		if (action === 'audio') {
			mode = 'audio';
		} else if (action === 'hd') {
			mode = 'hd';
		} else if (action === 'sd') {
			mode = 'sd';
		} else if (action === 'video') {
			mode = 'auto';
		} else if (action.startsWith('yt:') && qualities) {
			// YouTube quality selection — find the matching quality URL and download directly
			const selectedQuality = action.slice(3); // e.g. '720p'
			const match = qualities.find(q => q.quality === selectedQuality);
			if (match) {
				await downloadAndSendMedia(
					bot,
					chatId,
					match.url,
					downloadPlatform || 'YouTube',
					'auto',
					msgId,
					true, // directUrl flag — skip platform detection, download this URL directly
					{ kv, adminId },
				);
				return;
			}
			// Fallback if quality not found
			mode = 'auto';
		}

		await downloadAndSendMedia(bot, chatId, downloadUrl, downloadPlatform || 'Unknown', mode, msgId, undefined, { kv, adminId });
	});
}
