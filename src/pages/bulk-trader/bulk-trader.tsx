// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { batch_lanes, MAX_EXTRA_LANES } from './batch-sockets';
import './bulk-trader.scss';

// Deriv's 10 volatility indices (dp = default decimals; the API's pip_size overrides it)
const MARKETS = [
    { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index', dp: 2 },
    { symbol: 'R_10', name: 'Volatility 10 Index', dp: 3 },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index', dp: 2 },
    { symbol: 'R_25', name: 'Volatility 25 Index', dp: 3 },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index', dp: 2 },
    { symbol: 'R_50', name: 'Volatility 50 Index', dp: 4 },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index', dp: 2 },
    { symbol: 'R_75', name: 'Volatility 75 Index', dp: 4 },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index', dp: 2 },
    { symbol: 'R_100', name: 'Volatility 100 Index', dp: 2 },
];

const TRADE_TYPES = [
    { key: 'even_odd', label: 'Even/Odd', has_prediction: false },
    { key: 'over_under', label: 'Over/Under', has_prediction: true },
    { key: 'matches_differs', label: 'Matches/Differs', has_prediction: true },
];

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// Recovery trade: what to trade after a losing batch (in this order)
const RECOVERY_OPTIONS = [
    { key: 'same', label: 'Same as traded side' },
    { key: 'even', label: 'Even' },
    { key: 'odd', label: 'Odd' },
    { key: 'over', label: 'Over' },
    { key: 'under', label: 'Under' },
    { key: 'matches', label: 'Matches' },
    { key: 'differs', label: 'Differs' },
];
const MAX_TICKS = 5000;
const SETTLE_TIMEOUT_MS = 60000;

const errMsg = (e: any) => e?.error?.message || e?.message || localize('Something went wrong');
const toDigit = (quote: number | string, dp: number) => Number(Number(quote).toFixed(dp).slice(-1));
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));


// Digit range Deriv accepts for each recovery contract
const RECOVERY_RANGE: Record<string, [number, number]> = {
    over: [0, 8],
    under: [1, 9],
    matches: [0, 9],
    differs: [0, 9],
};

// "Over 1" scanner: trade Over 1 on the first volatility whose digit percentages reach all of these levels
const OVER1_SIDE = { key: 'DIGITOVER', label: 'Over 1', barrier: true, barrier_value: 1 };
const OVER1_RULES = [
    { digit: 0, min: 10.2 },
    { digit: 1, min: 9 },
    { digit: 8, min: 9.2 },
    { digit: 9, min: 9.2 },
];
const digitPercents = (list: number[]) => {
    const counts = Array(10).fill(0);
    list.forEach(d => (counts[d] += 1));
    const total = list.length || 1;
    return counts.map(n => (n / total) * 100);
};
// compared the way they are shown (1 decimal), so a box that reads 9.2% counts as 9.2%
const meetsOver1 = (pct: number[]) => OVER1_RULES.every(r => Number(pct[r.digit].toFixed(1)) >= r.min);

// The contract to buy for a recovery choice (null = same as the traded side)
const getRecoverySide = (key: string, digit: number) => {
    const [lo, hi] = RECOVERY_RANGE[key] || [0, 9];
    const d = clamp(Math.round(digit), lo, hi);
    switch (key) {
        case 'even':
            return { key: 'DIGITEVEN', label: 'Even', barrier: false };
        case 'odd':
            return { key: 'DIGITODD', label: 'Odd', barrier: false };
        case 'over':
            return { key: 'DIGITOVER', label: `Over ${d}`, barrier: true, barrier_value: d };
        case 'under':
            return { key: 'DIGITUNDER', label: `Under ${d}`, barrier: true, barrier_value: d };
        case 'matches':
            return { key: 'DIGITMATCH', label: `Matches ${d}`, barrier: true, barrier_value: d };
        case 'differs':
            return { key: 'DIGITDIFF', label: `Differs ${d}`, barrier: true, barrier_value: d };
        default:
            return null;
    }
};

// Which side buttons are shown for each trade type: [left (teal), right (red)]
const getSides = (type: string, prediction: number) => {
    if (type === 'even_odd') {
        return [
            { key: 'DIGITEVEN', label: 'Even', barrier: false },
            { key: 'DIGITODD', label: 'Odd', barrier: false },
        ];
    }
    if (type === 'over_under') {
        return [
            { key: 'DIGITOVER', label: `Over ${prediction}`, barrier: true },
            { key: 'DIGITUNDER', label: `Under ${prediction}`, barrier: true },
        ];
    }
    return [
        { key: 'DIGITDIFF', label: `Differs ${prediction}`, barrier: true },
        { key: 'DIGITMATCH', label: `Matches ${prediction}`, barrier: true },
    ];
};

