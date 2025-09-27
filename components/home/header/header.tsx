'use client';

import { useMain } from "@/providers/main/main";

export function Header({ texts }: { texts: any }) {
    const { connect, detect, disconnect, input, isConnected, platformsSummary, setInput, showPlatformsErrorMessage, sources } = useMain()
    return (
        <div className="card" style={{ marginBottom: 16 }}>
            <h1>{texts.app_title} <small className="muted">({texts.app_subtitle})</small></h1>
            <p dangerouslySetInnerHTML={{ __html: texts.app_description }}></p>
            <div className="row" style={{ marginTop: 12 }}>
                <div style={{ flexGrow: 1, marginRight: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <textarea className="input w-full" rows={4} placeholder={texts.form.input_placeholder} value={input} onChange={e => setInput(e.target.value)} />
                    {showPlatformsErrorMessage && (<div style={{ color: 'red' }} dangerouslySetInnerHTML={{ __html: texts.form.error_no_valid_url }}></div>
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 180 }}>
                    <button className="btn" onClick={detect}>{texts.form.button_detect_platforms}</button>
                    {!isConnected ? (
                        <button className="btn" onClick={connect}>{texts.form.button_connect}</button>
                    ) : (
                        <button className="btn secondary" onClick={disconnect}>{texts.form.button_disconnect}</button>
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
    )
}