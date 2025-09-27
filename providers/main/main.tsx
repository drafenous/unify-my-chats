'use client';

import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { parseSource } from '@/lib/urlParser';
import type { UnifiedChatMessage, ParsedSource } from '@/lib/types';

type MainContextValue = {
    input: string;
    setInput: (v: string) => void;

    sources: ParsedSource[];
    setSources: (v: ParsedSource[]) => void;

    detect: () => void;

    isConnected: boolean;
    connect: () => void;
    disconnect: () => void;

    feed: UnifiedChatMessage[];
    platformsSummary: Record<string, number>;
    showPlatformsErrorMessage: boolean;
    setShowPlatformsErrorMessage: (v: boolean) => void;
};

const MainContext = createContext<MainContextValue | undefined>(undefined);

export function MainProvider({ children }: { children: ReactNode }) {
    const [input, setInput] = useState('');
    const [sources, setSources] = useState<ParsedSource[]>([]);
    const [connected, setConnected] = useState(false); // twitch (aggregate)
    const [kickConnected, setKickConnected] = useState(false);
    const [ytConnected, setYtConnected] = useState(false);

    const [feed, setFeed] = useState<UnifiedChatMessage[]>([]);
    const [showPlatformsErrorMessage, setShowPlatformsErrorMessage] =
        useState(false);

    const esRef = useRef<EventSource | null>(null);
    const kickEsRef = useRef<EventSource | null>(null);
    const ytEsRef = useRef<EventSource | null>(null);
    const ytIntervalRef = useRef<any>(null);

    const isConnected = connected || kickConnected || ytConnected;

    const platformsSummary = useMemo(() => {
        const c: Record<string, number> = {};
        for (const s of sources) c[s.platform] = (c[s.platform] ?? 0) + 1;
        return c;
    }, [sources]);

    function b64(data: any) {
        const s = JSON.stringify(data);
        if (typeof window === 'undefined') {
            return Buffer.from(s, 'utf-8').toString('base64');
        }
        return btoa(unescape(encodeURIComponent(s)));
    }

    function detect() {
        const lines = input.split(/\n|,|\s/).map(s => s.trim()).filter(Boolean);
        if (lines.length === 0) {
            setSources([]);
            setShowPlatformsErrorMessage(true);
            return;
        }
        setShowPlatformsErrorMessage(false);
        const parsed = lines.map(parseSource);
        setSources(parsed);
    }

    useEffect(() => {
        // on mount: carregar do localStorage
        if (typeof window === 'undefined') return;
        const saved = window.localStorage.getItem('sources');
        if (saved) {
            try {
                const arr = JSON.parse(saved) as ParsedSource[];
                setSources(arr);
                setInput(arr.map(a => a.url).join('\n'));
            } catch { }
        }
    }, []);

    function saveToLocalStorage() {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('sources', JSON.stringify(sources));
    }

    async function startYouTube(videos: string[]) {
        try {
            await fetch('/api/youtube/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videos }),
            });
        } catch { }
    }

    function connect() {
        if (connected || kickConnected || ytConnected) return;

        const usable = sources.filter(s =>
            ['twitch', 'youtube', 'kick'].includes(s.platform),
        );

        if (usable.length === 0) {
            setShowPlatformsErrorMessage(true);
            return;
        }

        // TWITCH (aggregate)
        const twitchSrc = usable.filter(s => s.platform === 'twitch');
        if (twitchSrc.length) {
            const url = `/api/aggregate?sources=${encodeURIComponent(
                b64(twitchSrc.map(u => u.url)),
            )}`;
            const es = new EventSource(url);
            es.onopen = () => setConnected(true);
            if (process.env.ENABLE_TELEMETRY === '1') {
                es.addEventListener('info', ev => {
                    try {
                        console.log('twitch-info', JSON.parse((ev as MessageEvent).data));
                    } catch { }
                });
            }
            es.addEventListener('chat', ev => {
                try {
                    const msg = JSON.parse((ev as MessageEvent).data) as UnifiedChatMessage;
                    setFeed(prev => [msg, ...prev].slice(0, 1000));
                } catch { }
            });
            es.addEventListener('error', ev => console.warn('twitch-error', ev));
            esRef.current = es;
        }

        // KICK (ws provider)
        const kickSlugs = usable
            .filter(s => s.platform === 'kick' && s.channel)
            .map(s => s.channel as string);
        if (kickSlugs.length) {
            const url2 = `/api/kick/ws?slugs=${encodeURIComponent(b64(kickSlugs))}`;
            const kes = new EventSource(url2);
            kes.onopen = () => setKickConnected(true);
            if (process.env.ENABLE_TELEMETRY === '1') {
                kes.addEventListener('info', ev => {
                    try {
                        console.log('kick-info', JSON.parse((ev as MessageEvent).data));
                    } catch { }
                });
            }
            kes.addEventListener('chat', ev => {
                try {
                    const msg = JSON.parse((ev as MessageEvent).data) as UnifiedChatMessage;
                    setFeed(prev => [msg, ...prev].slice(0, 1000));
                } catch { }
            });
            kes.addEventListener('error', ev => console.warn('kick-error', ev));
            kickEsRef.current = kes;
        }

        // YOUTUBE (poll + SSE)
        const ytVideos = usable
            .filter(s => s.platform === 'youtube' && s.videoId)
            .map(s => s.videoId as string);
        if (ytVideos.length) {
            // dispara o “worker” ~55s e renova a cada 50s
            startYouTube(ytVideos);
            ytIntervalRef.current = setInterval(() => startYouTube(ytVideos), 50_000);

            const url3 = `/api/youtube/stream?videos=${encodeURIComponent(
                b64(ytVideos),
            )}`;
            const yes = new EventSource(url3);
            yes.onopen = () => setYtConnected(true);
            if (process.env.ENABLE_TELEMETRY === '1') {
                yes.addEventListener('info', ev => {
                    try {
                        console.log('yt-info', JSON.parse((ev as MessageEvent).data));
                    } catch { }
                });
            }
            yes.addEventListener('chat', ev => {
                try {
                    const msg = JSON.parse((ev as MessageEvent).data) as UnifiedChatMessage;
                    setFeed(prev => [msg, ...prev].slice(0, 1000));
                } catch { }
            });
            yes.addEventListener('error', ev => console.warn('yt-error', ev));
            ytEsRef.current = yes;
        }

        saveToLocalStorage();
    }

    function disconnect() {
        esRef.current?.close();
        esRef.current = null;
        setConnected(false);

        kickEsRef.current?.close();
        kickEsRef.current = null;
        setKickConnected(false);

        ytEsRef.current?.close();
        ytEsRef.current = null;
        setYtConnected(false);

        if (ytIntervalRef.current) {
            clearInterval(ytIntervalRef.current);
            ytIntervalRef.current = null;
        }
    }

    // encerra conexões ao desmontar o provider
    useEffect(() => {
        return () => {
            disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const value: MainContextValue = {
        input,
        setInput,
        sources,
        setSources,
        detect,
        isConnected,
        connect,
        disconnect,
        feed,
        platformsSummary,
        showPlatformsErrorMessage,
        setShowPlatformsErrorMessage,
    };

    return <MainContext.Provider value={value}>{children}</MainContext.Provider>;
}

export function useMain() {
    const ctx = useContext(MainContext);
    if (!ctx) {
        throw new Error('useHome must be used within <HomeProvider>');
    }
    return ctx;
}
