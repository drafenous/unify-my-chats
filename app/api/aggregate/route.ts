import { NextRequest } from 'next/server';
import { parseSource } from '@/lib/urlParser';
import { Platform, UnifiedChatMessage } from '@/lib/types';
import { connectTwitch, toUnified } from '@/lib/twitch';
import { getLiveChatId, pollYouTubeLiveChat } from '@/lib/youtube';
import { getChannelBySlug, getKickAppToken, subscribeChatMessageWebhook } from '@/lib/kick';

export const runtime = 'nodejs';

function corsHeaders() {
  const allow = process.env.CORS_ALLOW_ORIGINS || '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('sources');
  if (!raw) {
    return new Response('Missing sources', { status: 400, headers: corsHeaders() });
  }
  let urls: string[] = [];
  try {
    urls = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  } catch {
    return new Response('Bad sources encoding', { status: 400, headers: corsHeaders() });
  }

  const sources = urls.map(parseSource);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start: async (controller) => {
      // Send initial meta
      controller.enqueue(encoder.encode(`event:meta\ndata:${JSON.stringify({ sources })}\n\n`));

      // Twitch setup
      const twitchChannels = sources.filter(s => s.platform === 'twitch' && s.channel).map(s => s.channel!) as string[];
      let twitchClient: any = null;
      if (twitchChannels.length > 0) {
        try {
          twitchClient = await connectTwitch(twitchChannels);
          twitchClient.on('message', (channel: string, userstate: any, message: string, self: boolean) => {
            if (self) return;
            const msg: UnifiedChatMessage = toUnified(channel.replace(/^#/, ''), userstate, message);
            controller.enqueue(encoder.encode(`event:chat\ndata:${JSON.stringify(msg)}\n\n`));
          });
          twitchClient.on('disconnected', () => {
            controller.enqueue(encoder.encode(`event:info\ndata:${JSON.stringify({ platform:'twitch', state:'disconnected' })}\n\n`));
          });
        } catch (e) {
          controller.enqueue(encoder.encode(`event:error\ndata:${JSON.stringify({ platform:'twitch', error: String(e) })}\n\n`));
        }
      }

      // YouTube setup
      const ytVideos = sources.filter(s => s.platform === 'youtube' && s.videoId).map(s => s.videoId!) as string[];
      const ytState: { [videoId: string]: { chatId?: string, token?: string, timer?: any } } = {};
      for (const vid of ytVideos) {
        try {
          const liveChatId = await getLiveChatId(vid);
          if (!liveChatId) {
            controller.enqueue(encoder.encode(`event:info\ndata:${JSON.stringify({ platform:'youtube', videoId: vid, note:'Sem liveChatId (live não ativa?) ou sem API key).' })}\n\n`));
            continue;
          }
          ytState[vid] = { chatId: liveChatId, token: undefined, timer: undefined };
          const poll = async () => {
            try {
              const { messages, nextPageToken, wait } = await pollYouTubeLiveChat(liveChatId, ytState[vid].token);
              for (const m of messages) {
                controller.enqueue(encoder.encode(`event:chat\ndata:${JSON.stringify(m)}\n\n`));
              }
              ytState[vid].token = nextPageToken;
              ytState[vid].timer = setTimeout(poll, wait);
            } catch (e) {
              controller.enqueue(encoder.encode(`event:error\ndata:${JSON.stringify({ platform:'youtube', videoId: vid, error: String(e) })}\n\n`));
            }
          };
          poll();
        } catch (e) {
          controller.enqueue(encoder.encode(`event:error\ndata:${JSON.stringify({ platform:'youtube', videoId: vid, error: String(e) })}\n\n`));
        }
      }
     
      // Kick setup
      const kickSlugs = sources.filter(s => s.platform === 'kick' && s.channel).map(s => s.channel!);
      
      if (kickSlugs.length) {
        try {
          const token = await getKickAppToken();
          for (const slug of kickSlugs) {
            const ch = await getChannelBySlug(token, slug);
            if (!ch) continue;
            await subscribeChatMessageWebhook(token, ch.broadcaster_user_id);
            // associe subscription_id -> conexão atual (para broadcast no webhook)
          }
          // opcional: enviar um info inicial
          controller.enqueue(encoder.encode(`event:info\ndata:${JSON.stringify({ platform:'kick', state:'subscribed', slugs: kickSlugs })}\n\n`));
        } catch (e) {
          controller.enqueue(encoder.encode(`event:error\ndata:${JSON.stringify({ platform:'kick', error: String(e) })}\n\n`));
        }
      }
      
      // TODO: TikTok/Instagram adapters (future)

      // Keepalive
      const ping = setInterval(() => {
        controller.enqueue(encoder.encode(`event:ping\ndata:${Date.now()}\n\n`));
      }, 25000);

      const close = () => {
        clearInterval(ping);
        if (twitchClient) {
          try { twitchClient.disconnect(); } catch {}
        }
        Object.values(ytState).forEach(s => s.timer && clearTimeout(s.timer));
      };

      const abort = (reason?: any) => {
        close();
        controller.close();
      };

      // Close stream on client abort
      (req as any).signal?.addEventListener('abort', abort);

    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      ...corsHeaders(),
    },
  });
}
