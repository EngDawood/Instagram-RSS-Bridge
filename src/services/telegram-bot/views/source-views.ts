import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import type { ChannelSource } from '../../../types/telegram';
import type { FeedMediaFilter } from '../../../types/feed';
import { editOrReply } from '../helpers/edit-or-reply';
import { sourceTypeIcon, sourceTypeLabel } from '../helpers/source-parser';
import { escapeHtml as escapeHtmlBot } from '../../../utils/text';

/**
 * Display details and management options for a specific subscription source.
 */
export async function showSourceDetail(
	ctx: Context,
	channelId: string,
	source: ChannelSource
): Promise<void> {
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
