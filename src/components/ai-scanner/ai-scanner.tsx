import React, { useCallback, useEffect, useRef, useState } from 'react';
import ScannerPanel from './scanner-panel';
import ScannerBot from './scanner-bot';
import type { MarketScan } from './scanner-engine';
import './ai-scanner.scss';

const STORAGE_KEY = 'pm_ai_scanner_pos';
const DRAG_THRESHOLD = 5; // px of movement before a press counts as a drag, not a click

type Pos = { x: number; y: number };

const readSavedPos = (): Pos | null => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
    } catch (e) {}
    return null;
};

const AiScanner = () => {
    const ref = useRef<HTMLDivElement>(null);
    const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
    const [pos, setPos] = useState<Pos | null>(readSavedPos);
    const [open, setOpen] = useState(false);
    const [bot_open, setBotOpen] = useState(false);
    const [bot_running, setBotRunning] = useState(false);
    const [results, setResults] = useState<MarketScan[]>([]);
    const [found, setFound] = useState<MarketScan | null>(null);
    const [scanned, setScanned] = useState(false);

    const clamp = useCallback((p: Pos): Pos => {
        const el = ref.current;
        const w = el?.offsetWidth ?? 220;
        const h = el?.offsetHeight ?? 80;
        return {
            x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - w)),
            y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - h)),
        };
    }, []);

    // Default spot: bottom-left. Also keep it on screen when the window is resized.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        setPos(prev => clamp(prev ?? { x: 16, y: window.innerHeight - el.offsetHeight - 90 }));
        const onResize = () => setPos(prev => (prev ? clamp(prev) : prev));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [clamp]);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        drag.current = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        d.moved = true;
        setPos(clamp({ x: d.ox + dx, y: d.oy + dy }));
    };

    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        drag.current = null;
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch (err) {}
        if (!d) return;
        if (d.moved) {
            const rect = ref.current?.getBoundingClientRect();
            if (rect) {
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
                } catch (err) {}
            }
        } else {
            setOpen(true);
        }
    };

    return (
        <>
            <div
                ref={ref}
                className={`ai-scanner${open ? ' is-open' : ''}`}
                style={pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                role='button'
                aria-label='AI Scanner'
            >
                <div className='ai-scanner__card'>
                    <div className='ai-scanner__title'>AI Scanner</div>
                    <div className='ai-scanner__sub'>{bot_running ? 'Bot running…' : 'Click to analyze'}</div>
                </div>
                <div className='ai-scanner__orb'>
                    <span className='ai-scanner__ring ai-scanner__ring--1' />
                    <span className='ai-scanner__ring ai-scanner__ring--2' />
                    <span className='ai-scanner__circle'>
                        <span className='ai-scanner__ai'>AI</span>
                    </span>
                    <span className='ai-scanner__dot' />
                </div>
            </div>
            <ScannerPanel
                open={open}
                onClose={() => setOpen(false)}
                found={found}
                results={results}
                scanned={scanned}
                onResult={(list, best) => {
                    setResults(list);
                    setFound(best);
                    setScanned(true);
                }}
                onLoadBot={() => {
                    setOpen(false);
                    setBotOpen(true);
                }}
            />
            <ScannerBot
                open={bot_open}
                market={found}
                onClose={() => setBotOpen(false)}
                onRunningChange={setBotRunning}
            />
        </>
    );
};

export default AiScanner;
