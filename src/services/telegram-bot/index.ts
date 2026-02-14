// Public API exports (BACKWARD COMPATIBLE)
export { createBot } from './bot-factory';
export { getChannelConfig, saveChannelConfig } from './storage/kv-operations';
export { sendMediaToChannel } from './handlers/send-media';

// Re-export types for convenience
export type { ChannelConfig, ChannelSource, AdminState } from '../../types/telegram';
export type { FormatSettings } from '../../types/telegram';
