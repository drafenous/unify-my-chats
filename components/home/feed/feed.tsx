'use client';

import { useMain } from "@/providers/main/main";

export function Feed({ texts }: { texts: any }) {
    const { feed, isConnected } = useMain()
    return (
        <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{texts.feed.header}</strong>
                <small className="muted">{isConnected ? texts.feed.connected : texts.feed.disconnected}</small>
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
                {feed.length === 0 && <small className="muted">{texts.feed.no_messages}</small>}
            </div>
        </div>
    )
}