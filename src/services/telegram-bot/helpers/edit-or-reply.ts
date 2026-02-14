import type { Context, InlineKeyboard } from 'grammy';

/**
 * Safe edit-or-reply: tries to edit the current message (if triggered by a callback),
 * otherwise sends a new reply. Falls back to reply if edit fails.
 */
export async function editOrReply(
	ctx: Context,
	text: string,
	opts?: { parse_mode?: string; reply_markup?: InlineKeyboard }
): Promise<void> {
	try {
		if (ctx.callbackQuery?.message) {
			await ctx.editMessageText(text, opts as Parameters<typeof ctx.editMessageText>[1]);
		} else {
			await ctx.reply(text, opts as Parameters<typeof ctx.reply>[1]);
		}
	} catch (err) {
		console.warn('[editOrReply] Edit failed, falling back to reply:', err);
		try {
			await ctx.reply(text, opts as Parameters<typeof ctx.reply>[1]);
		} catch (replyErr) {
			console.error('[editOrReply] Both edit and reply failed:', replyErr);
		}
	}
}
