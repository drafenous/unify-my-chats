'use client';

import './globals.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseSource } from '@/lib/urlParser';
import type { UnifiedChatMessage, ParsedSource } from '@/lib/types';


export default function Page() {
  const [input, setInput] = useState('');
  const [sources, setSources] = useState<ParsedSource[]>([]);
  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState<UnifiedChatMessage[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const [kickConnected, setKickConnected] = useState(false);
  const kickEsRef = useRef<EventSource | null>(null);
  const [ytConnected, setYtConnected] = useState(false);
  const ytEsRef = useRef<EventSource | null>(null);
  const ytIntervalRef = useRef<any>(null);

  const platformsSummary = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of sources) c[s.platform] = (c[s.platform] ?? 0) + 1;
    return c;
  }, [sources]);

  function detect() {
    const lines = input.split(/\n|,|\s/).map(s => s.trim()).filter(Boolean);
    const parsed = lines.map(parseSource);
    setSources(parsed);
  }

  useEffect(() => {
    loadFromLocalStorage();
  }, []);

  function b64(data: any) {
    const s = JSON.stringify(data);
    if (typeof window === 'undefined') {
      // @ts-ignore
      return Buffer.from(s, 'utf-8').toString('base64');
    }
    return btoa(unescape(encodeURIComponent(s)));
  }

  async function startYouTube(videos: string[]) {
    try {
      await fetch("/api/youtube/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videos }),
      });
    } catch { }
  }

  function loadFromLocalStorage() {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('sources');
    if (saved) {
      try {
        const arr = JSON.parse(saved) as ParsedSource[];
        setSources(arr);
        setInput(arr.map(a => a.url).join('\n'));
      } catch { }
    }
  }

  function saveToLocalStorage() {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('sources', JSON.stringify(sources));
  }

  function connect() {
    if (isConnected) return;
    const usable = sources.filter(s => ['twitch', 'youtube', 'kick'].includes(s.platform));
    if (usable.length === 0) {
      alert('Adicione pelo menos uma URL válida de Twitch, Kick ou YouTube.');
      return;
    }

    // 1) Twitch (via /api/aggregate) — sem YouTube aqui
    const aggUsable = usable.filter(s => ['twitch'].includes(s.platform));
    if (aggUsable.length) {
      const url = `/api/aggregate?sources=${encodeURIComponent(b64(aggUsable.map(u => u.url)))}`;
      const es = new EventSource(url);
      es.onopen = () => setConnected(true);
      es.addEventListener('info', (ev) => {
        try { console.log('twitch-info', JSON.parse((ev as MessageEvent).data)); } catch { }
      });
      es.addEventListener('chat', (ev) => {
        try {
          const msg = JSON.parse((ev as MessageEvent).data) as UnifiedChatMessage;
          setFeed(prev => [msg, ...prev].slice(0, 1000));
        } catch { }
      });
      es.addEventListener('error', (ev) => console.warn('twitch-error', ev));
      esRef.current = es;
    }

    // 2) Kick (já tinha)
    const kickSlugs = usable.filter(s => s.platform === 'kick' && s.channel).map(s => s.channel as string);
    if (kickSlugs.length) {
      const url2 = `/api/kick/ws?slugs=${encodeURIComponent(b64(kickSlugs))}`;
      const kes = new EventSource(url2);
      kes.onopen = () => setKickConnected(true);
      kes.addEventListener('info', (ev) => {
        try { console.log('kick-info', JSON.parse((ev as MessageEvent).data)); } catch { }
      });
      kes.addEventListener('chat', (ev) => {
        try {
          const msg = JSON.parse((ev as MessageEvent).data) as UnifiedChatMessage;
          setFeed(prev => [msg, ...prev].slice(0, 1000));
        } catch { }
      });
      kes.addEventListener('error', (ev) => console.warn('kick-error', ev));
      kickEsRef.current = kes;
    }

    // 3) YouTube — novo fluxo
    const ytVideos = usable.filter(s => s.platform === 'youtube' && s.videoId).map(s => s.videoId as string);
    if (ytVideos.length) {
      // dispara o "worker" por ~55s e renova a cada 50s
      startYouTube(ytVideos);
      ytIntervalRef.current = setInterval(() => startYouTube(ytVideos), 50_000);

      const url3 = `/api/youtube/stream?videos=${encodeURIComponent(b64(ytVideos))}`;
      const yes = new EventSource(url3);
      yes.onopen = () => setYtConnected(true);
      yes.addEventListener('info', (ev) => {
        try { console.log('yt-info', JSON.parse((ev as MessageEvent).data)); } catch { }
      });
      yes.addEventListener('chat', (ev) => {
        try {
          const msg = JSON.parse((ev as MessageEvent).data) as UnifiedChatMessage;
          setFeed(prev => [msg, ...prev].slice(0, 1000));
        } catch { }
      });
      yes.addEventListener('error', (ev) => console.warn('yt-error', ev));
      ytEsRef.current = yes;
    }

    // opcional: persistir
    saveToLocalStorage();
  }

  function disconnect() {
    esRef.current?.close(); esRef.current = null; setConnected(false);
    kickEsRef.current?.close(); kickEsRef.current = null; setKickConnected(false);
    ytEsRef.current?.close(); ytEsRef.current = null; setYtConnected(false);

    if (ytIntervalRef.current) { clearInterval(ytIntervalRef.current); ytIntervalRef.current = null; }
  }

  const isConnected = connected || kickConnected || ytConnected;

  return (
    <div className="container">
      <div className="card" style={{ marginBottom: 16 }}>
        <h1>Unify My Chats <small className="muted">(MVP)</small></h1>
        <p>Informe as URLs dos chats das lives (Twitch, Kick ou YouTube <em>vídeo</em> em live) separados por vírgula ou quebra de linha. Nenhum login é necessário. Envio de mensagens é propositalmente desativado.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <textarea className="input" rows={4} placeholder="Exemplos: https://www.twitch.tv/gaules, https://www.youtube.com/watch?v=XXXXXXXXXXX" value={input} onChange={e => setInput(e.target.value)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 180 }}>
            <button className="btn" onClick={detect}>Detectar plataformas</button>
            {!isConnected ? (
              <button className="btn" onClick={connect}>Conectar</button>
            ) : (
              <button className="btn secondary" onClick={disconnect}>Desconectar</button>
            )}
          </div>
        </div>
        {sources.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="row">
              {Object.entries(platformsSummary).map(([p, n]) => (
                <span key={p} className={['badge', p].join(' ')}>{p}: {n}</span>
              ))}
            </div>
            <ul style={{ marginTop: 8 }}>
              {sources.map((s, i) => (
                <li key={i}><small className="muted">{s.url}</small> {s.note ? <em> — {s.note}</em> : null}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>Feed Unificado</strong>
          <small className="muted">{isConnected ? 'Conectado' : 'Desconectado'}</small>
        </div>
        <div className="list" style={{ marginTop: 8 }}>
          {feed.map((m, index) => (
            <div className="msg" key={m.id + '_' + m.at + '_' + index}>
              <div className="meta">
                <span className={['badge', m.platform].join(' ')}>{m.platform}</span>
                <span className="username">@{m.username}</span>
              </div>
              <div>
                <div><span className="time">{new Date(m.at).toLocaleTimeString()}</span> — <span className="platform">{m.channel}</span></div>
                <div>{m.text}</div>
              </div>
            </div>
          ))}
          {feed.length === 0 && <small className="muted">Sem mensagens ainda. Conecte-se para começar.</small>}
        </div>
      </div>
    </div>
  );
}
