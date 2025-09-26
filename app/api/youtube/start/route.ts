// app/api/youtube/start/route.ts
import { NextRequest } from "next/server";
import { getLiveChatId, pollYouTubeLiveChat } from "@/lib/youtube";

export const runtime = "nodejs";

// Helpers Upstash REST
async function upstashPublish(channel: string, payload: unknown) {
  const base = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const url = `${base.replace(/\/$/, "")}/publish/${encodeURIComponent(
    channel
  )}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Upstash publish fail: ${res.status}`);
}

async function upstashGet(key: string) {
  const base = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const url = `${base.replace(/\/$/, "")}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  return j?.result ?? null;
}

async function upstashSetEx(key: string, val: string, ttlSec: number) {
  // Pipeline: SET key val EX ttl
  const base = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const url = `${base.replace(/\/$/, "")}/pipeline`;
  const body = JSON.stringify([["SET", key, val, "EX", String(ttlSec)]]);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!res.ok) throw new Error(`Upstash setex fail: ${res.status}`);
}

async function upstashSetNxEx(key: string, val: string, ttlSec: number) {
  // Lock: SET key val EX ttl NX  → retorna "OK" se adquiriu; null caso contrário
  const base = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const url = `${base.replace(/\/$/, "")}/pipeline`;
  const body = JSON.stringify([["SET", key, val, "EX", String(ttlSec), "NX"]]);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!res.ok) return false;
  const out = await res.json().catch(() => null);
  // Resposta típica: ["OK"] dentro de um array
  return Array.isArray(out) && out[0] === "OK";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  if (!process.env.YOUTUBE_API_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "YOUTUBE_API_KEY missing" }),
      { status: 400 }
    );
  }

  let videos: string[] = [];
  try {
    const data = await req.json();
    videos = Array.isArray(data?.videos) ? data.videos : [];
  } catch {
    // fallback: tentar query ?videos=base64
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get("videos");
    if (raw) {
      try {
        videos = JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
      } catch {}
    }
  }
  videos = videos.filter(Boolean);

  const started: {
    videoId: string;
    liveChatId?: string;
    started: boolean;
    reason?: string;
  }[] = [];

  const deadline = Date.now() + 55_000; // ~55s para caber no maxDuration=60s

  for (const videoId of videos) {
    try {
      // 1) Mapear videoId -> liveChatId (cachear por 30 min)
      let chatId = (await upstashGet(`yt:chat:${videoId}`)) as string | null;
      if (!chatId) {
        chatId = (await getLiveChatId(videoId)) || null;
        if (!chatId) {
          started.push({ videoId, started: false, reason: "no_liveChatId" });
          continue;
        }
        await upstashSetEx(`yt:chat:${videoId}`, chatId, 1800);
      }

      // 2) Lock: apenas um consumidor por chat
      const gotLock = await upstashSetNxEx(
        `yt:lock:${chatId}`,
        String(Date.now()),
        58
      );
      if (!gotLock) {
        started.push({
          videoId,
          liveChatId: chatId,
          started: false,
          reason: "locked",
        });
        continue;
      }

      // 3) Recuperar nextPageToken salvo (caso exista)
      let nextToken = (await upstashGet(`yt:pt:${chatId}`)) as string | null;

      // 4) Loop até ~55s ou até cair
      while (Date.now() < deadline) {
        const { messages, nextPageToken, wait } = await pollYouTubeLiveChat(
          chatId,
          nextToken || undefined
        );
        // publica cada mensagem no canal yt:<chatId>
        for (const m of messages) {
          await upstashPublish(`yt:${chatId}`, m);
        }
        nextToken = nextPageToken || null;
        if (nextToken) {
          await upstashSetEx(`yt:pt:${chatId}`, nextToken, 600);
        }
        await sleep(Math.max(1000, Math.min(wait ?? 4000, 15000))); // respeita pollingInterval e dá cap
      }

      started.push({ videoId, liveChatId: chatId, started: true });
    } catch (e) {
      started.push({ videoId, started: false, reason: String(e) });
    }
  }

  return new Response(JSON.stringify({ ok: true, started }), {
    headers: { "Content-Type": "application/json" },
  });
}
