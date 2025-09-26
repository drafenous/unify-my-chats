export type Platform = 'twitch' | 'youtube' | 'kick' | 'tiktok' | 'instagram' | 'unknown';

export type ParsedSource = {
  url: string;
  platform: Platform;
  // Normalized ids extracted from URL
  channel?: string;      // twitch/kick
  videoId?: string;      // youtube
  note?: string;         // info about unsupported cases
};

export type UnifiedChatMessage = {
  id: string;
  platform: Platform;
  channel: string;       // display source name (e.g., twitch channel or YT channel)
  username: string;
  text: string;
  at: number;            // epoch ms
};
