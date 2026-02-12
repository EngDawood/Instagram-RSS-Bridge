import type { MediaTypeFilter } from './instagram';

// Channel source configuration
export interface ChannelSource {
	id: string;
	type: 'username' | 'hashtag' | 'location';
	value: string;
	mediaType: MediaTypeFilter;
	enabled: boolean;
}

// Channel configuration stored in KV
export interface ChannelConfig {
	channelTitle: string;
	enabled: boolean;
	checkIntervalMinutes: number;
	lastCheckTimestamp: number;
	sources: ChannelSource[];
}

// Admin conversation state for multi-step flows
export interface AdminState {
	action: 'adding_channel' | 'adding_source' | 'removing_channel';
	context?: {
		channelId?: string;
		sourceType?: 'username' | 'hashtag' | 'location';
	};
}

// Formatted Telegram media message
export interface TelegramMediaMessage {
	type: 'photo' | 'video' | 'mediagroup';
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
