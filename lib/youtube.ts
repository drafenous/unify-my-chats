import { UnifiedChatMessage } from './types';

const API_KEY = process.env.YOUTUBE_API_KEY;

type LiveDetailsResp = {
  items: { id: string; liveStreamingDetails?: { activeLiveChatId?: string } }[];
};

type LiveChatResp = {
  items: { id: string; snippet: { displayMessage: string; publishedAt: string; authorChannelId?: { value: string }; authorDetails?: { displayName: string; channelId: string } } }[];
  nextPageToken?: string;
  pollingIntervalMillis?: number;
};

export async function getLiveChatId(videoId: string): Promise<string | null> {
  if (!API_KEY) return null;
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('key', API_KEY);
  url.searchParams.set('part', 'liveStreamingDetails');
  url.searchParams.set('id', videoId);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json()) as LiveDetailsResp;
  const liveChatId = data.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
  return liveChatId ?? null;
}

export async function pollYouTubeLiveChat(liveChatId: string, pageToken?: string) {
  if (!API_KEY) return { messages: [], nextPageToken: undefined, wait: 5000 };
  const url = new URL('https://www.googleapis.com/youtube/v3/liveChat/messages');
  url.searchParams.set('key', API_KEY);
  url.searchParams.set('liveChatId', liveChatId);
  url.searchParams.set('part', 'snippet,authorDetails');
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return { messages: [], nextPageToken: undefined, wait: 5000 };
  const data = (await res.json()) as LiveChatResp;
  const wait = data.pollingIntervalMillis ?? 4000;
  const msgs: UnifiedChatMessage[] = data.items.map((it) => ({
    id: it.id,
    platform: 'youtube',
    channel: it.snippet.authorDetails?.channelId ?? 'youtube',
    username: it.snippet.authorDetails?.displayName ?? 'yt-user',
    text: it.snippet.displayMessage,
    at: new Date(it.snippet.publishedAt).getTime(),
  }));
  return { messages: msgs, nextPageToken: data.nextPageToken, wait };
}
