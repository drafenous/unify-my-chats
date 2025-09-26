import { connectTwitch, toUnified } from "@/lib/twitch";
import { UnifiedChatMessage } from "@/lib/types";
import { parseSource } from "@/lib/urlParser";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("sources");
  if (!raw) {
    return new Response("Missing sources", {
      status: 400,
      headers: corsHeaders(),
    });
  }
  let urls: string[] = [];
  try {
    urls = JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
  } catch {
    return new Response("Bad sources encoding", {
      status: 400,
      headers: corsHeaders(),
    });
  }

  const sources = urls.map(parseSource);
  const encoder = new TextEncoder();
  const HAS_YT = !!process.env.YOUTUBE_API_KEY;

  const stream = new ReadableStream({
    start: async (controller) => {
      controller.enqueue(
        encoder.encode(`event:meta\ndata:${JSON.stringify({ sources })}\n\n`)
      );

      // --- TWITCH (igual ao seu) ---
      const twitchChannels = sources
        .filter((s) => s.platform === "twitch" && s.channel)
        .map((s) => s.channel!) as string[];
      let twitchClient: any = null;
      if (twitchChannels.length > 0) {
        try {
          twitchClient = await connectTwitch(twitchChannels);
          twitchClient.on(
            "message",
            (
              channel: string,
              userstate: any,
              message: string,
              self: boolean
            ) => {
              if (self) return;
              const msg: UnifiedChatMessage = toUnified(
                channel.replace(/^#/, ""),
                userstate,
                message
              );
              controller.enqueue(
                encoder.encode(`event:chat\ndata:${JSON.stringify(msg)}\n\n`)
              );
            }
          );
          twitchClient.on("disconnected", () => {
            controller.enqueue(
              encoder.encode(
                `event:info\ndata:${JSON.stringify({
                  platform: "twitch",
                  state: "disconnected",
                })}\n\n`
              )
            );
          });
        } catch (e) {
          controller.enqueue(
            encoder.encode(
              `event:error\ndata:${JSON.stringify({
                platform: "twitch",
                error: String(e),
              })}\n\n`
            )
          );
        }
      }

      const ping = setInterval(() => {
        controller.enqueue(
          encoder.encode(`event:ping\ndata:${Date.now()}\n\n`)
        );
      }, 25000);

      const close = () => {
        clearInterval(ping);
        if (twitchClient) {
          try {
            twitchClient.disconnect();
          } catch {}
        }
      };

      (req as any).signal?.addEventListener("abort", () => {
        close();
        controller.close();
      });
    },
    cancel() {},
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
