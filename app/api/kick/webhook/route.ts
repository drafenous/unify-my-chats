import type { NextRequest } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

// Busca a chave pública (formato PEM) e retorna string PEM
async function getKickPublicKeyPEM(): Promise<string> {
  const res = await fetch("https://api.kick.com/public/v1/public-key", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Falha ao obter chave pública do Kick");
  const j = await res.json();
  const pem: string | undefined = j?.data?.public_key;
  if (!pem || !pem.includes("BEGIN PUBLIC KEY")) {
    throw new Error("Formato inesperado da chave pública do Kick");
  }
  return pem.trim();
}

async function upstashPublish(channel: string, payload: unknown) {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) throw new Error("UPSTASH_REDIS_REST_URL/TOKEN ausentes");

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
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Falha ao publicar no Upstash: ${res.status} ${txt}`);
  }
}

export async function POST(req: NextRequest) {
  // Headers do Kick (sensíveis a maiúsc./minúsc. no HTTP mas Next normaliza)
  const sig = req.headers.get("Kick-Event-Signature") || "";
  const ts = req.headers.get("Kick-Event-Message-Timestamp") || "";
  const id = req.headers.get("Kick-Event-Message-Id") || "";
  const type = req.headers.get("Kick-Event-Type") || "";

  // Corpo cru (tem que ser exatamente o recebido, sem parse antes)
  const raw = Buffer.from(await req.arrayBuffer());

  // Monta a mensagem: "<id>.<timestamp>.<raw-body>"
  const message = Buffer.concat([
    Buffer.from(id, "utf8"),
    Buffer.from(".", "utf8"),
    Buffer.from(ts, "utf8"),
    Buffer.from(".", "utf8"),
    raw,
  ]);

  // Decodifica assinatura (Base64)
  const signature = Buffer.from(sig, "base64");

  // Verificação RSA-SHA256 (PKCS#1 v1.5) com a chave pública do Kick
  const pem = await getKickPublicKeyPEM();
  const keyObj = crypto.createPublicKey({
    key: pem,
    format: "pem",
    type: "spki",
  });

  const ok = crypto.verify(
    "RSA-SHA256",
    message,
    { key: keyObj, padding: crypto.constants.RSA_PKCS1_PADDING },
    signature
  );
  if (!ok) return new Response("bad signature", { status: 401 });

  // Só depois do verify fazemos o parse do JSON
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
