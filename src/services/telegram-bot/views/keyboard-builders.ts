import { InlineKeyboard } from 'grammy';
import type { FormatSettings } from '../../../types/telegram';
import { FORMAT_LABELS } from '../../../constants';
import { FORMAT_SETTING_KEYS, formatValueText } from '../helpers/format-settings';

/**
 * Build RSStT-style format settings keyboard (one button per setting, click to cycle).
 */
export function buildFormatKeyboard(
	current: FormatSettings,
	callbackPrefix: string, // 'fs:CHID:SRCID' or 'fd:CHID'
	backCallback: string,
	resetCallback: string
): InlineKeyboard {
	const kb = new InlineKeyboard();
	kb.text('Reset to defaults', resetCallback).row();
	
	for (const key of FORMAT_SETTING_KEYS) {
		const label = FORMAT_LABELS[key].label;
		const valueText = formatValueText(key, String(current[key]));
		kb.text(`${label}: ${valueText}`, `${callbackPrefix}:${key}`).row();
	}
	
	kb.text('Cancel', backCallback);
	return kb;
}
