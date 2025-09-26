import { ParsedSource, Platform } from './types';

const YT_HOSTS = new Set(['www.youtube.com','youtube.com','youtu.be','m.youtube.com']);
const TWITCH_HOSTS = new Set(['www.twitch.tv','twitch.tv','m.twitch.tv']);
const KICK_HOSTS = new Set(['kick.com','www.kick.com']);

export function detectPlatform(urlStr: string): Platform {
  try{
    const u = new URL(urlStr);
    if (YT_HOSTS.has(u.host)) return 'youtube';
    if (TWITCH_HOSTS.has(u.host)) return 'twitch';
    if (KICK_HOSTS.has(u.host)) return 'kick';
    if (u.host.includes('tiktok.com')) return 'tiktok';
    if (u.host.includes('instagram.com')) return 'instagram';
    return 'unknown';
  }catch{
    return 'unknown';
  }
}

export function parseSource(urlStr: string): ParsedSource {
  const platform = detectPlatform(urlStr);
  try{
    const u = new URL(urlStr);
    if (platform === 'twitch') {
      // Accept /{channel}
      const channel = u.pathname.split('/').filter(Boolean)[0];
      if (channel) return { url: urlStr, platform, channel };
      return { url: urlStr, platform, note: 'Não foi possível identificar o canal da Twitch.' };
    }
    if (platform === 'youtube') {
      // Expect a video URL with v= or a youtu.be short link
      let videoId = u.searchParams.get('v') ?? undefined;
      if (!videoId && u.host === 'youtu.be') videoId = u.pathname.split('/').filter(Boolean)[0];
      if (videoId) return { url: urlStr, platform, videoId };
      return { url: urlStr, platform, note: 'Forneça a URL do VÍDEO da live (com ?v=...), não apenas o canal.' };
    }
    if (platform === 'kick') {
      const channel = u.pathname.split('/').filter(Boolean)[0];
      if (channel) return { url: urlStr, platform, channel };
      return { url: urlStr, platform, note: 'Não foi possível identificar o canal da Kick.' };
    }
    if (platform === 'tiktok' || platform === 'instagram') {
      return { url: urlStr, platform, note: 'Essencial, mas fora do MVP (em breve).' };
    }
    return { url: urlStr, platform, note: 'Plataforma não reconhecida.' };
  }catch{
    return { url: urlStr, platform, note: 'URL inválida.' };
  }
}
