// app/api/kick/ws/route.ts
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Config (pode sobrescrever por env):
 * - KICK_PUSHER_KEY      → se você souber a key atual
 * - KICK_PUSHER_CLUSTER  → se você souber o cluster exato (us2/us3/mt1/...)
 * - KICK_DEBUG=1         → loga todos os nomes de eventos recebidos
 */
const PUSHER_KEY = process.env.KICK_PUSHER_KEY || "eb1d5f283081a78b932c";
const PREFERRED_CLUSTER = process.env.KICK_PUSHER_CLUSTER || "";

function corsHeaders() {
  const allow = process.env.CORS_ALLOW_ORIGINS || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() });
}

function safeJson(x: any) {
  try {
    return JSON.parse(x);
  } catch {
    return null;
  }
}

/** Resolve chatroom.id por slug (v2 → v1 → HTML). Pode falhar por proteção anti-bot. */
async function getChatroomId(slug: string): Promise<number | null> {
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  const baseHeaders = {
    "User-Agent": ua,
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "application/json, text/plain, */*",
    Referer: `https://kick.com/${slug}`,
    Origin: "https://kick.com",
  } as const;

  // v2
  try {
    const r = await fetch(
      `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
      { cache: "no-store" }
    );
    if (r.ok) {
      const j = await r.json();
      const id = j?.chatroom?.id ?? j?.livestream?.chatroom?.id ?? null;
      if (id) return Number(id);
    }
  } catch {}

  // v1
  try {
    const r = await fetch(
      `https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`,
      { cache: "no-store" }
    );
    if (r.ok) {
      const j = await r.json();
      const id = j?.chatroom?.id ?? j?.data?.chatroom?.id ?? null;
      if (id) return Number(id);
    }
  } catch {}

  // HTML (fallback)
  try {
    const r = await fetch(`https://kick.com/${encodeURIComponent(slug)}`, {
      headers: {
        ...baseHeaders,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    });
    if (r.ok) {
      const html = await r.text();
      let m = html.match(/"chatroom"\s*:\s*\{\s*"id"\s*:\s*(\d+)/);
      if (!m) m = html.match(/"chatroom_id"\s*:\s*(\d+)/i);
      if (!m) m = html.match(/chatroom_id["']?\s*:\s*(\d+)/i);
      if (m?.[1]) return Number(m[1]);
    }
  } catch {}

  return null;
}

/** Conecta no Pusher (build node) tentando clusters. Loga tentativas via callback. */
async function connectPusherAuto(
  key: string,
  preferred: string | undefined,
  onProbe: (
    cluster: string,
    phase: "try" | "ok" | "fail" | "timeout" | "badkey"
  ) => void
) {
  // Evita módulos nativos que quebram no Next
  process.env.WS_NO_BUFFER_UTIL = process.env.WS_NO_BUFFER_UTIL || "1";
  process.env.WS_NO_UTF_8_VALIDATE = process.env.WS_NO_UTF_8_VALIDATE || "1";
  const { default: Pusher } = await import("pusher-js/node");

  const candidates = Array.from(
    new Set(
      [preferred, "us2", "us3", "us1", "mt1", "eu", "ap3", "ap1"].filter(
        Boolean
      )
    )
  ) as string[];

  for (const cluster of candidates) {
    onProbe(cluster, "try");
    const p = new Pusher(key, {
      cluster,
      enabledTransports: ["ws"],
      disabledTransports: ["xhr_streaming", "xhr_polling", "sockjs"],
      disableStats: true,
      forceTLS: true,
    });

    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      const onConnected = () => {
        if (!settled) {
          settled = true;
          cleanup();
          onProbe(cluster, "ok");
          resolve(true);
        }
      };
      const onError = (err: any) => {
        const code = err?.error?.data?.code ?? err?.error?.code;
        if (code === 4001) {
          // key errada p/ cluster
          cleanup();
          onProbe(cluster, "badkey");
          resolve(false);
        }
      };
      const onStateChange = ({ current }: any) => {
        // se cair em 'failed' logo, considere falha
        if (current === "failed" && !settled) {
          settled = true;
          cleanup();
          onProbe(cluster, "fail");
          resolve(false);
        }
      };
      function cleanup() {
        p.connection.unbind("connected", onConnected);
        p.connection.unbind("error", onError);
        p.connection.unbind("state_change", onStateChange as any);
      }
      p.connection.bind("connected", onConnected);
      p.connection.bind("error", onError);
      p.connection.bind("state_change", onStateChange as any);
      setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          onProbe(cluster, "timeout");
          resolve(false);
        }
      }, 6000);
    });

    if (ok) return { pusher: p, cluster };
    try {
      p.disconnect();
    } catch {}
  }

  throw new Error("kick_pusher_cluster_auto_discovery_failed");
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // Aceita slugs=base64(JSON string[]) OU ids=base64(JSON number[])
  const rawSlugs = searchParams.get("slugs");
  const rawIds = searchParams.get("ids");
  const keyOverride = searchParams.get("key") || undefined;
  const clusterOverride = searchParams.get("cluster") || undefined;

  let slugs: string[] = [];
  let ids: number[] = [];

  if (rawSlugs) {
    try {
      slugs = JSON.parse(Buffer.from(rawSlugs, "base64").toString("utf-8"));
    } catch {}
  }
  if (rawIds) {
    try {
      ids = JSON.parse(Buffer.from(rawIds, "base64").toString("utf-8"));
    } catch {}
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start: async (controller) => {
      controller.enqueue(
        encoder.encode(
          `event:info\ndata:${JSON.stringify({
            platform: "kick",
            state: "connecting",
            slugs,
            ids,
          })}\n\n`
        )
      );

      // Se IDs vieram, use-os direto; senão, resolva por slug
      let chatroomEntries: { slug: string; id: number }[] = [];

      if (ids.length) {
        // Mapeia 1:1 com slugs se existirem; senão usa o próprio id como "slug"
        if (slugs.length && slugs.length === ids.length) {
          chatroomEntries = slugs
            .map((s, i) => ({ slug: s, id: Number(ids[i]) }))
            .filter((e) => Number.isFinite(e.id));
        } else {
          chatroomEntries = ids
            .filter((n) => Number.isFinite(n))
            .map((n) => ({ slug: String(n), id: Number(n) }));
        }
      } else if (slugs.length) {
        for (const slug of slugs) {
          const s = String(slug || "").trim();
          if (!s) continue;
          try {
            const id = await getChatroomId(s);
            if (id) chatroomEntries.push({ slug: s, id });
          } catch {}
        }
        const failed = slugs.filter(
          (s) => !chatroomEntries.find((c) => c.slug === s)
        );
        if (failed.length) {
          controller.enqueue(
            encoder.encode(
              `event:info\ndata:${JSON.stringify({
                platform: "kick",
                state: "resolve_failed",
                failed,
              })}\n\n`
            )
          );
        }
      }

      if (chatroomEntries.length === 0) {
        controller.enqueue(
          encoder.encode(
            `event:error\ndata:${JSON.stringify({
              platform: "kick",
              error: "No valid Kick chatrooms",
            })}\n\n`
          )
        );
        controller.close();
        return;
      }

      controller.enqueue(
        encoder.encode(
          `event:info\ndata:${JSON.stringify({
            platform: "kick",
            state: "chatrooms_resolved",
            chatrooms: chatroomEntries,
          })}\n\n`
        )
      );

      // Conecta/autodetecta cluster, logando cada tentativa
      let pusherConn;
      const KEY = keyOverride || PUSHER_KEY;
      const PREF = clusterOverride || PREFERRED_CLUSTER || undefined;
      try {
        pusherConn = await connectPusherAuto(KEY, PREF, (cluster, phase) => {
          controller.enqueue(
            encoder.encode(
              `event:info\ndata:${JSON.stringify({
                platform: "kick",
                probe: { cluster, phase },
              })}\n\n `
            )
          );
        });
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            `event:error\ndata:${JSON.stringify({
              platform: "kick",
              error: String(e),
            })}\n\n`
          )
        );
        controller.close();
        return;
      }

      const { pusher, cluster } = pusherConn;
      controller.enqueue(
        encoder.encode(
          `event:info\ndata:${JSON.stringify({
            platform: "kick",
            state: "pusher_connected",
            key: `${KEY.slice(0, 6)}…`,
            cluster,
          })}\n\n`
        )
      );

      if (process.env.KICK_DEBUG === "1") {
        // @ts-ignore
        pusher.bind_global((evName: string) => {
          controller.enqueue(
            encoder.encode(
              `event:info\ndata:${JSON.stringify({
                platform: "kick",
                debug: true,
                ev: evName,
              })}\n\n`
            )
          );
        });
      }

      // Assina "chatrooms.{id}.v2" e lida com o ChatMessageEvent
      const subscriptions = chatroomEntries.map(({ slug, id }) => {
        const channelName = `chatrooms.${id}.v2`;
        const ch = pusher.subscribe(channelName);

        ch.bind("pusher:subscription_succeeded", () => {
          controller.enqueue(
            encoder.encode(
              `event:info\ndata:${JSON.stringify({
                platform: "kick",
                state: "subscribed",
                channel: slug,
                chatroomId: id,
              })}\n\n`
            )
          );
        });

        ch.bind("pusher:subscription_error", (err: any) => {
          controller.enqueue(
            encoder.encode(
              `event:error\ndata:${JSON.stringify({
                platform: "kick",
                channel: slug,
                error: String(err),
              })}\n\n`
            )
          );
        });

        ch.bind("App\\Events\\ChatMessageEvent", (payload: any) => {
          const data =
            typeof payload === "string" ? safeJson(payload) : payload;
          const d = (data?.data ?? data ?? {}) as any;
          const content = d.content ?? d.message ?? null;
          const sender = d.sender ?? d.user ?? null;

          if (content && sender?.username) {
            const msg = {
              id:
                d.id ??
                `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              at: Date.now(),
              platform: "kick" as const,
              channel: slug,
              username: String(sender.username),
              text: String(content),
            };
            controller.enqueue(
              encoder.encode(`event:chat\ndata:${JSON.stringify(msg)}\n\n`)
            );
          }
        });

        return { channelName, ch };
      });

      // Keepalive SSE
      const ping = setInterval(() => {
        controller.enqueue(
          encoder.encode(`event:ping\ndata:${Date.now()}\n\n`)
        );
      }, 25_000);

      const closeAll = () => {
        clearInterval(ping);
        try {
          subscriptions.forEach((s) => pusher.unsubscribe(s.channelName));
        } catch {}
        try {
          pusher.disconnect();
        } catch {}
      };

      (req as any).signal?.addEventListener("abort", () => {
        closeAll();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...corsHeaders(),
    },
  });
}
