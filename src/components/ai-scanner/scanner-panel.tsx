import React, { useEffect, useRef, useState } from 'react';
import { MarketScan, MAX_DEPTH, pickBest, scanAllMarkets } from './scanner-engine';

type Mode = { key: string; tab: string; mode: string; blurb: string };

const MODES: Mode[] = [
    {
        key: 'o1u8',
        tab: 'Over1 / Under8',
        mode: 'O1 / U8',
        blurb: 'Scans Over 1 and Under 8 with recovery confirmation.',
    },
    {
        key: 'o2u7',
        tab: 'Over2 / Under7',
        mode: 'O2 / U7',
        blurb: 'Scans Over 2 and Under 7 with recovery confirmation.',
    },
    {
        key: 'o3u6',
        tab: 'Over3 / Under6',
        mode: 'O3 / U6',
        blurb: 'Scans Over 3 and Under 6 with recovery confirmation.',
    },
];

type Props = {
    open: boolean;
    onClose: () => void;
    found: MarketScan | null;
    results: MarketScan[];
    scanned: boolean;
    onResult: (results: MarketScan[], found: MarketScan | null) => void;
    onLoadBot: () => void;
};

const ScannerPanel = ({ open, onClose, found, results, scanned, onResult, onLoadBot }: Props) => {
    const [active, setActive] = useState(MODES[0].key);
    const [ticks, setTicks] = useState('3000');
    const [scanning, setScanning] = useState(false);
    const [done, setDone] = useState(0);
    const [scan_error, setScanError] = useState('');
    const audio = useRef<any>(null);

    // Soft, machine-like beeping while scanning. It is a short looping buffer on the audio clock.
    useEffect(() => {
        if (!scanning) return;
        const ctx = audio.current;
        if (!ctx) return;
        let src: any = null;
        try {
            const rate = ctx.sampleRate;
            const buf = ctx.createBuffer(1, Math.floor(rate * 1.6), rate);
            const data = buf.getChannelData(0);
            const edge = Math.floor(rate * 0.008);
            for (let k = 0; k < 2; k++) {
                [0, 0.15].forEach(offset => {
                    const from = Math.floor(rate * (k * 0.8 + offset));
                    const n = Math.floor(rate * 0.07);
                    for (let i = 0; i < n; i++) {
                        const t = (2 * Math.PI * 1100 * i) / rate;
                        const wave = Math.sin(t) + Math.sin(3 * t) / 3 + Math.sin(5 * t) / 5;
                        data[from + i] = wave * Math.min(1, i / edge, (n - i) / edge) * 0.18;
                    }
                });
            }
            src = ctx.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            const soften = ctx.createBiquadFilter();
            soften.type = 'lowpass';
            soften.frequency.value = 2600;
            const gain = ctx.createGain();
            gain.gain.value = 0.5;
            src.connect(soften);
            soften.connect(gain);
            gain.connect(ctx.destination);
            src.start();
        } catch (e) {
            // no sound available
        }
        return () => {
            try {
                src?.stop();
            } catch (e) {
                // already stopped
            }
        };
    }, [scanning]);
    const mode = MODES.find(m => m.key === active) ?? MODES[0];

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    const depth = Math.min(MAX_DEPTH - 100, Math.max(100, Number(ticks) || 3000));

    // Only Over1 / Under8 has its strategy so far; the other two tabs come later.
    const strategy_ready = active === 'o1u8';

    const scan = async () => {
        if (scanning) return;
        // browsers only allow sound after a click, so the audio is started here
        try {
            if (!audio.current) {
                const AC = window.AudioContext || (window as any).webkitAudioContext;
                if (AC) audio.current = new AC();
            }
            audio.current?.resume?.();
        } catch (e) {
            // no sound available
        }
        setScanning(true);
        setScanError('');
        setDone(0);
        try {
            const started = Date.now();
            const list = await scanAllMarkets(depth, setDone);
            // keep the scanning state (and its beeping) up for a moment so it can be heard
            await new Promise(r => setTimeout(r, Math.max(0, 2500 - (Date.now() - started))));
            if (!list.length) throw new Error('Could not load any market. Check your connection and try again.');
            onResult(list, pickBest(list));
        } catch (e: any) {
            setScanError(e?.message || 'Scan failed. Try again.');
        } finally {
            setScanning(false);
        }
    };

    if (!open) return null;

    return (
        <div className='scanner-panel__backdrop' onClick={onClose}>
            <div className='scanner-panel' role='dialog' aria-label='Entry Scanner' onClick={e => e.stopPropagation()}>
                <div className='scanner-panel__header'>
                    <h2>Entry Scanner</h2>
                    <button type='button' className='scanner-panel__close' onClick={onClose} aria-label='Close'>
                        <svg
                            width='22'
                            height='22'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                        >
                            <path d='M4 4l16 16M20 4L4 20' />
                        </svg>
                    </button>
                </div>

                <div className='scanner-panel__body'>
                    <div className='scanner-panel__hero'>
                        <div className='scanner-panel__hero-text'>
                            <span className='scanner-panel__pill'>✦ RECOVERY ENGINE</span>
                            <h3>Digits Scanner</h3>
                            <p>{mode.blurb}</p>
                        </div>
                        <div className='scanner-panel__radar' aria-hidden='true'>
                            <span className='scanner-panel__radar-ring scanner-panel__radar-ring--1' />
                            <span className='scanner-panel__radar-ring scanner-panel__radar-ring--2' />
                            <span className='scanner-panel__radar-ring scanner-panel__radar-ring--3' />
                            <span className='scanner-panel__sweep' />
                            <span className='scanner-panel__radar-ai'>AI</span>
                            <span className='scanner-panel__blip scanner-panel__blip--a' />
                            <span className='scanner-panel__blip scanner-panel__blip--b' />
                            <span className='scanner-panel__blip scanner-panel__blip--c' />
                        </div>
                    </div>

                    <div className='scanner-panel__tabs' role='tablist'>
                        {MODES.map(m => (
                            <button
                                key={m.key}
                                type='button'
                                role='tab'
                                aria-selected={m.key === active}
                                className={m.key === active ? 'is-active' : ''}
                                onClick={() => setActive(m.key)}
                            >
                                {m.tab.replace(' / ', ' / ')}
                            </button>
                        ))}
                    </div>

                    <div className='scanner-panel__card scanner-panel__row3'>
                        <div className='scanner-panel__field'>
                            <label>SCAN DEPTH</label>
                            <strong>{ticks || '—'}</strong>
                        </div>
                        <div className='scanner-panel__field'>
                            <label>MODE</label>
                            <strong>{mode.mode}</strong>
                        </div>
                        <div className='scanner-panel__ticks'>
                            <label>TICKS</label>
                            <input
                                inputMode='numeric'
                                value={ticks}
                                onChange={e => setTicks(e.target.value.replace(/\D/g, '').slice(0, 5))}
                            />
                        </div>
                    </div>

                    <div className='scanner-panel__card scanner-panel__row2'>
                        <div>
                            <label>SELECTED MARKET</label>
                            <div className='scanner-panel__box'>
                                {found ? found.name : scanned ? 'No market found' : 'Scan to find the best market'}
                            </div>
                        </div>
                        <div>
                            <label>TRADE TYPE</label>
                            <div className='scanner-panel__box'>{found ? 'Under 8' : 'Waiting for scan'}</div>
                        </div>
                    </div>

                    <div className='scanner-panel__card scanner-panel__status'>
                        {scan_error
                            ? scan_error
                            : scanning
                              ? `Scanning all volatilities… ${done}/10`
                              : !strategy_ready
                                ? 'This strategy is coming soon.'
                                : found
                                  ? `Found: ${found.name} — signal Under 8 (digit 8 ${found.p8}%, digit 9 ${found.p9}%, both decreasing). Recovery: Under 5.`
                                  : scanned
                                    ? 'No signal right now (8 and 9 must both be 10% or lower and decreasing). Scan again.'
                                    : 'Not scanned yet'}
                    </div>

                    {strategy_ready && scanned && results.length > 0 && (
                        <div className='scanner-panel__card scanner-panel__results'>
                            {results.map(r => (
                                <div key={r.symbol} className={`scanner-panel__result${r.signal ? ' is-signal' : ''}`}>
                                    <span>{r.name}</span>
                                    <span>
                                        8: {r.p8}% {r.p8 < r.before8 ? '↓' : '↑'} · 9: {r.p9}%{' '}
                                        {r.p9 < r.before9 ? '↓' : '↑'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className='scanner-panel__actions'>
                        <button
                            type='button'
                            className='scanner-panel__btn scanner-panel__btn--primary'
                            onClick={scan}
                            disabled={scanning || !strategy_ready}
                        >
                            {scanning ? 'Scanning…' : scanned ? 'Scan Again' : 'Scan Markets'}
                        </button>
                        <button
                            type='button'
                            className='scanner-panel__btn'
                            onClick={onLoadBot}
                            disabled={!found || scanning}
                        >
                            Load Scanner Bot
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ScannerPanel;
