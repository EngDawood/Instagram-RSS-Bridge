import { FORMAT_LABELS } from '../../../constants';
import type { FormatSettings } from '../../../types/telegram';

export const FORMAT_SETTING_KEYS: (keyof FormatSettings)[] = [
	'notification', 'media', 'author', 'sourceFormat', 'linkPreview', 'lengthLimit',
];

/**
 * Get the next option value for a setting (cycles through options list).
 */
export function cycleFormatValue(setting: keyof FormatSettings, current: string | number): string {
	const options = FORMAT_LABELS[setting].options;
	const idx = options.findIndex((o) => String(o.value) === String(current));
	return String(options[(idx + 1) % options.length].value);
}

/**
 * Get display text for a setting's current value.
 */
export function formatValueText(setting: keyof FormatSettings, value: string | number): string {
	const opt = FORMAT_LABELS[setting].options.find((o) => String(o.value) === String(value));
	return opt?.text ?? String(value);
}
