'use client';

import './globals.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseSource } from '@/lib/urlParser';
import type { UnifiedChatMessage, ParsedSource } from '@/lib/types';

function b64(data: any) { return Buffer.from(JSON.stringify(data), 'utf-8').toString('base64'); }

export default function Page() {
  const [input, setInput] = useState('');
  const [sources, setSources] = useState<ParsedSource[]>([]);
  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState<UnifiedChatMessage[]>([]);
  const esRef = useRef<EventSource | null>(null);

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
    if (connected) return;
    const usable = sources.filter(s => ['twitch', 'youtube', 'kick'].includes(s.platform));
    if (usable.length === 0) {
      alert('Adicione pelo menos uma URL válida de Twitch ou YouTube.');
      return;
    }
    const url = `/api/aggregate?sources=${encodeURIComponent(b64(usable.map(u => u.url)))}`;
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.addEventListener('chat', (ev) => {
      try {
        const msg = JSON.parse((ev as MessageEvent).data) as UnifiedChatMessage;
        setFeed(prev => [msg, ...prev].slice(0, 1000));
      } catch { }
    });
    es.addEventListener('meta', (ev) => {
      // could display meta if needed
    });
    es.addEventListener('info', (ev) => {
      console.log('info', (ev as MessageEvent).data);
    });
    es.addEventListener('error', (ev) => {
      console.warn('error', ev);
    });
    saveToLocalStorage()
    esRef.current = es;
  }

  function disconnect() {
    esRef.current?.close();
    esRef.current = null;
    setConnected(false);
  }

  return (
    <div className="container">
      <div className="card" style={{ marginBottom: 16 }}>
        <h1>Unify My Chats <small className="muted">MVP (leitura apenas)</small></h1>
        <p>Informe as URLs dos chats das lives (Twitch, Kick ou YouTube <em>vídeo</em> em live) separados por vírgula ou quebra de linha. Nenhum login é necessário. Envio de mensagens é propositalmente desativado.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <textarea className="input" rows={4} placeholder="Exemplos: https://www.twitch.tv/gaules, https://www.youtube.com/watch?v=XXXXXXXXXXX" value={input} onChange={e => setInput(e.target.value)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 180 }}>
            <button className="btn" onClick={detect}>Detectar plataformas</button>
            {!connected ? (
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
          <small className="muted">{connected ? 'Conectado' : 'Desconectado'}</small>
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
