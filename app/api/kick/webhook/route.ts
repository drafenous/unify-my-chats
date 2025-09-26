import type { NextRequest } from "next/server";

export const runtime = "nodejs";

async function getKickPublicKeyPEM(): Promise<string> {
  const res = await fetch("https://api.kick.com/public/v1/public-key", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Falha ao obter chave pública do Kick");
  const pem = await res.text();
  return pem.trim();
}

async function upstashPublish(channel: string, payload: unknown) {
  const base = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const url = `${base.replace(/\/$/, "")}/publish/${encodeURIComponent(
    channel
  )}`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function POST(req: NextRequest) {
  const sig = req.headers.get("Kick-Event-Signature") || "";
  const ts = req.headers.get("Kick-Event-Message-Timestamp") || "";
  const id = req.headers.get("Kick-Event-Message-Id") || "";
  const type = req.headers.get("Kick-Event-Type") || "";
  const raw = Buffer.from(await req.arrayBuffer());

  // Verifica assinatura: `${id}.${ts}.${raw}` com RSA-SHA256
  const crypto = await import("crypto");
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(Buffer.from(id));
  verifier.update(Buffer.from("."));
  verifier.update(Buffer.from(ts));
  verifier.update(Buffer.from("."));
  verifier.update(raw);
  verifier.end();

  const pem = await getKickPublicKeyPEM();
  const ok = verifier.verify(pem, Buffer.from(sig, "base64"));
  if (!ok) return new Response("bad signature", { status: 401 });

  const body = JSON.parse(raw.toString("utf-8"));

  if (type === "chat.message.sent") {
    const slug = body?.broadcaster?.channel_slug ?? "kick";
    const msg = {
      id: body?.message_id,
      platform: "kick" as const,
      channel: slug,
      username: body?.sender?.username ?? "kick-user",
      text: body?.content ?? "",
      at: Date.parse(body?.created_at ?? new Date().toISOString()),
    };
    await upstashPublish(`kick:${slug}`, msg);
  }
  return new Response("ok", { status: 200 });
}
