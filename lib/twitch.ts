import { UnifiedChatMessage } from './types';
import tmi from 'tmi.js';

export type TwitchClient = tmi.Client;

export async function connectTwitch(channels: string[]): Promise<TwitchClient> {
  const client = new tmi.Client({
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    identity: { username: `justinfan${Math.floor(Math.random()*100000)}`, password: 'oauth:anonymous' },
    channels: channels.map(c => c.replace(/^#/, '')),
  });
  await client.connect();
  return client;
}

export function toUnified(channel: string, userstate: tmi.ChatUserstate, message: string): UnifiedChatMessage {
  return {
    id: `${channel}-${userstate['id'] ?? Math.random().toString(36).slice(2)}`,
    platform: 'twitch',
    channel,
    username: userstate['display-name'] || userstate.username || 'twitch-user',
    text: message,
    at: Date.now(),
  };
}
