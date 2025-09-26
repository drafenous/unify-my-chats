// app/api/youtube/stream/route.ts
import type { NextRequest } from "next/server";

export const runtime = "edge";

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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("videos"); // base64(JSON string[])
  if (!raw) return new Response("missing videos", { status: 400 });

  let videos: string[] = [];
  try {
    videos = JSON.parse(atob(raw));
  } catch {
    return new Response("bad videos encoding", { status: 400 });
  }
  videos = videos.filter(Boolean);
  if (!videos.length) return new Response("no videos", { status: 400 });

  // Mapeia videoId -> liveChatId a partir do cache
  const chatIds: string[] = [];
  for (const vid of videos) {
    const chatId = await upstashGet(`yt:chat:${vid}`);
    if (chatId) chatIds.push(String(chatId));
  }
  if (!chatIds.length) {
    // provavelmente /api/youtube/start ainda não rodou
    return new Response("chatIds not ready", { status: 425 }); // Too Early
  }

  const base = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const channels = chatIds.map((c) => `yt:${c}`).join(",");
  const subUrl = `${base.replace(/\/$/, "")}/subscribe/${channels}`;

  const upstream = await fetch(subUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
  });
  if (!upstream.ok || !upstream.body)
    return new Response("subscribe failed", { status: 502 });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  await writer.write(
    enc.encode(
      `event:info\ndata:${JSON.stringify({
        platform: "youtube",
        state: "subscribed",
        videos,
        chatIds,
      })}\n\n`
    )
  );

  const reader = upstream.body.getReader();
  const dec = new TextDecoder();

  (async () => {
    try {
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const data = t.slice(5).trim(); // "message,<channel>,{json}"
          if (!data.startsWith("message,")) continue;
          const firstComma = data.indexOf(",", 8);
          if (firstComma < 0) continue;
          const jsonStr = data.slice(firstComma + 1);
          try {
            const payload = JSON.parse(jsonStr);
            await writer.write(
              enc.encode(`event:chat\ndata:${JSON.stringify(payload)}\n\n`)
            );
          } catch {}
        }
      }
    } finally {
      try {
        await writer.close();
      } catch {}
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
