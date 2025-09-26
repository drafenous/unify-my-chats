// app/api/kick/webhook/route.ts
import { NextRequest } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';

// Chave pública do Kick (ou busque em https://api.kick.com/public/v1/public-key)
const KICK_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8\n6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2\nMZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ\nL/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY\n6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF\nBEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e\ntwIDAQAB\n-----END PUBLIC KEY-----`;

async function fetchKickPublicKey() {
    try {
        const request = await fetch('https://api.kick.com/public/v1/public-key');
        const response = await request.json() as {data: {public_key: string}, message: string};
        const {public_key: publicKey} = response.data
        return publicKey
    } catch(error) {
        console.error(error)
        return undefined
    }
}

async function verifyKickSignature(messageId: string, ts: string, raw: Buffer, signatureB64: string) {
  const verifier = crypto.createVerify('RSA-SHA256');
  const data = Buffer.from(`${messageId}.${ts}.${raw}`);
  verifier.update(data);
  verifier.end();
  const publicKey = await fetchKickPublicKey();
  if(!publicKey) {
    return false
  }
  const signature = Buffer.from(signatureB64, 'base64');
  return verifier.verify(publicKey, signature);
}

export async function POST(req: NextRequest) {
  const headers = req.headers;
  const sig = headers.get('Kick-Event-Signature') || '';
  const ts = headers.get('Kick-Event-Message-Timestamp') || '';
  const mid = headers.get('Kick-Event-Message-Id') || '';
  const type = headers.get('Kick-Event-Type') || '';

  const raw = Buffer.from(await req.arrayBuffer());
  const ok = verifyKickSignature(mid, ts, raw, sig);
  if (!ok) return new Response('bad signature', { status: 401 });

  const body = JSON.parse(raw.toString('utf-8'));

  if (type === 'chat.message.sent') {
    // Normalize para seu feed unificado
    const msg = {
      id: body.message_id,
      platform: 'kick',
      channel: body?.broadcaster?.channel_slug ?? 'kick',
      username: body?.sender?.username ?? 'kick-user',
      text: body?.content ?? '',
      at: Date.parse(body?.created_at ?? new Date().toISOString()),
    };
    // Envie para seus clientes conectados (padrão simples: broadcast em memória).
    // Exemplo: globalThis.__kickEmit?.(msg)
  }

  return new Response('ok', { status: 200 });
}
