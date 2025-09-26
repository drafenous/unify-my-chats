import type { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("slugs");
  if (!raw) return new Response("missing slugs", { status: 400 });

  let slugs: string[] = [];
  try {
    slugs = JSON.parse(atob(raw));
  } catch {
    return new Response("bad slugs encoding", { status: 400 });
  }
  if (!slugs.length) return new Response("no slugs", { status: 400 });

  const base = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;

  const channels = slugs.map((s) => `kick:${s}`).join(",");
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
      `event:info\\ndata:${JSON.stringify({
        platform: "kick",
        state: "subscribed",
        slugs,
      })}\\n\\n`
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
        const lines = buffer.split("\\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const data = t.slice(5).trim(); // "message,<canal>,{json}"
          if (!data.startsWith("message,")) continue;
          const firstComma = data.indexOf(",", 8);
          if (firstComma < 0) continue;
          const jsonStr = data.slice(firstComma + 1);
          try {
            const payload = JSON.parse(jsonStr);
            await writer.write(
              enc.encode(`event:chat\\ndata:${JSON.stringify(payload)}\\n\\n`)
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
