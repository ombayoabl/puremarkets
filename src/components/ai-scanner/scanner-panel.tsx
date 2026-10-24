import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { playConfirmSound, unlockScanSound, useScanSound } from '../scan-sound/scan-sound';
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

// "1HZ10V" -> "V10 (1s)", "R_50" -> "V50"
const shortName = (symbol: string) => {
    const m = symbol.match(/^(1HZ)?(?:R_)?(\d+)V?$/);
    return m ? `V${m[2]}${m[1] ? ' (1s)' : ''}` : symbol;
};

type Props = {
    open: boolean;
    onClose: () => void;
    found: MarketScan | null;
    results: MarketScan[];
    scanned: boolean;
    onResult: (results: MarketScan[], found: MarketScan | null) => void;
    onLoadBot: () => void;
    onClear: () => void;
};

const ScannerPanel = ({ open, onClose, found, results, scanned, onResult, onLoadBot, onClear }: Props) => {
    const [active, setActive] = useState(MODES[0].key);
    const [ticks, setTicks] = useState('1000');
    const [scanning, setScanning] = useState(false);
    const [done, setDone] = useState(0);
    const [scan_error, setScanError] = useState('');
    const [found_popup, setFoundPopup] = useState(false);

    useScanSound(scanning); // the scratching sound from the user's video, looped while scanning
    const cancel_scan = useRef(false);
    const scan_id = useRef(0); // a new scan makes any older, still-finishing scan stop quietly
    const [round, setRound] = useState(0);
    const mode = MODES.find(m => m.key === active) ?? MODES[0];

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    const depth = Math.min(MAX_DEPTH - 100, Math.max(100, Number(ticks) || 1000));

    // Only Over1 / Under8 has its strategy so far; the other two tabs come later.
    const strategy_ready = active === 'o1u8';

    const scan = async () => {
        if (scanning) return;
        unlockScanSound(); // browsers only allow sound after a click
        onClear(); // a new scan starts clean: the earlier signal is forgotten
        setScanning(true);
        setScanError('');
        setDone(0);
        setRound(1);
        cancel_scan.current = false;
        scan_id.current += 1;
        const my_id = scan_id.current;
        const stale = () => cancel_scan.current || scan_id.current !== my_id;
        const MIN_MS = 7000; // the sound plays for at least about 7 seconds, even if a market is found at once
        const started = Date.now();
        try {
            let rounds = 0;
            // keep analysing until a market with the best entry is found (or Stop is pressed)
            while (!stale()) {
                rounds += 1;
                setRound(rounds);
                setDone(0);
                const list = await scanAllMarkets(depth, setDone);
                if (stale()) return;
                if (!list.length) throw new Error('Could not load any market. Check your connection and try again.');
                const best = pickBest(list);
                if (best) {
                    await new Promise(r => setTimeout(r, Math.max(0, MIN_MS - (Date.now() - started))));
                    if (stale()) return;
                    onResult(list, best);
                    playConfirmSound(); // tick + chime, then the popup
                    setFoundPopup(true); // small "market found" popup, straight away
                    return;
                }
                onResult(list, null); // show the latest numbers while it keeps looking
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e: any) {
            setScanError(e?.message || 'Scan failed. Try again.');
        } finally {
            if (scan_id.current === my_id) setScanning(false);
        }
    };

    const stopScan = () => {
        cancel_scan.current = true;
        setScanning(false);
    };

    // closing the panel stops the scan (and its sound)
    useEffect(() => {
        if (!open) cancel_scan.current = true;
    }, [open]);

    if (!open) return null;

    return (
        <div className='scanner-panel__backdrop' onClick={onClose}>
            {found_popup &&
                found &&
                createPortal(
                    <div className='scanner-found__overlay' onClick={() => setFoundPopup(false)}>
                        <div className='scanner-found' onClick={e => e.stopPropagation()} role='alertdialog'>
                            <div className='scanner-found__title'>Market found ✅</div>
                            <div className='scanner-found__market'>{found.name}</div>
                            <div className='scanner-found__sub'>
                                Under 8 · digit 8 {found.p8}% · digit 9 {found.p9}%
                            </div>
                            <div className='scanner-found__actions'>
                                <button
                                    type='button'
                                    className='scanner-found__btn scanner-found__btn--primary'
                                    onClick={() => {
                                        setFoundPopup(false);
                                        onLoadBot();
                                    }}
                                >
                                    Load Scanner Bot
                                </button>
                                <button
                                    type='button'
                                    className='scanner-found__btn'
                                    onClick={() => setFoundPopup(false)}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

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
                              ? `Analysing all volatilities… round ${round} (${done}/10). It keeps looking until the best entry is found.`
                              : !strategy_ready
                                ? 'This strategy is coming soon.'
                                : found
                                  ? `Found: ${found.name} — signal Under 8 (digit 8 ${found.p8}%, digit 9 ${found.p9}%). Recovery: Under 5.`
                                  : scanned
                                    ? 'No signal right now (8 and 9 must both be 10% or lower). Scan again.'
                                    : 'Not scanned yet'}
                    </div>

                    {strategy_ready && scanned && results.length > 0 && (
                        <div className='scanner-panel__card scanner-panel__results'>
                            {results.map(r => (
                                <div
                                    key={r.symbol}
                                    className={`scanner-panel__result${r.signal ? ' is-signal' : ''}${found?.symbol === r.symbol ? ' is-best' : ''}`}
                                    title={`${r.name} — 8: ${r.p8}%, 9: ${r.p9}%`}
                                >
                                    <b>
                                        {found?.symbol === r.symbol ? '★ ' : ''}
                                        {shortName(r.symbol)}
                                    </b>
                                    <span className='scanner-panel__d'>8: {r.p8}%</span>
                                    <span className='scanner-panel__d'>9: {r.p9}%</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className='scanner-panel__actions'>
                        <button
                            type='button'
                            className={`scanner-panel__btn ${scanning ? 'scanner-panel__btn--stop' : 'scanner-panel__btn--primary'}`}
                            onClick={scanning ? stopScan : scan}
                            disabled={!strategy_ready}
                        >
                            {scanning ? 'Stop Scan' : scanned ? 'Scan Again' : 'Scan Markets'}
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
