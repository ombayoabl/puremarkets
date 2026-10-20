// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import './dtrader.scss';

// DTrader (Deriv DTrader look): open positions on the left, live chart in the middle,
// trade types + trade settings on the right. Uses the same Deriv connection as the other pages.

const MARKETS = [
    { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index', dp: 2, badge: '10' },
    { symbol: 'R_10', name: 'Volatility 10 Index', dp: 3, badge: '10' },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index', dp: 2, badge: '25' },
    { symbol: 'R_25', name: 'Volatility 25 Index', dp: 3, badge: '25' },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index', dp: 2, badge: '50' },
    { symbol: 'R_50', name: 'Volatility 50 Index', dp: 4, badge: '50' },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index', dp: 2, badge: '75' },
    { symbol: 'R_75', name: 'Volatility 75 Index', dp: 4, badge: '75' },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index', dp: 2, badge: '100' },
    { symbol: 'R_100', name: 'Volatility 100 Index', dp: 2, badge: '100' },
];
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const MULTIPLIERS = {
    10: [400, 500, 1000, 1500, 2000],
    25: [160, 200, 400, 600, 800],
    50: [80, 100, 200, 300, 500],
    75: [50, 75, 100, 150, 300],
    100: [40, 60, 80, 100, 200],
};
const UNIT_NAMES = { t: 'Ticks', s: 'Seconds', m: 'Minutes', h: 'Hours', d: 'Days' };

// group = heading in the Trade types list; cat = filter on the left of the list
const TYPES = [
    { key: 'accu', group: 'Accumulators', cat: 'accumulators', label: 'Accumulators', icons: ['accu'] },
    { key: 'vanilla', group: 'Vanillas', cat: 'options', label: 'Call/Put', icons: ['up', 'down'], units: ['m', 'h', 'd'] },
    { key: 'turbos', group: 'Turbos', cat: 'options', label: 'Turbos', icons: ['up', 'down'], units: ['t', 'm', 'h', 'd'] },
    { key: 'multipliers', group: 'Multipliers', cat: 'multipliers', label: 'Multipliers', icons: ['up', 'down'] },
    { key: 'risefall', group: 'Ups & Downs', cat: 'options', label: 'Rise/Fall', icons: ['up', 'down'], units: ['t', 's', 'm', 'h', 'd'] },
    { key: 'higherlower', group: 'Ups & Downs', cat: 'options', label: 'Higher/Lower', icons: ['up', 'down'], units: ['s', 'm', 'h', 'd'] },
    { key: 'touch', group: 'Touch & No Touch', cat: 'options', label: 'Touch/No Touch', icons: ['up', 'down'], units: ['m', 'h', 'd'] },
    { key: 'matchdiffer', group: 'Digits', cat: 'options', label: 'Matches/Differs', icons: ['match', 'differ'] },
    { key: 'evenodd', group: 'Digits', cat: 'options', label: 'Even/Odd', icons: ['even', 'odd'] },
    { key: 'overunder', group: 'Digits', cat: 'options', label: 'Over/Under', icons: ['up', 'down'] },
];
const GROUPS = ['Accumulators', 'Vanillas', 'Turbos', 'Multipliers', 'Ups & Downs', 'Touch & No Touch', 'Digits'];
const DIGIT_TYPES = ['matchdiffer', 'evenodd', 'overunder'];
const BARRIER_TYPES = ['vanilla', 'turbos', 'higherlower', 'touch'];
const BASIS_TYPES = ['risefall', 'higherlower', 'touch', 'matchdiffer', 'evenodd', 'overunder'];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toDigit = (quote: number | string, dp: number) => Number(Number(quote).toFixed(dp).slice(-1));
const errMsg = (e: any) => e?.error?.message || e?.message || localize('Something went wrong');
const volOf = (symbol: string) => {
    const m = symbol.match(/(\d+)V$/) || symbol.match(/_(\d+)$/);
    return m ? Number(m[1]) : 100;
};
const percents = (list: number[]) => {
    const counts = Array(10).fill(0);
    list.forEach(d => (counts[d] += 1));
    const total = list.length || 1;
    return counts.map(n => (n / total) * 100);
};
const pad = (n: number) => String(n).padStart(2, '0');
const hms = (epoch: number) => {
    const d = new Date(epoch * 1000);
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const dmyhms = (epoch: number) => {
    const d = new Date(epoch * 1000);
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${hms(epoch)}`;
};
const signed = (n: number, dp: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(dp)}`;
const niceStep = (range: number, count: number) => {
    const raw = range / count || 1;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
};
const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 43200, 86400];

const durationRange = (type_key: string, unit: string) => {
    if (unit === 't') return [5, 10];
    if (unit === 's') return [15, 86400];
    if (unit === 'm') return [type_key === 'touch' ? 2 : 1, 1440];
    if (unit === 'h') return [1, 24];
    return [1, 365];
};

// ---------- small icons ----------
const Arrow = ({ down, boxed }: any) => (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='#e5484d' strokeWidth='1.8'>
        {boxed && <rect x='1.5' y='1.5' width='21' height='21' rx='3' stroke='#f3b4b6' />}
        {down ? <path d='M6 6l12 12M18 11v7h-7' /> : <path d='M6 18L18 6M11 6h7v7' />}
    </svg>
);
const TypeIcon = ({ name }: any) => {
    if (name === 'up') return <Arrow />;
    if (name === 'down') return <Arrow down />;
    if (name === 'accu')
        return (
            <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='#e5484d' strokeWidth='1.8'>
                <rect x='1.5' y='3' width='21' height='18' rx='3' stroke='#f3b4b6' />
                <path d='M5 15l4-5 3 3 6-6' />
            </svg>
        );
    return (
        <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='#e5484d' strokeWidth='1.8'>
            <rect x='1.5' y='1.5' width='21' height='21' rx='3' stroke='#f3b4b6' />
            {name === 'match' && <path d='M12 6v12M6 12h12M7.5 7.5l9 9M16.5 7.5l-9 9' />}
            {name === 'differ' && <path d='M12 6v12M6 12h12M7.5 7.5l9 9M16.5 7.5l-9 9' opacity='0.6' />}
            {name === 'even' && <path d='M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z' />}
            {name === 'odd' && <path d='M12 5l7 13H5z' />}
        </svg>
    );
};
const Chevron = ({ dir = 'left' }: any) => (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
        {dir === 'left' ? <path d='M15 5l-7 7 7 7' /> : dir === 'right' ? <path d='M9 5l7 7-7 7' /> : <path d='M5 9l7 7 7-7' />}
    </svg>
);

// ---------- chart ----------
const Chart = ({ ticks, dp, overlays, visible, area, grid, name, children }: any) => {
    const box = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ w: 600, h: 400 });
    const [hover, setHover] = useState<number | null>(null);

    useEffect(() => {
        if (!box.current) return;
        const ro = new ResizeObserver(entries => {
            const r = entries[0].contentRect;
            setSize({ w: Math.max(200, r.width), h: Math.max(200, r.height) });
        });
        ro.observe(box.current);
        return () => ro.disconnect();
    }, []);

    const AXIS = 66;
    const BOTTOM = 34;
    const TOP = 14;
    const plotW = size.w - AXIS;
    const plotH = size.h - BOTTOM - TOP;
    const shown = ticks.slice(-visible);
    const last = shown[shown.length - 1];

    const geo = useMemo(() => {
        if (!last) return null;
        const t0 = shown[0].t;
        const span = Math.max(1, last.t - t0);
        const drawW = plotW * 0.74;
        const x = (t: number) => ((t - t0) / span) * drawW;
        let lo = Infinity;
        let hi = -Infinity;
        shown.forEach((p: any) => {
            lo = Math.min(lo, p.q);
            hi = Math.max(hi, p.q);
        });
        overlays.forEach((o: any) => {
            [o.price, o.price2].forEach(v => {
                if (typeof v === 'number' && isFinite(v)) {
                    lo = Math.min(lo, v);
                    hi = Math.max(hi, v);
                }
            });
        });
        if (hi - lo < 1e-9) {
            hi += 0.5;
            lo -= 0.5;
        }
        const margin = (hi - lo) * 0.12;
        lo -= margin;
        hi += margin;
        const y = (q: number) => TOP + (1 - (q - lo) / (hi - lo)) * plotH;
        const step = niceStep(hi - lo, Math.max(3, Math.floor(plotH / 80)));
        const ys: number[] = [];
        for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ys.push(v);
        const total_s = span / 0.74;
        const want = Math.max(2, Math.floor(plotW / 100));
        const tstep = TIME_STEPS.find(s => total_s / s <= want) || 86400;
        const xs: number[] = [];
        for (let tt = Math.ceil(t0 / tstep) * tstep; tt <= t0 + total_s; tt += tstep) xs.push(tt);
        return { t0, x, y, ys, xs, drawW, step };
    }, [shown.length, last?.t, last?.q, plotW, plotH, overlays]);

    if (!geo || !last) {
        return (
            <div className='dtrader__chart' ref={box}>
                <div className='dtrader__chart-empty'>{localize('Loading chart…')}</div>
                {children}
            </div>
        );
    }
    const { x, y, ys, xs } = geo;
    const line = shown.map((p: any, i: number) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.q).toFixed(1)}`).join('');
    const areaPath = `${line}L${x(last.t).toFixed(1)},${TOP + plotH}L0,${TOP + plotH}Z`;
    const hp = hover !== null ? shown[hover] : null;
    const tag = (px: number, py: number, text: string, cls: string) => (
        <g key={`${cls}-${text}-${py}`}>
            <rect x={px} y={py - 10} width={AXIS - 8} height='20' rx='3' className={cls} />
            <text x={px + (AXIS - 8) / 2} y={py + 4} textAnchor='middle' className='dtrader__tag-text'>
                {text}
            </text>
        </g>
    );

    return (
        <div className='dtrader__chart' ref={box}>
            <svg width={size.w} height={size.h} className='dtrader__svg'>
                <defs>
                    <linearGradient id='dt-area' x1='0' y1='0' x2='0' y2='1'>
                        <stop offset='0%' stopColor='#c9c9c9' stopOpacity='0.55' />
                        <stop offset='100%' stopColor='#c9c9c9' stopOpacity='0.02' />
                    </linearGradient>
                </defs>
                {grid &&
                    ys.map(v => <line key={`gy${v}`} x1='0' x2={plotW} y1={y(v)} y2={y(v)} className='dtrader__grid' />)}
                {grid && xs.map(t => <line key={`gx${t}`} y1={TOP} y2={TOP + plotH} x1={x(t)} x2={x(t)} className='dtrader__grid' />)}
                {ys.map(v => (
                    <text key={`ly${v}`} x={plotW + 8} y={y(v) + 3} className='dtrader__axis-text'>
                        {v.toFixed(dp)}
                    </text>
                ))}
                {xs.map(t => (
                    <text key={`lx${t}`} x={x(t)} y={size.h - 12} textAnchor='middle' className='dtrader__axis-text'>
                        {hms(t)}
                    </text>
                ))}
                {area && <path d={areaPath} fill='url(#dt-area)' />}
                <path d={line} className='dtrader__line' />

                {overlays.map((o: any, i: number) => {
                    const lx = x(last.t);
                    if (o.kind === 'box') {
                        const top = y(o.price);
                        const bottom = y(o.price2);
                        return (
                            <g key={i}>
                                <rect x={lx} y={top} width={plotW - lx} height={bottom - top} className='dtrader__box' />
                                <line x1={lx} x2={plotW} y1={top} y2={top} className='dtrader__box-line' />
                                <line x1={lx} x2={plotW} y1={bottom} y2={bottom} className='dtrader__box-line' />
                                <text x={plotW - 6} y={top - 6} textAnchor='end' className='dtrader__box-text'>
                                    {o.label}
                                </text>
                                <text x={plotW - 6} y={bottom + 14} textAnchor='end' className='dtrader__box-text'>
                                    {o.label2}
                                </text>
                            </g>
                        );
                    }
                    const py = y(o.price);
                    return (
                        <g key={i}>
                            <line
                                x1='0'
                                x2={plotW}
                                y1={py}
                                y2={py}
                                className={classNames('dtrader__level', `dtrader__level--${o.tone || 'blue'}`)}
                            />
                            {o.title && (
                                <text x={plotW - 6} y={py - 6} textAnchor='end' className={`dtrader__level-title dtrader__level-title--${o.tone || 'blue'}`}>
                                    {o.title}
                                </text>
                            )}
                            {tag(plotW + 4, py, o.label, `dtrader__tag dtrader__tag--${o.tone || 'blue'}`)}
                        </g>
                    );
                })}

                <line x1={x(last.t)} x2={plotW} y1={y(last.q)} y2={y(last.q)} className='dtrader__last-line' />
                <circle cx={x(last.t)} cy={y(last.q)} r='4' className='dtrader__dot' />
                {tag(plotW + 4, y(last.q), last.q.toFixed(dp), 'dtrader__tag dtrader__tag--last')}

                {hp && (
                    <g>
                        <line x1={x(hp.t)} x2={x(hp.t)} y1={TOP} y2={TOP + plotH} className='dtrader__cross' />
                        <circle cx={x(hp.t)} cy={y(hp.q)} r='3.5' className='dtrader__dot' />
                    </g>
                )}
                <rect
                    x='0'
                    y={TOP}
                    width={plotW}
                    height={plotH}
                    fill='transparent'
                    onPointerMove={e => {
                        const r = e.currentTarget.getBoundingClientRect();
                        const px = e.clientX - r.left;
                        let best = 0;
                        let bd = Infinity;
                        shown.forEach((p: any, i: number) => {
                            const d = Math.abs(x(p.t) - px);
                            if (d < bd) {
                                bd = d;
                                best = i;
                            }
                        });
                        setHover(bd < 40 ? best : null);
                    }}
                    onPointerLeave={() => setHover(null)}
                />
            </svg>
            {hp && (
                <div
                    className='dtrader__tip'
                    style={{ left: clamp(x(hp.t) - 60, 4, Math.max(4, plotW - 250)), top: clamp(y(hp.q) - 60, 4, plotH - 40) }}
                >
                    <div>{dmyhms(hp.t)}</div>
                    <div>
                        <span>{name.toUpperCase()}</span> <strong>{hp.q.toFixed(dp)}</strong>
                    </div>
                </div>
            )}
            {children}
        </div>
    );
};

// ---------- tiny form helpers ----------
const Seg = ({ value, options, onChange }: any) => (
    <div className='dtrader__seg'>
        {options.map((o: any) => (
            <button
                key={o.value}
                type='button'
                className={classNames({ 'dtrader__seg--on': o.value === value })}
                onClick={() => onChange(o.value)}
            >
                {o.label}
            </button>
        ))}
    </div>
);

const Stepper = ({ value, onChange, min = 0, max = 1e9, step = 1, dec = 0, onBlur }: any) => {
    const num = Number(value);
    const set = (n: number) => onChange(dec ? Number(clamp(n, min, max).toFixed(dec)) : clamp(Math.round(n), min, max));
    return (
        <div className='dtrader__stepper'>
            <button type='button' onClick={() => set((isNaN(num) ? min : num) - step)} aria-label='minus'>
                −
            </button>
            <input
                type='number'
                inputMode='decimal'
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={e => onChange(e.target.value)}
                onBlur={() => (onBlur ? onBlur() : set(isNaN(num) ? min : num))}
            />
            <button type='button' onClick={() => set((isNaN(num) ? min : num) + step)} aria-label='plus'>
                +
            </button>
        </div>
    );
};

const Check = ({ label, checked, onChange, disabled }: any) => (
    <label className={classNames('dtrader__check', { 'dtrader__check--off': disabled })}>
        <input type='checkbox' checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
        <span>{label}</span>
    </label>
);

const DTrader = observer(() => {
    const { client } = useStore();
    const currency = client?.currency || 'USD';
    const is_logged_in = !!client?.is_logged_in;

    const [symbol, setSymbol] = useState('1HZ100V');
    const [type_key, setTypeKey] = useState('accu');
    const [menu_open, setMenuOpen] = useState(false);
    const [cat, setCat] = useState('all');
    const [search, setSearch] = useState('');
    const [sym_open, setSymOpen] = useState(false);
    const [pos_open, setPosOpen] = useState(true);

    const [stake, setStake] = useState<number | string>(10);
    const [basis, setBasis] = useState('stake');
    const [growth, setGrowth] = useState(3);
    const [tp_on, setTpOn] = useState(false);
    const [tp, setTp] = useState<number | string>(10);
    const [sl_on, setSlOn] = useState(false);
    const [sl, setSl] = useState<number | string>(10);
    const [dc_on, setDcOn] = useState(false);
    const [mult, setMult] = useState(0);
    const [vside, setVside] = useState('call');
    const [tside, setTside] = useState('up');
    const [mode, setMode] = useState('dur');
    const [dur, setDur] = useState<number | string>(3);
    const [unit, setUnit] = useState('m');
    const [end_time, setEndTime] = useState('');
    const [equals, setEquals] = useState(false);
    const [dticks, setDticks] = useState(1);
    const [digit, setDigit] = useState(7);
    const [offsets, setOffsets] = useState<Record<string, number>>({});

    const [ticks, setTicks] = useState<{ t: number; q: number }[]>([]);
    const [dp, setDp] = useState(2);
    const [visible, setVisible] = useState(60);
    const [area, setArea] = useState(true);
    const [grid, setGrid] = useState(true);
    const [feed, setFeed] = useState(localize('Connecting…'));

    const [quotes, setQuotes] = useState<any[]>([]);
    const [refresh, setRefresh] = useState(0);
    const [trades, setTrades] = useState<any[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const sub_ids = useRef<Record<number, string>>({});

    const type = TYPES.find(t => t.key === type_key) || TYPES[0];
    const market = MARKETS.find(m => m.symbol === symbol) || MARKETS[0];
    const vol = volOf(symbol);
    const mult_list = MULTIPLIERS[vol] || MULTIPLIERS[100];
    const multiplier = mult_list[clamp(mult, 0, mult_list.length - 1)];
    const is_digit = DIGIT_TYPES.includes(type_key);
    const has_barrier = BARRIER_TYPES.includes(type_key);
    const has_basis = BASIS_TYPES.includes(type_key);
    const units = type.units || ['t'];
    const spot = ticks.length ? ticks[ticks.length - 1].q : null;
    const stake_n = Number(stake);
    const stake_ok = stake_n >= 0.35;

    // ---- keep unit / digit / multiplier valid when the type or market changes ----
    useEffect(() => {
        if (type.units && !type.units.includes(unit)) setUnit(type.units.includes('m') ? 'm' : type.units[0]);
    }, [type_key]);
    useEffect(() => {
        if (type_key === 'overunder') setDigit(d => clamp(d, 1, 8));
    }, [type_key]);
    useEffect(() => setMult(i => clamp(i, 0, mult_list.length - 1)), [symbol]);

    // ---- barrier offsets: freeze a sensible default the first time ----
    const off_key = `${type_key}:${symbol}:${tside}`;
    useEffect(() => {
        if (!has_barrier || spot === null || offsets[off_key] !== undefined) return;
        const pct = { vanilla: 0, turbos: 0.0062, higherlower: 0.00058, touch: 0.00165 }[type_key] ?? 0;
        const sign = type_key === 'turbos' ? (tside === 'up' ? -1 : 1) : 1;
        setOffsets(o => ({ ...o, [off_key]: Number((sign * spot * pct).toFixed(dp)) }));
    }, [off_key, has_barrier, spot === null, dp]);
    const offset = offsets[off_key] ?? 0;
    const barrier_step = Math.pow(10, -dp);

    // ---- live ticks + history ----
    useEffect(() => {
        if (!api_base.api) {
            setFeed(localize('Not connected. Please refresh the page.'));
            return;
        }
        let cancelled = false;
        let sub_id = '';
        let pip = market.dp;
        setTicks([]);
        setDp(market.dp);
        setFeed(localize('Loading ticks…'));
        const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data?.msg_type !== 'tick' || data.tick?.symbol !== symbol) return;
            if (data.tick.pip_size !== undefined) {
                pip = Number(data.tick.pip_size);
                setDp(pip);
            }
            setTicks(prev => [...prev, { t: Number(data.tick.epoch), q: Number(data.tick.quote) }].slice(-1000));
        });
        const start = async () => {
            const base = { ticks_history: symbol, adjust_start_time: 1, count: 1000, end: 'latest', style: 'ticks' };
            try {
                let res;
                try {
                    res = await api_base.api.send({ ...base, subscribe: 1 });
                    sub_id = res?.subscription?.id || '';
                    if (cancelled && sub_id) api_base.api.send({ forget: sub_id }).catch(() => {});
                } catch (e) {
                    if (e?.error?.code !== 'AlreadySubscribed') throw e;
                    res = await api_base.api.send(base);
                }
                if (cancelled) return;
                if (res?.pip_size !== undefined) {
                    pip = Number(res.pip_size);
                    setDp(pip);
                }
                const prices = res?.history?.prices || [];
                const times = res?.history?.times || [];
                setTicks(prev => {
                    const hist = prices.map((q: number, i: number) => ({ t: Number(times[i]), q: Number(q) }));
                    const newest = hist.length ? hist[hist.length - 1].t : 0;
                    return [...hist, ...prev.filter(p => p.t > newest)].slice(-1000);
                });
                setFeed(localize('Live'));
            } catch (e) {
                if (!cancelled) setFeed(errMsg(e));
            }
        };
        start();
        return () => {
            cancelled = true;
            sub.unsubscribe();
            if (sub_id && api_base.api) api_base.api.send({ forget: sub_id }).catch(() => {});
        };
    }, [symbol]);

    // ---- what one side of the current trade looks like ----
    const sides = useMemo(() => {
        switch (type_key) {
            case 'accu':
                return [{ ct: 'ACCU', label: 'Buy', tone: 'a' }];
            case 'vanilla':
                return [vside === 'call' ? { ct: 'VANILLALONGCALL', label: 'Call', tone: 'a' } : { ct: 'VANILLALONGPUT', label: 'Put', tone: 'b' }];
            case 'turbos':
                return [tside === 'up' ? { ct: 'TURBOSLONG', label: 'Up', tone: 'a' } : { ct: 'TURBOSSHORT', label: 'Down', tone: 'b' }];
            case 'multipliers':
                return [{ ct: 'MULTUP', label: 'Up', tone: 'a', icon: 'up' }, { ct: 'MULTDOWN', label: 'Down', tone: 'b', icon: 'down' }];
            case 'risefall':
                return [
                    { ct: equals ? 'CALLE' : 'CALL', label: 'Rise', tone: 'a', icon: 'up' },
                    { ct: equals ? 'PUTE' : 'PUT', label: 'Fall', tone: 'b', icon: 'down' },
                ];
            case 'higherlower':
                return [{ ct: 'CALL', label: 'Higher', tone: 'a', icon: 'up' }, { ct: 'PUT', label: 'Lower', tone: 'b', icon: 'down' }];
            case 'touch':
                return [{ ct: 'ONETOUCH', label: 'Touch', tone: 'a', icon: 'up' }, { ct: 'NOTOUCH', label: 'No Touch', tone: 'b', icon: 'down' }];
            case 'matchdiffer':
                return [{ ct: 'DIGITMATCH', label: 'Matches', tone: 'a', icon: 'match' }, { ct: 'DIGITDIFF', label: 'Differs', tone: 'b', icon: 'differ' }];
            case 'evenodd':
                return [{ ct: 'DIGITEVEN', label: 'Even', tone: 'a', icon: 'even' }, { ct: 'DIGITODD', label: 'Odd', tone: 'b', icon: 'odd' }];
            default:
                return [{ ct: 'DIGITOVER', label: 'Over', tone: 'a', icon: 'up' }, { ct: 'DIGITUNDER', label: 'Under', tone: 'b', icon: 'down' }];
        }
    }, [type_key, vside, tside, equals]);

    const dur_n = Number(dur);
    const [dmin, dmax] = durationRange(type_key, unit);
    const dur_ok = clamp(Math.round(dur_n) || dmin, dmin, dmax);

    const end_epoch = useMemo(() => {
        if (!end_time) return 0;
        const [hh, mm] = end_time.split(':').map(Number);
        const d = new Date();
        d.setHours(hh, mm, 0, 0);
        if (d.getTime() <= Date.now() + 60000) d.setDate(d.getDate() + 1);
        return Math.floor(d.getTime() / 1000);
    }, [end_time]);

    const buildParams = useCallback(
        (side: any) => {
            const p: any = { contract_type: side.ct, currency, underlying_symbol: symbol };
            const use_payout = has_basis && basis === 'payout';
            p.basis = use_payout ? 'payout' : 'stake';
            p.amount = stake_n;
            if (type_key === 'accu') {
                p.growth_rate = growth / 100;
                if (tp_on && Number(tp) > 0) p.limit_order = { take_profit: Number(tp) };
                return p;
            }
            if (type_key === 'multipliers') {
                p.multiplier = multiplier;
                const lo: any = {};
                if (tp_on && Number(tp) > 0) lo.take_profit = Number(tp);
                if (sl_on && !dc_on && Number(sl) > 0) lo.stop_loss = Number(sl);
                if (Object.keys(lo).length) p.limit_order = lo;
                if (dc_on) p.deal_cancellation = '5m';
                return p;
            }
            if (is_digit) {
                p.duration = dticks;
                p.duration_unit = 't';
                if (type_key !== 'evenodd') p.barrier = String(digit);
                return p;
            }
            if (mode === 'end' && end_epoch && type.units?.some(u => u !== 't')) {
                p.date_expiry = end_epoch;
            } else {
                p.duration = dur_ok;
                p.duration_unit = unit;
            }
            if (has_barrier) p.barrier = signed(offset, dp);
            return p;
        },
        [currency, symbol, basis, stake_n, growth, tp_on, tp, sl_on, sl, dc_on, multiplier, dticks, digit, mode, end_epoch, dur_ok, unit, offset, dp, type_key]
    );

    // ---- payout / price quotes ----
    const req = useMemo(() => sides.map(s => ({ side: s, params: buildParams(s) })), [sides, buildParams]);
    const req_key = JSON.stringify(req.map(r => r.params));
    useEffect(() => {
        const id = setInterval(() => setRefresh(n => n + 1), 10000);
        return () => clearInterval(id);
    }, []);
    useEffect(() => {
        if (!api_base.api || !stake_ok) {
            setQuotes([]);
            return;
        }
        let cancelled = false;
        const ask = async (params: any) => {
            try {
                const res = await api_base.api.send({ proposal: 1, ...params });
                const pr = res?.proposal || {};
                return {
                    ask: Number(pr.ask_price),
                    payout: Number(pr.payout),
                    commission: pr.commission !== undefined ? Number(pr.commission) : undefined,
                    details: pr.contract_details || {},
                    limit_order: pr.limit_order || {},
                };
            } catch (e) {
                return { error: errMsg(e) };
            }
        };
        const timer = setTimeout(async () => {
            const out = await Promise.all(req.map(r => ask(r.params)));
            if (!cancelled) setQuotes(out);
        }, 450);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [req_key, stake_ok, refresh]);

    // ---- follow open trades ----
    useEffect(() => {
        if (!api_base.api) return;
        const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data?.msg_type !== 'proposal_open_contract') return;
            const c = data.proposal_open_contract;
            if (!c?.contract_id) return;
            setTrades(prev =>
                prev.map(t =>
                    t.id !== c.contract_id
                        ? t
                        : {
                              ...t,
                              profit: Number(c.profit),
                              bid: Number(c.bid_price),
                              can_sell: !!c.is_valid_to_sell && !c.is_sold,
                              status: c.is_sold ? (Number(c.profit) >= 0 ? 'won' : 'lost') : 'open',
                          }
                )
            );
            if (c.is_sold && sub_ids.current[c.contract_id]) {
                api_base.api.send({ forget: sub_ids.current[c.contract_id] }).catch(() => {});
                delete sub_ids.current[c.contract_id];
            }
        });
        return () => {
            sub.unsubscribe();
            Object.values(sub_ids.current).forEach(id => api_base.api?.send({ forget: id }).catch(() => {}));
            sub_ids.current = {};
        };
    }, []);

    const buy = useCallback(
        async (idx: number) => {
            setError('');
            if (!is_logged_in) return setError(localize('Please log in to trade.'));
            if (!stake_ok) return setError(localize('Minimum stake is 0.35.'));
            const { side, params } = req[idx];
            setBusy(true);
            try {
                const price = params.basis === 'payout' ? quotes[idx]?.ask || stake_n : stake_n;
                const res = await api_base.api.send({ buy: '1', price, parameters: params });
                const id = res.buy.contract_id;
                const label =
                    type_key === 'matchdiffer' || type_key === 'overunder' ? `${side.label} ${digit}` : `${type.label} · ${side.label}`;
                setTrades(prev =>
                    [{ id, label, market: market.name, stake: Number(res.buy.buy_price) || stake_n, profit: null, status: 'open', can_sell: false }, ...prev].slice(0, 30)
                );
                const r = await api_base.api.send({ proposal_open_contract: 1, contract_id: id, subscribe: 1 });
                if (r?.subscription?.id) sub_ids.current[id] = r.subscription.id;
            } catch (e) {
                setError(errMsg(e));
            }
            setBusy(false);
        },
        [is_logged_in, stake_ok, req, quotes, stake_n, type_key, digit, market.name, type.label]
    );

    const sell = async (id: number) => {
        try {
            await api_base.api.send({ sell: id, price: 0 });
        } catch (e) {
            setError(errMsg(e));
        }
    };

    // ---- chart extras ----
    const pct = useMemo(() => percents(ticks.slice(-1000).map(p => toDigit(p.q, dp))), [ticks, dp]);
    const has_pct = ticks.length > 0;
    const hi = Math.max(...pct);
    const lo = Math.min(...pct);
    const last_digit = spot !== null ? toDigit(spot, dp) : null;
    const prev = ticks.length > 1 ? ticks[ticks.length - 2].q : null;
    const change = spot !== null && prev !== null ? spot - prev : 0;

    const q0 = quotes[0] || {};
    const overlays = useMemo(() => {
        if (spot === null) return [];
        const out: any[] = [];
        if (type_key === 'accu') {
            const d = Number(q0.details?.barrier_spot_distance) || (Number(q0.details?.tick_size_barrier) || 0) * spot;
            if (d > 0) out.push({ kind: 'box', price: spot + d, price2: spot - d, label: signed(d, 3), label2: signed(-d, 3) });
        } else if (type_key === 'vanilla') {
            out.push({ price: spot + offset, label: signed(offset, 2), tone: 'blue' });
        } else if (type_key === 'turbos') {
            out.push({ price: spot + offset, label: signed(offset, 2), tone: 'red' });
        } else if (type_key === 'higherlower' || type_key === 'touch') {
            out.push({ price: spot + offset, label: signed(offset, 2), tone: 'blue' });
        } else if (type_key === 'multipliers') {
            const v = Number(q0.limit_order?.stop_out?.value);
            if (v) out.push({ price: v, label: v.toFixed(dp), title: localize('Stop out'), tone: 'red' });
        }
        return out;
    }, [type_key, spot, offset, q0.details, q0.limit_order, dp]);

    const downloadTicks = () => {
        const csv = 'time,price\n' + ticks.map(p => `${new Date(p.t * 1000).toISOString()},${p.q}`).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = `${symbol}-ticks.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    // ---- right panel pieces ----
    const shownQuote = (i: number) => quotes[i] || {};
    const pctOf = (q: any) => (q.payout && q.ask ? ((q.payout - q.ask) / q.ask) * 100 : null);
    const buyBtn = (i: number) => {
        const s = sides[i];
        const q = shownQuote(i);
        const p = pctOf(q);
        return (
            <button
                key={s.ct}
                type='button'
                className={`dtrader__buy dtrader__buy--${s.tone}`}
                disabled={busy || !stake_ok}
                onClick={() => buy(i)}
            >
                <span className='dtrader__buy-name'>
                    {s.icon && <TypeIcon name={s.icon} />}
                    {localize(s.label)}
                </span>
                <span className='dtrader__buy-amount'>
                    {type_key === 'multipliers' || type_key === 'accu' || type_key === 'vanilla' || type_key === 'turbos'
                        ? `${money(stake_n || 0)} ${currency}`
                        : p !== null
                          ? `${p.toFixed(2)}%`
                          : '…'}
                </span>
            </button>
        );
    };
    const payoutLine = (i: number) => {
        const q = shownQuote(i);
        return (
            <div className='dtrader__payout'>
                <span>{localize('Payout')}</span>
                <strong>{q.payout ? `${money(q.payout)} ${currency}` : '—'}</strong>
            </div>
        );
    };

    const durationBlock = (
        <div className='dtrader__card'>
            <Seg
                value={mode}
                onChange={setMode}
                options={[
                    { value: 'dur', label: localize('Duration') },
                    { value: 'end', label: localize('End time') },
                ]}
            />
            {mode === 'dur' || !units.some(u => u !== 't') ? (
                <>
                    <label className='dtrader__select-wrap'>
                        <Chevron />
                        <select value={unit} onChange={e => setUnit(e.target.value)}>
                            {units.map(u => (
                                <option key={u} value={u}>
                                    {localize(UNIT_NAMES[u])}
                                </option>
                            ))}
                        </select>
                    </label>
                    <Stepper value={dur} onChange={setDur} min={dmin} max={dmax} onBlur={() => setDur(dur_ok)} />
                    <small className='dtrader__muted'>
                        {localize('Range')}: {dmin.toLocaleString()} - {dmax.toLocaleString()} {localize(UNIT_NAMES[unit]).toLowerCase()}
                    </small>
                </>
            ) : (
                <input type='time' className='dtrader__time' value={end_time} onChange={e => setEndTime(e.target.value)} />
            )}
        </div>
    );
    const stakeBlock = (
        <div className='dtrader__card'>
            {has_basis ? (
                <Seg
                    value={basis}
                    onChange={setBasis}
                    options={[
                        { value: 'stake', label: localize('Stake') },
                        { value: 'payout', label: localize('Payout') },
                    ]}
                />
            ) : (
                <div className='dtrader__card-title'>{localize('Stake')}</div>
            )}
            <Stepper value={stake} onChange={setStake} min={0.35} max={50000} step={1} dec={2} />
        </div>
    );
    const barrierBlock = (title: string) => (
        <div className='dtrader__card'>
            <div className='dtrader__card-title'>{title}</div>
            <Stepper
                value={offset}
                onChange={(v: any) => setOffsets(o => ({ ...o, [off_key]: Number(v) }))}
                min={-1e6}
                max={1e6}
                step={barrier_step * (type_key === 'turbos' ? 100 : 10)}
                dec={dp}
                onBlur={() => {}}
            />
        </div>
    );
    const limitsBlock = (with_sl: boolean, with_dc: boolean) => (
        <div className='dtrader__card dtrader__card--flat'>
            <Check label={localize('Take profit')} checked={tp_on} onChange={setTpOn} />
            {tp_on && <Stepper value={tp} onChange={setTp} min={1} step={1} dec={2} />}
            {with_sl && <Check label={localize('Stop loss')} checked={sl_on && !dc_on} disabled={dc_on} onChange={setSlOn} />}
            {with_sl && sl_on && !dc_on && <Stepper value={sl} onChange={setSl} min={1} step={1} dec={2} />}
            {with_dc && (
                <Check
                    label={localize('Deal cancellation')}
                    checked={dc_on}
                    onChange={(v: boolean) => {
                        setDcOn(v);
                        if (v) setSlOn(false);
                    }}
                />
            )}
        </div>
    );
    const digitPick = (lo_d: number, hi_d: number) => (
        <div className='dtrader__card'>
            <div className='dtrader__card-title'>{localize('Last Digit Prediction')}</div>
            <div className='dtrader__digits-grid'>
                {DIGITS.map(d => (
                    <button
                        key={d}
                        type='button'
                        disabled={d < lo_d || d > hi_d}
                        className={classNames({ 'dtrader__digit-on': digit === d })}
                        onClick={() => setDigit(d)}
                    >
                        {d}
                    </button>
                ))}
            </div>
        </div>
    );
    const ticksBlock = (
        <div className='dtrader__card'>
            <div className='dtrader__card-title'>{localize('Ticks')}</div>
            <input type='range' min='1' max='10' step='1' value={dticks} onChange={e => setDticks(Number(e.target.value))} className='dtrader__range' />
            <div className='dtrader__range-label'>
                {dticks} {dticks === 1 ? localize('Tick') : localize('Ticks')}
            </div>
        </div>
    );

    let panel: any;
    if (type_key === 'accu') {
        const mp = q0.details?.maximum_payout;
        const mt = q0.details?.maximum_ticks;
        panel = (
            <>
                <div className='dtrader__card'>
                    <div className='dtrader__card-title'>{localize('Growth rate')}</div>
                    <div className='dtrader__rates'>
                        {[1, 2, 3, 4, 5].map(g => (
                            <button key={g} type='button' className={classNames({ 'dtrader__rate-on': growth === g })} onClick={() => setGrowth(g)}>
                                {g}%
                            </button>
                        ))}
                    </div>
                </div>
                {stakeBlock}
                {limitsBlock(false, false)}
                <div className='dtrader__facts'>
                    <div>
                        <span>{localize('Max. payout')}</span>
                        <strong>{mp ? `${money(mp)} ${currency}` : '—'}</strong>
                    </div>
                    <div>
                        <span>{localize('Max. ticks')}</span>
                        <strong>{mt ? `${mt} ${localize('ticks')}` : '—'}</strong>
                    </div>
                </div>
                <div className='dtrader__buys'>{buyBtn(0)}</div>
            </>
        );
    } else if (type_key === 'multipliers') {
        panel = (
            <>
                <div className='dtrader__card'>
                    <div className='dtrader__card-title'>{localize('Multiplier')}</div>
                    <label className='dtrader__select-wrap'>
                        <Chevron />
                        <select value={mult} onChange={e => setMult(Number(e.target.value))}>
                            {mult_list.map((m, i) => (
                                <option key={m} value={i}>
                                    x{m}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                {stakeBlock}
                <div className='dtrader__facts'>
                    <div>
                        <span>{localize('Commission')}</span>
                        <strong>{q0.commission !== undefined ? `${money(q0.commission)} ${currency}` : '—'}</strong>
                    </div>
                    <div>
                        <span>{localize('Stop out')}</span>
                        <strong>
                            {q0.limit_order?.stop_out?.order_amount !== undefined
                                ? `${money(Math.abs(q0.limit_order.stop_out.order_amount))} ${currency}`
                                : '—'}
                        </strong>
                    </div>
                </div>
                {limitsBlock(true, true)}
                <div className='dtrader__buys'>
                    {buyBtn(0)}
                    {buyBtn(1)}
                </div>
            </>
        );
    } else if (type_key === 'vanilla') {
        panel = (
            <>
                {durationBlock}
                <Seg
                    value={vside}
                    onChange={setVside}
                    options={[
                        { value: 'call', label: localize('Call') },
                        { value: 'put', label: localize('Put') },
                    ]}
                />
                {barrierBlock(localize('Strike price'))}
                {stakeBlock}
                <div className='dtrader__payout'>
                    <span>{localize('Payout per point')}</span>
                    <strong>{q0.payout ? `${q0.payout.toFixed(6)} ${currency}` : '—'}</strong>
                </div>
                <div className='dtrader__buys'>{buyBtn(0)}</div>
            </>
        );
    } else if (type_key === 'turbos') {
        panel = (
            <>
                <Seg
                    value={tside}
                    onChange={setTside}
                    options={[
                        { value: 'up', label: localize('Up') },
                        { value: 'down', label: localize('Down') },
                    ]}
                />
                {stakeBlock}
                <div className='dtrader__payout'>
                    <span>{localize('Payout per Point')}</span>
                    <strong>{q0.payout ? `${money(q0.payout)} ${currency}` : '—'}</strong>
                </div>
                {barrierBlock(localize('Barrier'))}
                {durationBlock}
                {limitsBlock(false, false)}
                <div className='dtrader__buys'>{buyBtn(0)}</div>
            </>
        );
    } else if (is_digit) {
        panel = (
            <>
                {ticksBlock}
                {type_key === 'matchdiffer' && digitPick(0, 9)}
                {type_key === 'overunder' && digitPick(1, 8)}
                {stakeBlock}
                <div className='dtrader__buys'>
                    {payoutLine(0)}
                    {buyBtn(0)}
                    {payoutLine(1)}
                    {buyBtn(1)}
                </div>
            </>
        );
    } else {
        panel = (
            <>
                {durationBlock}
                {has_barrier && barrierBlock(localize('Barrier'))}
                {stakeBlock}
                {type_key === 'risefall' && (
                    <Check label={localize('Allow equals')} checked={equals} onChange={setEquals} />
                )}
                <div className='dtrader__buys'>
                    {payoutLine(0)}
                    {buyBtn(0)}
                    {payoutLine(1)}
                    {buyBtn(1)}
                </div>
            </>
        );
    }

    const err_text = error || (quotes.find(q => q?.error) || {}).error;
    const filtered = TYPES.filter(
        t => (cat === 'all' || t.cat === cat) && (!search || `${t.label} ${t.group}`.toLowerCase().includes(search.toLowerCase()))
    );
    const open_trades = trades.filter(t => t.status === 'open');
    const closed_trades = trades.filter(t => t.status !== 'open');
    const total = round2(closed_trades.reduce((s, t) => s + (t.profit || 0), 0));

    return (
        <div className='dtrader'>
            {/* ---------- open positions ---------- */}
            <aside className={classNames('dtrader__positions', { 'dtrader__positions--closed': !pos_open })}>
                <div className='dtrader__positions-head'>
                    <strong>{localize('Open positions')}</strong>
                    <button type='button' onClick={() => setPosOpen(o => !o)} aria-label='toggle'>
                        {pos_open ? '−' : '+'}
                    </button>
                </div>
                {pos_open && (
                    <div className='dtrader__positions-body'>
                        {trades.length === 0 ? (
                            <div className='dtrader__empty'>
                                <svg width='48' height='48' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.4'>
                                    <rect x='3' y='7' width='18' height='13' rx='2' />
                                    <path d='M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M3 13h18' />
                                </svg>
                                <p>{localize('You have no open positions.')}</p>
                            </div>
                        ) : (
                            <>
                                {closed_trades.length > 0 && (
                                    <div className='dtrader__total'>
                                        {localize('Closed')}: <b className={total >= 0 ? 'dtrader__win' : 'dtrader__loss'}>{signed(total, 2)} {currency}</b>
                                        <button type='button' onClick={() => setTrades(open_trades)}>
                                            {localize('Clear')}
                                        </button>
                                    </div>
                                )}
                                {[...open_trades, ...closed_trades].map(t => (
                                    <div key={t.id} className={`dtrader__pos dtrader__pos--${t.status}`}>
                                        <div className='dtrader__pos-main'>
                                            <strong>{t.label}</strong>
                                            <small>{t.market}</small>
                                            <small>
                                                {localize('Stake')}: {money(t.stake)} {currency}
                                            </small>
                                        </div>
                                        <div className='dtrader__pos-side'>
                                            <b className={t.profit === null ? '' : t.profit >= 0 ? 'dtrader__win' : 'dtrader__loss'}>
                                                {t.profit === null ? '…' : `${signed(t.profit, 2)} ${currency}`}
                                            </b>
                                            {t.status === 'open' && t.can_sell && (
                                                <button type='button' onClick={() => sell(t.id)}>
                                                    {localize('Sell')}
                                                </button>
                                            )}
                                            {t.status !== 'open' && <small>{t.status === 'won' ? localize('Won') : localize('Lost')}</small>}
                                        </div>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                )}
            </aside>

            {/* ---------- chart ---------- */}
            <section className='dtrader__stage'>
                <div className='dtrader__symbol'>
                    <button type='button' className='dtrader__symbol-btn' onClick={() => setSymOpen(o => !o)}>
                        <span className='dtrader__badge'>{market.badge}</span>
                        <span className='dtrader__symbol-text'>
                            <strong>{market.name}</strong>
                            <small>
                                {spot !== null ? spot.toFixed(dp) : feed}
                                {spot !== null && prev !== null && (
                                    <>
                                        {' '}
                                        {change >= 0 ? '+' : '-'} {Math.abs(change).toFixed(2)} ({Math.abs((change / prev) * 100).toFixed(2)}%){' '}
                                        <i className={change >= 0 ? 'dtrader__win' : 'dtrader__loss'}>{change >= 0 ? '▲' : '▼'}</i>
                                    </>
                                )}
                            </small>
                        </span>
                        <Chevron dir='down' />
                    </button>
                    {sym_open && (
                        <div className='dtrader__symbol-menu'>
                            {MARKETS.map(m => (
                                <button
                                    key={m.symbol}
                                    type='button'
                                    className={classNames({ 'dtrader__symbol-on': m.symbol === symbol })}
                                    onClick={() => {
                                        setSymbol(m.symbol);
                                        setSymOpen(false);
                                    }}
                                >
                                    <span className='dtrader__badge'>{m.badge}</span>
                                    {m.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className='dtrader__toolbar'>
                    <button type='button' title={localize('Chart type')} onClick={() => setArea(a => !a)} className={classNames({ on: area })}>
                        <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6'>
                            <path d='M3 17l5-6 4 3 6-8 3 4v8H3z' />
                        </svg>
                    </button>
                    <button type='button' title={localize('Grid')} onClick={() => setGrid(g => !g)} className={classNames({ on: grid })}>
                        <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6'>
                            <path d='M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18' />
                        </svg>
                    </button>
                    <button type='button' title={localize('Download ticks')} onClick={downloadTicks}>
                        <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6'>
                            <path d='M12 3v12M7 10l5 5 5-5M4 20h16' />
                        </svg>
                    </button>
                </div>

                <Chart ticks={ticks} dp={dp} overlays={overlays} visible={visible} area={area} grid={grid} name={market.name}>
                    <div className='dtrader__zoom'>
                        <button type='button' onClick={() => setVisible(v => Math.max(15, Math.round(v * 0.7)))} aria-label='zoom in'>
                            +
                        </button>
                        <button type='button' onClick={() => setVisible(60)} aria-label='reset zoom'>
                            ⌖
                        </button>
                        <button type='button' onClick={() => setVisible(v => Math.min(900, Math.round(v * 1.4)))} aria-label='zoom out'>
                            −
                        </button>
                    </div>
                    {is_digit && (
                        <div className='dtrader__circles'>
                            {DIGITS.map(d => {
                                const picks = type_key !== 'evenodd';
                                const ok = type_key === 'overunder' ? d >= 1 && d <= 8 : true;
                                return (
                                    <div key={d} className='dtrader__circle-wrap'>
                                        <button
                                            type='button'
                                            disabled={!picks || !ok}
                                            onClick={() => setDigit(d)}
                                            className={classNames('dtrader__circle', {
                                                'dtrader__circle--high': has_pct && pct[d] === hi,
                                                'dtrader__circle--low': has_pct && pct[d] === lo && pct[d] !== hi,
                                                'dtrader__circle--picked': picks && digit === d,
                                                'dtrader__circle--last': last_digit === d,
                                            })}
                                        >
                                            <b>{d}</b>
                                            <small>{has_pct ? `${pct[d].toFixed(1)}%` : '—'}</small>
                                        </button>
                                        <span className='dtrader__pointer'>{last_digit === d ? '▲' : ''}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Chart>
            </section>

            {/* ---------- trade panel ---------- */}
            <aside className='dtrader__panel'>
                <a className='dtrader__learn' href='https://deriv.com/trade-types' target='_blank' rel='noreferrer'>
                    {localize('Learn about this trade type')}
                </a>
                <button type='button' className='dtrader__typebtn' onClick={() => setMenuOpen(o => !o)}>
                    <Chevron dir={menu_open ? 'right' : 'left'} />
                    {type.icons.map(i => (
                        <TypeIcon key={i} name={i} />
                    ))}
                    <strong>{type.label}</strong>
                </button>
                <div className='dtrader__panel-body'>
                    {panel}
                    {err_text && <p className='dtrader__error'>{err_text}</p>}
                </div>
            </aside>

            {/* ---------- trade types popup ---------- */}
            {menu_open && (
                <>
                    <div className='dtrader__backdrop' onClick={() => setMenuOpen(false)} />
                    <div className='dtrader__menu'>
                        <div className='dtrader__menu-side'>
                            <h4>{localize('Trade types')}</h4>
                            {[
                                ['all', 'All'],
                                ['multipliers', 'Multipliers'],
                                ['options', 'Options'],
                                ['accumulators', 'Accumulators'],
                            ].map(([k, l]) => (
                                <button key={k} type='button' className={classNames({ on: cat === k })} onClick={() => setCat(k)}>
                                    {localize(l)}
                                </button>
                            ))}
                        </div>
                        <div className='dtrader__menu-main'>
                            <input
                                className='dtrader__search'
                                placeholder={localize('Search')}
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                            <a className='dtrader__learn-more' href='https://deriv.com/trade-types' target='_blank' rel='noreferrer'>
                                {localize('Learn more about trade types')} <Chevron dir='right' />
                            </a>
                            {GROUPS.map(g => {
                                const items = filtered.filter(t => t.group === g);
                                if (!items.length) return null;
                                return (
                                    <div key={g} className='dtrader__group'>
                                        <h5>{localize(g)}</h5>
                                        {items.map(t => (
                                            <button
                                                key={t.key}
                                                type='button'
                                                className={classNames('dtrader__item', { on: t.key === type_key })}
                                                onClick={() => {
                                                    setTypeKey(t.key);
                                                    setMenuOpen(false);
                                                    setError('');
                                                }}
                                            >
                                                {t.icons.map(i => (
                                                    <TypeIcon key={i} name={i} />
                                                ))}
                                                <span>{t.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
});

export default DTrader;
