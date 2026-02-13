import type { FeedMediaFilter } from './feed';

// Format settings for controlling Telegram message appearance
export interface FormatSettings {
	notification: 'normal' | 'muted';
	media: 'enable' | 'disable' | 'only_media';
	author: 'enable' | 'disable';
	sourceFormat: 'title_link' | 'link_only' | 'bare_url' | 'disable';
	linkPreview: 'enable' | 'disable';
	lengthLimit: number; // 0 = unlimited, or 256/512/1024
}

export type SourceType = 'instagram_user' | 'instagram_tag' | 'rss_url';

// Channel source configuration
export interface ChannelSource {
	id: string;
	type: SourceType;
	value: string;
	mediaFilter: FeedMediaFilter;
	enabled: boolean;
	format?: Partial<FormatSettings>;
}

// Channel configuration stored in KV
export interface ChannelConfig {
	channelTitle: string;
	enabled: boolean;
	checkIntervalMinutes: number;
	lastCheckTimestamp: number;
	sources: ChannelSource[];
	defaultFormat?: Partial<FormatSettings>;
}

// Admin conversation state for multi-step flows
export interface AdminState {
	action: 'adding_channel' | 'adding_source' | 'removing_channel';
	context?: {
		channelId?: string;
		sourceType?: SourceType;
	};
}

// Formatted Telegram media message
export interface TelegramMediaMessage {
	type: 'photo' | 'video' | 'mediagroup' | 'text';
	url?: string;
	thumbnailUrl?: string;
	caption: string;
	media?: Array<{
		type: 'photo' | 'video';
		media: string;
		caption?: string;
		parse_mode?: string;
	}>;
}
