// lib/kickPusher.ts
export async function getKickChatroomId(slug: string): Promise<number | null> {
  const res = await fetch(
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
    {
      headers: { "User-Agent": "Mozilla/5.0 LiveChatUnifier/1.0" },
      cache: "no-store",
    }
  );
  if (!res.ok) return null;
  const j = await res.json();
  return j?.chatroom?.id ?? null;
}