// Result badge (letter + colour) for one past digit
const getBadge = (type: string, digit: number, prediction: number) => {
    if (type === 'even_odd') return digit % 2 === 0 ? { t: 'E', c: 'good' } : { t: 'O', c: 'bad' };
    if (type === 'over_under') {
        if (digit > prediction) return { t: 'O', c: 'good' };
        if (digit < prediction) return { t: 'U', c: 'bad' };
        return { t: '=', c: 'neutral' };
    }
    return digit === prediction ? { t: 'M', c: 'bad' } : { t: 'D', c: 'good' };
};

// Number box that lets you clear and retype freely; the value is tidied when you leave the box.
const NumInput = ({
    value,
    onChange,
    min,
    max,
    integer = false,
    fallback,
}: {
    value: number;
    onChange: (n: number) => void;
    min: number;
    max: number;
    integer?: boolean;
    fallback: number;
}) => {
    const [text, setText] = useState(String(value));

    useEffect(() => {
        if (Number(text) !== value) setText(String(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const pattern = integer ? /^\d*$/ : /^\d*\.?\d*$/;

    return (
        <input
            className='bulk__input'
            type='text'
            inputMode={integer ? 'numeric' : 'decimal'}
            value={text}
            onFocus={e => e.target.select()}
            onChange={e => {
                const raw = e.target.value;
                if (!pattern.test(raw)) return;
                setText(raw);
                if (raw !== '' && raw !== '.' && !Number.isNaN(Number(raw))) onChange(Number(raw));
            }}
            onBlur={() => {
                let n = Number(text);
                if (text === '' || text === '.' || Number.isNaN(n)) n = fallback;
                n = clamp(integer ? Math.round(n) : n, min, max);
                setText(String(n));
                onChange(n);
            }}
        />
    );
};

const Check = ({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) => (
    <button type='button' role='checkbox' aria-checked={checked} className='bulk__cbx' onClick={onChange}>
        <span className={classNames('bulk__box', { 'bulk__box--on': checked })}>{checked ? '✓' : ''}</span>
        <span>{label}</span>
    </button>
);

// Small market badge: candles plus the volatility number and, for 1-second indices, a "1s" tag
const MarketIcon = ({ name }: { name: string }) => {
    const num = (name.match(/\d+/) || [''])[0];
    const one_sec = /\(1s\)/i.test(name);
    return (
        <svg className='bulk__micon' viewBox='0 0 32 32' aria-hidden='true'>
            <g strokeWidth='1.4' strokeLinecap='round'>
                <path d='M7.5 17v11' stroke='#00a79e' />
                <path d='M13.5 15v11' stroke='#00a79e' />
                <path d='M19.5 18v11' stroke='#ec3f3f' />
                <path d='M25.5 14v12' stroke='#00a79e' />
            </g>
            <rect x='5.5' y='20' width='4' height='6' rx='1' fill='#00a79e' />
            <rect x='11.5' y='18' width='4' height='6' rx='1' fill='#00a79e' />
            <rect x='17.5' y='21' width='4' height='6' rx='1' fill='#ec3f3f' />
            <rect x='23.5' y='17' width='4' height='7' rx='1' fill='#00a79e' />
            <rect x='0.5' y='0.5' width='17' height='11' rx='3' fill='#3a424d' />
            <text x='9' y='8.7' textAnchor='middle' fontSize='7.5' fontWeight='700' fill='#fff'>
                {num}
            </text>
            {one_sec && (
                <>
                    <circle cx='25.5' cy='6.5' r='6.5' fill='#e5384f' />
                    <text x='25.5' y='9.1' textAnchor='middle' fontSize='7' fontWeight='700' fill='#fff'>
                        1s
                    </text>
                </>
            )}
        </svg>
    );
};

// Dropdown box with an arrow; the native list still opens on phones
// The visible text is our own element (always centred); the real select sits invisibly on top and handles taps.
const SelectBox = ({ value, onChange, label, children, variant = 'chevron', icon = null }: any) => (
    <div className={classNames('bulk__selbox', `bulk__selbox--${variant}`, { 'bulk__selbox--icon': !!icon })}>
        {icon}
        <div className='bulk__sel-text'>
            <span>{label}</span>
        </div>
        <select className='bulk__select' value={value} onChange={onChange}>
            {children}
        </select>
    </div>
);

const BulkTrader = observer(() => {
    const { client, transactions } = useStore();
    const currency = client?.currency || 'USD';
    const is_logged_in = !!client?.is_logged_in;

    const [market, setMarket] = useState(MARKETS[0].symbol);
    const [trade_type, setTradeType] = useState('matches_differs');
    const [ticks_input, setTicksInput] = useState<number>(1000);
    const [ticks_count, setTicksCount] = useState<number>(1000);
    const [prediction, setPrediction] = useState<number>(5);

    const [stake, setStake] = useState<number>(1);
    const [trades, setTrades] = useState<number>(1);
    const [duration, setDuration] = useState<number>(1);
    const [mode, setMode] = useState<'manual' | 'auto'>('manual');
    const manual_on = mode === 'manual';
    const auto_on = mode === 'auto';
    const [martingale, setMartingale] = useState(false);
    const [multiplier, setMultiplier] = useState<number>(2);
    const [recovery, setRecovery] = useState<string>('same');
    const [recovery_prediction, setRecoveryPrediction] = useState<number>(5);
    const [auto_side, setAutoSide] = useState<number>(0);
    const [current_stake, setCurrentStake] = useState<number>(1);

    const [digits, setDigits] = useState<number[]>([]);
    const [last_quote, setLastQuote] = useState<string>('');
    const [feed_error, setFeedError] = useState('');
    const [retry, setRetry] = useState(0);

    const [busy, setBusy] = useState(false);
    const [auto_running, setAutoRunning] = useState(false);
    const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

    // Over 1 scanner
    const [scanner_on, setScannerOn] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [scan_pct, setScanPct] = useState<Record<string, number[]>>({});
    const [scan_status, setScanStatus] = useState('');

    // Extra trade connections so a batch is fired side by side instead of queuing on one socket.
    useEffect(() => {
        if (!is_logged_in) return;
        const wanted = clamp(Math.round(trades) || 1, 1, 50);
        batch_lanes.warm(Math.min(wanted - 1, MAX_EXTRA_LANES));
    }, [is_logged_in, client?.loginid, trades]);
    useEffect(() => () => batch_lanes.close(), [is_logged_in, client?.loginid]);

    const root_ref = useRef<HTMLDivElement>(null);
    const dp_ref = useRef<number>(MARKETS[0].dp);
    const sub_id = useRef('');
    const stop_ref = useRef(false);
    const run_id = useRef(0);
    const stop_signal = useRef<(() => void) | null>(null);
    const waiters = useRef<Map<number, (profit: number) => void>>(new Map());
    const settled = useRef<Set<number>>(new Set());
    const own = useRef<Set<number>>(new Set());
    const batches = useRef<Map<number, { pending: number; profit: number }>>(new Map());
    const contract_batch = useRef<Map<number, number>>(new Map());
    const batch_seq = useRef(0);
    const live = useRef<any>({});
    const fire_ref = useRef<any>(null);
    live.current = { stake, current_stake, martingale, multiplier, recovery, recovery_prediction, prediction };

    const type_def = TRADE_TYPES.find(t => t.key === trade_type) || TRADE_TYPES[0];
    const market_def = MARKETS.find(m => m.symbol === market) || MARKETS[0];

    // keep the working stake in line with the stake box when martingale is off / stake edited
    useEffect(() => {
        setCurrentStake(stake);
    }, [stake, martingale]);

    // keep prediction inside the range Deriv accepts for the trade type
    useEffect(() => {
        if (trade_type === 'over_under') setPrediction(p => clamp(p, 1, 8));
    }, [trade_type]);

    // debounce the "number of ticks" box
    useEffect(() => {
        const t = setTimeout(() => setTicksCount(clamp(Math.round(Number(ticks_input) || 1000), 20, MAX_TICKS)), 600);
        return () => clearTimeout(t);
    }, [ticks_input]);

    // ---- live ticks + history ----
    useEffect(() => {
        let cancelled = false;
        let msg_sub: { unsubscribe: () => void } | null = null;
        dp_ref.current = market_def.dp;
        setDigits([]);
        setLastQuote('');
        setFeedError('');

        const start = async () => {
            if (!api_base.api) {
                setFeedError(localize('Connecting to live markets…'));
                setTimeout(() => !cancelled && setRetry(r => r + 1), 1500);
                return;
            }
            msg_sub = api_base.api.onMessage().subscribe(({ data }: any) => {
                if (data?.msg_type !== 'tick' || data.tick?.symbol !== market) return;
                if (data.tick.pip_size !== undefined) dp_ref.current = Number(data.tick.pip_size);
                const dp = dp_ref.current;
                setLastQuote(Number(data.tick.quote).toFixed(dp));
                setDigits(prev => [...prev, toDigit(data.tick.quote, dp)].slice(-ticks_count));
            });

            const base_request = {
                ticks_history: market,
                adjust_start_time: 1,
                count: ticks_count,
                end: 'latest',
                style: 'ticks',
            };
            try {
                let res;
                try {
                    res = await api_base.api.send({ ...base_request, subscribe: 1 });
                    sub_id.current = res?.subscription?.id || '';
                } catch (e) {
                    // Someone else (the chart or a bot) already streams this market: just read the history
                    if (e?.error?.code !== 'AlreadySubscribed') throw e;
                    res = await api_base.api.send(base_request);
                }
                if (cancelled) return;
                if (res?.pip_size !== undefined) dp_ref.current = Number(res.pip_size);
                const prices = res?.history?.prices || [];
                setDigits(prices.map((p: number) => toDigit(p, dp_ref.current)).slice(-ticks_count));
                if (prices.length) setLastQuote(Number(prices[prices.length - 1]).toFixed(dp_ref.current));
            } catch (e) {
                if (!cancelled) setFeedError(errMsg(e));
            }
        };
        start();

        return () => {
            cancelled = true;
            msg_sub?.unsubscribe();
            if (sub_id.current && api_base.api) {
                api_base.api.send({ forget: sub_id.current }).catch(() => {});
                sub_id.current = '';
            }
        };
    }, [market, ticks_count, retry]);

    // ---- contract results (for the log, martingale and automated mode) ----
    const settleContract = useCallback((c: any) => {
        if (!c || !own.current.has(c.contract_id) || !c.is_sold || settled.current.has(c.contract_id)) return;
        settled.current.add(c.contract_id);
        const profit = Number(c.profit);

        // Martingale is applied once per batch of contracts that were fired together
        const batch_id = contract_batch.current.get(c.contract_id);
        const batch = batch_id !== undefined ? batches.current.get(batch_id) : undefined;
        if (batch) {
            batch.pending -= 1;
            batch.profit += profit;
            if (batch.pending <= 0) {
                batches.current.delete(batch_id);
                const { martingale: m, multiplier: mult, stake: base } = live.current;
                if (m) {
                    live.current.current_stake =
                        batch.profit < 0 ? round2(live.current.current_stake * Math.max(1, mult)) : base;
                    setCurrentStake(live.current.current_stake);
                }
            }
        }
        contract_batch.current.delete(c.contract_id);

        waiters.current.get(c.contract_id)?.(profit);
        waiters.current.delete(c.contract_id);
    }, []);

    // Every update of one of our contracts goes to the side panel (Summary / Transactions) and the settle logic
    const onContract = useCallback(
        (c: any) => {
            if (!c || !own.current.has(c.contract_id) || settled.current.has(c.contract_id)) return;
            try {
                transactions?.onBotContractEvent?.(c);
            } catch (e) {
                // the side panel is optional
            }
            settleContract(c);
        },
        [settleContract, transactions]
    );

    // Push messages from the shared connection
    useEffect(() => {
        if (!api_base.api) return;
        const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data?.msg_type === 'proposal_open_contract') onContract(data.proposal_open_contract);
        });
        return () => sub.unsubscribe();
    }, [retry, onContract]);

    // Poll one contract until it is sold (same one-shot request the bot engine uses)
    const trackContract = useCallback(
        async (cid: number) => {
            const started = Date.now();
            while (!settled.current.has(cid) && Date.now() - started < SETTLE_TIMEOUT_MS) {
                await new Promise(r => setTimeout(r, 1500));
                try {
                    const res = await api_base.api.send({ proposal_open_contract: 1, contract_id: cid });
                    onContract(res?.proposal_open_contract);
                } catch (e) {
                    // try again on the next round
                }
            }
        },
        [onContract]
    );

    // ---- statistics ----
    const stats = useMemo(() => {
        const counts = Array(10).fill(0);
        digits.forEach(d => (counts[d] += 1));
        const total = digits.length || 1;
        const pct = counts.map(c => (c / total) * 100);
        const sorted = [...new Set(pct.map(p => p.toFixed(1)))].map(Number).sort((a, b) => b - a);
        return { pct, max: sorted[0], second_max: sorted[1], min: sorted[sorted.length - 1], second_min: sorted[sorted.length - 2] };
    }, [digits]);

    const ringClass = (p: number) => {
        if (digits.length < 20) return '';
        const v = Number(p.toFixed(1));
        if (v === stats.max) return 'bulk__digit--green';
        if (v === stats.min) return 'bulk__digit--red';
        if (v === stats.second_max) return 'bulk__digit--blue';
        if (v === stats.second_min) return 'bulk__digit--yellow';
        return '';
    };

    const sides = getSides(trade_type, prediction);
    const sidePct = (i: number) => {
        const p = stats.pct;
        const sum = (f: (d: number) => boolean) => DIGITS.filter(f).reduce((a, d) => a + p[d], 0);
        if (!digits.length) return 0;
        if (trade_type === 'even_odd') return i === 0 ? sum(d => d % 2 === 0) : sum(d => d % 2 === 1);
        if (trade_type === 'over_under') return i === 0 ? sum(d => d > prediction) : sum(d => d < prediction);
        return i === 0 ? 100 - p[prediction] : p[prediction];
    };

    const last_digit = digits.length ? digits[digits.length - 1] : null;
    const badges = digits.slice(-8).map(d => getBadge(trade_type, d, prediction));

    // ---- trading ----
    const buyOne = async (side: { key: string; label: string; barrier: boolean }, lane_index = 0, symbol = market) => {
        const amount = live.current.current_stake;
        const parameters: Record<string, any> = {
            amount,
            basis: 'stake',
            contract_type: side.key,
            currency,
            duration: clamp(Math.round(duration) || 1, 1, 10),
            duration_unit: 't',
            underlying_symbol: symbol,
        };
        if (side.barrier) parameters.barrier = String(side.barrier_value ?? prediction);
        const res = await batch_lanes.send(lane_index, { buy: '1', price: Number(amount), parameters }, request =>
            api_base.api.send(request)
        );
        const cid = res.buy.contract_id;
        own.current.add(cid);
        trackContract(cid);
        return cid;
    };

    const waitForResult = (cid: number) =>
        new Promise<number | null>(resolve => {
            const timer = setTimeout(() => {
                waiters.current.delete(cid);
                resolve(null);
            }, SETTLE_TIMEOUT_MS);
            waiters.current.set(cid, p => {
                clearTimeout(timer);
                resolve(p);
            });
        });

    const fire = async (
        side: { key: string; label: string; barrier: boolean },
        opts: { symbol?: string; scanner?: boolean } = {}
    ) => {
        if (!is_logged_in) {
            setMessage({ type: 'error', text: localize('Please log in to trade.') });
            return;
        }
        if (!opts.scanner && !manual_on && !auto_on) {
            setMessage({ type: 'error', text: localize('Tick Manual or Automated first.') });
            return;
        }
        if (auto_running) {
            setMessage({ type: 'error', text: localize('Automated trading is running. Press Stop first.') });
            return;
        }
        if (!(live.current.current_stake >= 0.35)) {
            setMessage({ type: 'error', text: localize('Minimum stake is 0.35.') });
            return;
        }
        const count = clamp(Math.round(trades) || 1, 1, 50);
        setMessage(null);
        stop_ref.current = false;
        run_id.current += 1;
        const my_run = run_id.current;
        const stopped = new Promise<void>(resolve => {
            stop_signal.current = resolve;
        });

        // Fire `count` contracts at the same moment and group them for martingale
        const fireBatch = async (batch_side = side) => {
            const results = await Promise.allSettled(Array.from({ length: count }, (_, i) => buyOne(batch_side, i, opts.symbol)));
            const ids = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value as number);
            const first_error = (results.find(r => r.status === 'rejected') as any)?.reason;
            if (ids.length) {
                const batch_id = (batch_seq.current += 1);
                batches.current.set(batch_id, { pending: ids.length, profit: 0 });
                ids.forEach(id => contract_batch.current.set(id, batch_id));
            }
            return { ids, first_error };
        };

        try {
            if (auto_on && !opts.scanner) {
                // Automated: keep firing the batch again as soon as the last one has finished, until Stop
                setAutoRunning(true);
                let in_recovery = false;
                while (!stop_ref.current && run_id.current === my_run) {
                    const { martingale: m, recovery: rec, recovery_prediction: rec_pred } = live.current;
                    const recovery_side = m && in_recovery ? getRecoverySide(rec, rec_pred) : null;
                    const { ids, first_error } = await fireBatch(recovery_side || side);
                    if (run_id.current !== my_run) break;
                    if (first_error) setMessage({ type: 'error', text: errMsg(first_error) });
                    if (!ids.length) break;
                    // wait for this batch to finish, but give up the moment Stop is pressed
                    const profits: any = await Promise.race([Promise.all(ids.map(waitForResult)), stopped.then(() => null)]);
                    if (!profits || run_id.current !== my_run) break;
                    const known = profits.filter((p: number | null) => p !== null) as number[];
                    if (known.length) in_recovery = known.reduce((a, b) => a + b, 0) < 0;
                }
            } else {
                setBusy(true);
                const { first_error } = await fireBatch();
                if (first_error) setMessage({ type: 'error', text: errMsg(first_error) });
            }
        } catch (e) {
            setMessage({ type: 'error', text: errMsg(e) });
        } finally {
            if (run_id.current === my_run) {
                setBusy(false);
                setAutoRunning(false);
            }
        }
    };

    fire_ref.current = fire;

    // Stop: no more trades are started and the screen leaves "running" straight away
    const stopAuto = () => {
        stop_ref.current = true;
        run_id.current += 1;
        stop_signal.current?.();
        setAutoRunning(false);
        setBusy(false);
    };

    // ---- Over 1 scanner: watch all 10 volatilities, trade the first one that meets the rule ----
    useEffect(() => {
        if (!scanning) return;
        if (!api_base.api) {
            setScanStatus(localize('Connecting to live markets…'));
            setScanning(false);
            return;
        }
        let cancelled = false;
        let loaded_all = false;
        let fired = false;
        const bufs: Record<string, number[]> = {};
        const dps: Record<string, number> = {};
        const seen: Record<string, number> = {};
        const pct_now: Record<string, number[]> = {};
        const own_subs: string[] = [];
        const failed: string[] = [];

        setScanPct({});
        setScanStatus(localize('Analysing the volatilities…'));

        const check = () => {
            if (fired || cancelled || !loaded_all) return;
            const hit = MARKETS.find(m => pct_now[m.symbol] && meetsOver1(pct_now[m.symbol]));
            if (!hit) return;
            fired = true;
            setScanStatus(`${localize('Signal found on')} ${hit.name}. ${localize('Placing Over 1…')}`);
            setMarket(hit.symbol);
            fire_ref.current?.(OVER1_SIDE, { symbol: hit.symbol, scanner: true });
            setScanning(false);
        };

        const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data?.msg_type !== 'tick') return;
            const sym = data.tick?.symbol;
            if (!bufs[sym]) return;
            if (data.tick.pip_size !== undefined) dps[sym] = Number(data.tick.pip_size);
            bufs[sym].push(toDigit(data.tick.quote, dps[sym]));
            if (bufs[sym].length > ticks_count) bufs[sym].shift();
            seen[sym] = Date.now();
            pct_now[sym] = digitPercents(bufs[sym]);
            setScanPct(prev => ({ ...prev, [sym]: pct_now[sym] }));
            check();
        });

        const load = async () => {
            for (let i = 0; i < MARKETS.length; i++) {
                if (cancelled) return;
                const m = MARKETS[i];
                const base = { ticks_history: m.symbol, adjust_start_time: 1, count: ticks_count, end: 'latest', style: 'ticks' };
                try {
                    let res;
                    try {
                        res = await api_base.api.send({ ...base, subscribe: 1 });
                        const id = res?.subscription?.id;
                        if (id) {
                            if (cancelled) api_base.api.send({ forget: id }).catch(() => {});
                            else own_subs.push(id);
                        }
                    } catch (e) {
                        // already streamed by the chart / main feed: read the history, ticks still reach us
                        if (e?.error?.code !== 'AlreadySubscribed') throw e;
                        res = await api_base.api.send(base);
                    }
                    if (cancelled) return;
                    dps[m.symbol] = res?.pip_size !== undefined ? Number(res.pip_size) : m.dp;
                    const prices = res?.history?.prices || [];
                    bufs[m.symbol] = prices.map((q: number) => toDigit(q, dps[m.symbol])).slice(-ticks_count);
                    seen[m.symbol] = Date.now();
                    pct_now[m.symbol] = digitPercents(bufs[m.symbol]);
                    setScanPct(prev => ({ ...prev, [m.symbol]: pct_now[m.symbol] }));
                } catch (e) {
                    failed.push(m.name);
                }
                setScanStatus(`${localize('Analysing the volatilities…')} ${i + 1}/${MARKETS.length}`);
            }
            if (cancelled) return;
            loaded_all = true;
            setScanStatus(
                failed.length
                    ? `${localize('Watching live ticks. Could not load:')} ${failed.join(', ')}`
                    : localize('Analysis done. Watching live ticks for a signal…')
            );
            check();
        };
        load();

        // a market that went quiet (its stream was closed by someone else) is subscribed again
        const watchdog = setInterval(() => {
            if (!loaded_all) return;
            MARKETS.forEach(m => {
                if (!bufs[m.symbol] || Date.now() - (seen[m.symbol] || 0) < 8000) return;
                api_base.api
                    .send({ ticks: m.symbol, subscribe: 1 })
                    .then((r: any) => r?.subscription?.id && own_subs.push(r.subscription.id))
                    .catch(() => {});
            });
        }, 8000);

        return () => {
            cancelled = true;
            sub.unsubscribe();
            clearInterval(watchdog);
            if (api_base.api) own_subs.forEach(id => api_base.api.send({ forget: id }).catch(() => {}));
            // let the main digits feed pick its own stream up again
            if (own_subs.length) setRetry(r => r + 1);
        };
    }, [scanning, ticks_count]);

    const startScan = () => {
        if (!is_logged_in) {
            setMessage({ type: 'error', text: localize('Please log in to trade.') });
            return;
        }
        if (auto_running || busy) {
            setMessage({ type: 'error', text: localize('Automated trading is running. Press Stop first.') });
            return;
        }
        if (!(live.current.current_stake >= 0.35)) {
            setMessage({ type: 'error', text: localize('Minimum stake is 0.35.') });
            return;
        }
        setMessage(null);
        setScanning(true);
    };

    const stopScan = () => {
        setScanning(false);
        setScanStatus(localize('Stopped.'));
    };

    const toggleScanner = () => {
        if (scanner_on) setScanning(false);
        setScannerOn(on => !on);
    };

    return (
        <div className='bulk' ref={root_ref}>
            <div className='bulk__grid'>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Market')}</label>
                    <SelectBox
                        variant='triangle'
                        label={market_def.name}
                        value={market}
                        onChange={e => setMarket(e.target.value)}
                        icon={<MarketIcon name={market_def.name} />}
                    >
                        {MARKETS.map(m => (
                            <option key={m.symbol} value={m.symbol}>
                                {m.name}
                            </option>
                        ))}
                    </SelectBox>
                </div>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Trade type')}</label>
                    <SelectBox label={type_def.label} value={trade_type} onChange={e => setTradeType(e.target.value)}>
                        {TRADE_TYPES.map(t => (
                            <option key={t.key} value={t.key}>
                                {t.label}
                            </option>
                        ))}
                    </SelectBox>
                </div>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Number of ticks')}</label>
                    <NumInput value={ticks_input} onChange={setTicksInput} min={20} max={MAX_TICKS} integer fallback={1000} />
                </div>
                {type_def.has_prediction && (
                    <div className='bulk__field'>
                        <label className='bulk__label'>{localize('Prediction')}</label>
                        <NumInput
                            value={prediction}
                            onChange={setPrediction}
                            min={trade_type === 'over_under' ? 1 : 0}
                            max={trade_type === 'over_under' ? 8 : 9}
                            integer
                            fallback={5}
                        />
                    </div>
                )}
            </div>

            <div className='bulk__tick'>
                <div className='bulk__label bulk__label--center'>{localize('Current tick')}</div>
                <div className='bulk__tick-value'>{last_quote || '—'}</div>
            </div>

            {feed_error ? (
                <p className='bulk__muted bulk__center'>{feed_error}</p>
            ) : (
                <>
                    <div className='bulk__digits'>
                        {DIGITS.map(d => (
                            <div key={d} className='bulk__digit-wrap'>
                                {last_digit === d && <span className='bulk__pointer' />}
                                <div className={classNames('bulk__digit', ringClass(stats.pct[d]))}>
                                    <strong>{d}</strong>
                                    <small>{digits.length ? `${stats.pct[d].toFixed(1)}%` : '—'}</small>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className='bulk__badges'>
                        {badges.map((b, i) => (
                            <span key={i} className={classNames('bulk__badge', `bulk__badge--${b.c}`)}>
                                {b.t}
                            </span>
                        ))}
                    </div>
                </>
            )}

            <div className='bulk__grid bulk__grid--three'>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Stake')}</label>
                    <NumInput value={stake} onChange={setStake} min={0.35} max={100000} fallback={1} />
                </div>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('No of trades')}</label>
                    <NumInput value={trades} onChange={setTrades} min={1} max={50} integer fallback={1} />
                </div>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Ticks')}</label>
                    <NumInput value={duration} onChange={setDuration} min={1} max={10} integer fallback={1} />
                </div>
            </div>

            <div className='bulk__modes'>
                <Check checked={manual_on} onChange={() => setMode('manual')} label={localize('Manual')} />
                <Check checked={auto_on} onChange={() => setMode('auto')} label={localize('Automated')} />
            </div>
            <p className='bulk__hint'>
                {auto_on
                    ? `${localize('Pick a side, then press Run: it fires')} ${trades} ${trades === 1 ? localize('contract') : localize('contracts')} ${localize('at once, again and again, until you press Stop.')}`
                    : `${localize('Click a side button to fire')} ${trades} ${trades === 1 ? localize('contract') : localize('contracts')} ${localize('at once')}`}
            </p>
            {message?.type === 'error' && <p className='bulk__bad'>{message.text}</p>}

            <div className='bulk__sides'>
                {sides.map((s, i) => (
                    <button
                        type='button'
                        key={s.key}
                        className={classNames('bulk__side', i === 0 ? 'bulk__side--left' : 'bulk__side--right', {
                            'bulk__side--selected': auto_on && auto_side === i,
                        })}
                        disabled={busy || auto_running}
                        onClick={() => (auto_on ? setAutoSide(i) : fire(s))}
                    >
                        <span className='bulk__side-top'>
                            {s.label}
                            {auto_on && auto_side === i ? '  ✓' : ''}
                        </span>
                        <span className='bulk__side-bottom'>{digits.length ? `${sidePct(i).toFixed(1)}%` : '—'}</span>
                    </button>
                ))}
            </div>

            {auto_running && (
                <button type='button' className='bulk__stop' onClick={stopAuto}>
                    {localize('Stop')}
                </button>
            )}

            <div className='bulk__martingale'>
                <Check checked={martingale} onChange={() => setMartingale(m => !m)} label={localize('Enable martingale')} />
                {martingale && (
                    <div className='bulk__martingale-fields'>
                        <div className='bulk__field'>
                            <label className='bulk__label'>{localize('Martingale multiplier (stake after a loss)')}</label>
                            <NumInput value={multiplier} onChange={setMultiplier} min={1} max={100} fallback={2} />
                        </div>
                        {auto_on && (
                            <div className='bulk__field'>
                                <label className='bulk__label'>{localize('Recovery trade (after a loss)')}</label>
                                <SelectBox
                                    label={localize((RECOVERY_OPTIONS.find(o => o.key === recovery) || RECOVERY_OPTIONS[0]).label)}
                                    value={recovery}
                                    onChange={e => setRecovery(e.target.value)}>
                                    {RECOVERY_OPTIONS.map(o => (
                                        <option key={o.key} value={o.key}>
                                            {localize(o.label)}
                                        </option>
                                    ))}
                                </SelectBox>
                            </div>
                        )}
                        {auto_on && RECOVERY_RANGE[recovery] && (
                            <div className='bulk__field'>
                                <label className='bulk__label'>{localize('Recovery prediction')}</label>
                                <NumInput
                                    value={recovery_prediction}
                                    onChange={setRecoveryPrediction}
                                    min={RECOVERY_RANGE[recovery][0]}
                                    max={RECOVERY_RANGE[recovery][1]}
                                    integer
                                    fallback={5}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>
            <button
                type='button'
                className={classNames('bulk__run', { 'bulk__run--stop': auto_running })}
                disabled={!auto_on || (busy && !auto_running)}
                title={auto_on ? '' : localize('Switch to Automated to use Run')}
                onClick={() => (auto_running ? stopAuto() : fire(sides[auto_side]))}
            >
                {auto_running ? localize('Stop') : localize('Run')}
            </button>

            <div className='bulk__scan'>
                <Check checked={scanner_on} onChange={toggleScanner} label={localize('Over 1 (scan all 10 volatilities)')} />
                {scanner_on && (
                    <div className='bulk__scan-box'>
                        <p className='bulk__hint'>
                            {`${localize('Run scans all 10 volatilities and trades Over 1 on the first one where')} ${OVER1_RULES.map(r => `${r.digit} ≥ ${r.min}%`).join(', ')}. ${localize('It stops after it trades, using your stake, number of trades and ticks.')}`}
                        </p>
                        <button
                            type='button'
                            className={classNames('bulk__run', { 'bulk__run--stop': scanning })}
                            disabled={busy && !scanning}
                            onClick={scanning ? stopScan : startScan}
                        >
                            {scanning ? localize('Stop') : localize('Run')}
                        </button>
                        {scan_status && <p className='bulk__muted'>{scan_status}</p>}
                        {message?.type === 'error' && <p className='bulk__bad'>{message.text}</p>}
                        <div className='bulk__scan-list'>
                            {MARKETS.map(m => {
                                const pct = scan_pct[m.symbol];
                                const ok = !!pct && meetsOver1(pct);
                                return (
                                    <div key={m.symbol} className={classNames('bulk__scan-row', { 'bulk__scan-row--hit': ok })}>
                                        <div className='bulk__scan-name'>
                                            {m.name}
                                            {ok ? '  ✓' : ''}
                                        </div>
                                        <div className='bulk__scan-cells'>
                                            {DIGITS.map(d => {
                                                const rule = OVER1_RULES.find(r => r.digit === d);
                                                const v = pct ? pct[d] : null;
                                                const pass = !!rule && v !== null && Number(v.toFixed(1)) >= rule.min;
                                                return (
                                                    <div
                                                        key={d}
                                                        className={classNames('bulk__scan-cell', {
                                                            'bulk__scan-cell--rule': !!rule,
                                                            'bulk__scan-cell--pass': pass,
                                                        })}
                                                    >
                                                        <strong>{d}</strong>
                                                        <small>{v === null ? '—' : `${v.toFixed(1)}%`}</small>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

export default BulkTrader;
