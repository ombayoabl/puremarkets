import React, { useEffect, useState } from 'react';

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

type Props = { open: boolean; onClose: () => void };

const ScannerPanel = ({ open, onClose }: Props) => {
    const [active, setActive] = useState(MODES[0].key);
    const [ticks, setTicks] = useState('3000');
    const mode = MODES.find(m => m.key === active) ?? MODES[0];

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

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
                            <div className='scanner-panel__box'>Scan to find the best market</div>
                        </div>
                        <div>
                            <label>TRADE TYPE</label>
                            <div className='scanner-panel__box'>Waiting for scan</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ScannerPanel;
