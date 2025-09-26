// lib/kick.ts
export type KickToken = { access_token: string; token_type: string; expires_in: number };

const ID_BASE = 'https://id.kick.com';
const API_BASE = 'https://api.kick.com/public/v1';

export async function getKickAppToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.KICK_CLIENT_ID!,
    client_secret: process.env.KICK_CLIENT_SECRET!,
  });
  const res = await fetch(`${ID_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Kick token fail');
  const data = (await res.json()) as KickToken;
  return data.access_token;
}

export async function getChannelBySlug(token: string, slug: string) {
  const url = new URL(`${API_BASE}/channels`);
  url.searchParams.set('slug', slug);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!res.ok) throw new Error('Kick channel fail');
  const json = await res.json();
  const first = json?.data?.[0];
  return first as { broadcaster_user_id: number; slug: string } | null;
}

export async function subscribeChatMessageWebhook(token: string, broadcasterUserId: number) {
  const res = await fetch(`${API_BASE}/events/subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      method: 'webhook',
      broadcaster_user_id: broadcasterUserId,
      events: [{ name: 'chat.message.sent', version: 1 }],
      // Se a doc exigir endpoint no corpo, adicione (algumas integrações usam registro prévio no painel):
      // endpoint: process.env.KICK_WEBHOOK_URL
    }),
  });
  if (!res.ok) throw new Error('Kick subscribe fail');
  return res.json(); // retorna subscription_id(s)
}
