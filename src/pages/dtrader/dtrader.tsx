// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { batch_lanes } from '@/pages/bulk-trader/batch-sockets';
import ChartWrapper from '@/pages/chart/chart-wrapper';
import { localize } from '@deriv-com/translations';
import './dtrader.scss';

// DTrader look-alike: Open positions (left), live chart with symbol card (middle),
// trade panel (right) and a Trade types popup. Uses the same Deriv connection as the other pages.

const MARKETS = [
    { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index', dp: 2, v: 10, mult: [400, 1000, 2000, 3000, 4000] },
    { symbol: 'R_10', name: 'Volatility 10 Index', dp: 3, v: 10, mult: [400, 1000, 2000, 3000, 4000] },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index', dp: 2, v: 25, mult: [160, 400, 800, 1200, 1600] },
    { symbol: 'R_25', name: 'Volatility 25 Index', dp: 3, v: 25, mult: [160, 400, 800, 1200, 1600] },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index', dp: 2, v: 50, mult: [80, 200, 400, 600, 800] },
    { symbol: 'R_50', name: 'Volatility 50 Index', dp: 4, v: 50, mult: [80, 200, 400, 600, 800] },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index', dp: 2, v: 75, mult: [50, 100, 200, 300, 500] },
    { symbol: 'R_75', name: 'Volatility 75 Index', dp: 4, v: 75, mult: [50, 100, 200, 300, 500] },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index', dp: 2, v: 100, mult: [40, 100, 200, 300, 500] },
    { symbol: 'R_100', name: 'Volatility 100 Index', dp: 2, v: 100, mult: [40, 100, 200, 300, 500] },
];
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const HIST = 1000;

// kind: accu | single (one Buy button, two sides) | mult | dual (two buttons)
// dur: 'time' (minutes etc.) | 'ticks' | null ; bar: 'strike' | 'rel' | 'turbo' | null
const TYPES = [
    { key: 'accumulators', group: 'Accumulators', cat: 'accumulators', label: 'Accumulators', icon: ['📈'], kind: 'accu' },
    {
        key: 'vanillas', group: 'Vanillas', cat: 'options', label: 'Call/Put', icon: ['↗', '↘'], kind: 'single', dur: 'time', bar: 'strike',
        sides: [{ ct: 'VANILLALONGCALL', label: 'Call' }, { ct: 'VANILLALONGPUT', label: 'Put' }],
    },
    {
        key: 'turbos', group: 'Turbos', cat: 'options', label: 'Turbos', icon: ['↗', '↘'], kind: 'single', dur: 'time', bar: 'turbo',
        sides: [{ ct: 'TURBOSLONG', label: 'Up' }, { ct: 'TURBOSSHORT', label: 'Down' }],
    },
    {
        key: 'multipliers', group: 'Multipliers', cat: 'multipliers', label: 'Multipliers', icon: ['↗', '↘'], kind: 'mult',
        sides: [{ ct: 'MULTUP', label: 'Up' }, { ct: 'MULTDOWN', label: 'Down' }],
    },
    {
        key: 'risefall', group: 'Ups & Downs', cat: 'options', label: 'Rise/Fall', icon: ['↗', '↘'], kind: 'dual', dur: 'time', basis: true, equals: true,
        sides: [{ ct: 'CALL', label: 'Rise' }, { ct: 'PUT', label: 'Fall' }],
    },
    {
        key: 'higherlower', group: 'Ups & Downs', cat: 'options', label: 'Higher/Lower', icon: ['⇗', '⇘'], kind: 'dual', dur: 'time', bar: 'rel', basis: true,
        sides: [{ ct: 'CALL', label: 'Higher' }, { ct: 'PUT', label: 'Lower' }],
    },
    {
        key: 'touch', group: 'Touch & No Touch', cat: 'options', label: 'Touch/No Touch', icon: ['⇗', '⤳'], kind: 'dual', dur: 'time', bar: 'rel', basis: true, min_min: 2,
        sides: [{ ct: 'ONETOUCH', label: 'Touch' }, { ct: 'NOTOUCH', label: 'No Touch' }],
    },
    {
        key: 'matchdiffer', group: 'Digits', cat: 'options', label: 'Matches/Differs', icon: ['✳', '✳'], kind: 'dual', dur: 'ticks', basis: true, pick: [0, 9],
        sides: [{ ct: 'DIGITMATCH', label: 'Matches' }, { ct: 'DIGITDIFF', label: 'Differs' }],
    },
    {
        key: 'evenodd', group: 'Digits', cat: 'options', label: 'Even/Odd', icon: ['▦', '▲'], kind: 'dual', dur: 'ticks', basis: true,
        sides: [{ ct: 'DIGITEVEN', label: 'Even' }, { ct: 'DIGITODD', label: 'Odd' }],
    },
    {
        key: 'overunder', group: 'Digits', cat: 'options', label: 'Over/Under', icon: ['⇗', '⇘'], kind: 'dual', dur: 'ticks', basis: true, pick: [1, 8],
        sides: [{ ct: 'DIGITOVER', label: 'Over' }, { ct: 'DIGITUNDER', label: 'Under' }],
    },
];
const CATEGORIES = [
    { key: 'all', label: 'All' },
    { key: 'multipliers', label: 'Multipliers' },
    { key: 'options', label: 'Options' },
    { key: 'accumulators', label: 'Accumulators' },
];
const GROUP_ORDER = ['Accumulators', 'Vanillas', 'Turbos', 'Multipliers', 'Ups & Downs', 'Touch & No Touch', 'Digits'];
const UNITS = [
    { u: 'm', label: 'Minutes', max: 1440 },
    { u: 'h', label: 'Hours', max: 24 },
    { u: 'd', label: 'Days', max: 365 },
    { u: 's', label: 'Seconds', max: 86400 },
];
const UNIT_SHORT: Record<string, string> = { m: 'min', h: 'hr', d: 'day', s: 'sec' };
const DEFAULT_BARRIER: Record<string, string> = { vanillas: '+0.00', turbos: '-7.04', higherlower: '+0.66', touch: '+1.88' };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toDigit = (quote: number | string, dp: number) => Number(Number(quote).toFixed(dp).slice(-1));
const errMsg = (e: any) => e?.error?.message || e?.message || localize('Something went wrong');
const percents = (list: number[]) => {
    const counts = Array(10).fill(0);
    list.forEach(d => (counts[d] += 1));
    const total = list.length || 1;
    return counts.map(n => (n / total) * 100);
};
const hms = (epoch: number) => new Date(epoch * 1000).toISOString().slice(11, 19);
const niceStep = (raw: number) => {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
};
const absPrice = (v: any, spot: number) => {
    if (v === undefined || v === null || v === '') return NaN;
    const s = String(v);
    return /^[+-]/.test(s) ? spot + Number(s) : Number(s);
};

const Stepper = ({ value, onChange, ctl, label }: any) => (
    <div className='dtrader__stepper'>
        <button type='button' onClick={ctl.dec} aria-label={`${label} -`}>
            −
        </button>
        <input type='number' inputMode='decimal' value={value} onChange={e => onChange(e.target.value)} />
        <button type='button' onClick={ctl.inc} aria-label={`${label} +`}>
            +
        </button>
    </div>
);


const useIsMobile = () => {
    const q = '(max-width: 760px)';
    const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
    useEffect(() => {
        const mq = window.matchMedia(q);
        const on = () => setM(mq.matches);
        on();
        mq.addEventListener('change', on);
        return () => mq.removeEventListener('change', on);
    }, []);
    return m;
};

const Icons = ({ t }: any) => (
    <span className='dtrader__icons'>
        {t.icon.map((g: string, i: number) => (
            <span key={i} className={classNames('dtrader__icon', { 'dtrader__icon--b': i === 1 })}>
                {g}
            </span>
        ))}
    </span>
);

const DTrader = observer(() => {
    const { client, chart_store } = useStore();
    const currency = client?.currency || 'USD';
    const is_logged_in = !!client?.is_logged_in;

    const [symbol, setSymbol] = useState('1HZ100V');

    // Keep the Charts-tab chart and the DTrader market in step (both directions)
    useEffect(() => {
        if (chart_store.symbol !== symbol) chart_store.onSymbolChange(symbol);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol]);
    const chart_symbol = chart_store.symbol;
    useEffect(() => {
        if (chart_symbol && chart_symbol !== symbol && MARKETS.some(m => m.symbol === chart_symbol)) {
            setSymbol(chart_symbol);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chart_symbol]);
    const [type_key, setTypeKey] = useState('accumulators');
    const [side, setSide] = useState(0);
    const [stake, setStake] = useState<number | string>(10);
    const [basis, setBasis] = useState<'stake' | 'payout'>('stake');
    const [growth, setGrowth] = useState(3);
    const [mult_i, setMultI] = useState(0);
    const [take_profit, setTakeProfit] = useState(false);
    const [tp_amount, setTpAmount] = useState<number | string>(10);
    const [stop_loss, setStopLoss] = useState(false);
    const [sl_amount, setSlAmount] = useState<number | string>(10);
    const [deal_cancel, setDealCancel] = useState(false);
    const [equals, setEquals] = useState(false);
    const [dur_unit, setDurUnit] = useState('m');
    const [dur_val, setDurVal] = useState<number | string>(3);
    const [ticks_dur, setTicksDur] = useState(1);
    const [barrier_txt, setBarrierTxt] = useState('+0.00');
    const [digit, setDigit] = useState(5);

    const [last_tick, setLastTick] = useState<{ epoch: number; quote: number } | null>(null);
    const [dp, setDp] = useState(2);
    const [pct, setPct] = useState<number[]>(Array(10).fill(0));
    const [last_digit, setLastDigit] = useState<number | null>(null);
    const [feed_status, setFeedStatus] = useState(localize('Connecting…'));
    const [quotes, setQuotes] = useState<any[]>([]);
    const [trades, setTrades] = useState<any[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [pos_open, setPosOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 760);
    const [risk_open, setRiskOpen] = useState(false);
    const [show_types, setShowTypes] = useState(false);
    const [show_markets, setShowMarkets] = useState(false);
    const [cat, setCat] = useState('all');
    const [search, setSearch] = useState('');

    // Spare trade connections: a click goes out on its own socket instead of queuing behind ticks/prices
    useEffect(() => {
        if (!is_logged_in) return;
        batch_lanes.warm(3);
        return () => batch_lanes.close();
    }, [is_logged_in, client?.loginid]);

    const sub_ids = useRef<Record<number, string>>({});
    const is_mobile = useIsMobile();
    const root_ref = useRef<HTMLDivElement>(null);

    // Phones: the Run bar is a fixed strip at the bottom of the screen. Size DTrader to exactly the space
    // between its own top and that bar, so nothing is hidden underneath it.
    useLayoutEffect(() => {
        const el = root_ref.current;
        if (!el) return;
        if (!is_mobile) {
            el.style.removeProperty('height');
            return;
        }
        const fit = () => {
            const top = el.getBoundingClientRect().top;
            const bar = document.querySelector('.controls__section, .run-panel__footer') as HTMLElement | null;
            const r = bar?.getBoundingClientRect();
            const bar_top = r && r.height > 0 && r.top > top ? r.top : window.innerHeight;
            el.style.height = `${Math.max(300, Math.floor(Math.min(window.innerHeight, bar_top) - top))}px`;
        };
        fit();
        const timers = [setTimeout(fit, 150), setTimeout(fit, 600), setTimeout(fit, 1500)];
        window.addEventListener('resize', fit);
        window.addEventListener('orientationchange', fit);
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
        ro?.observe(document.body);
        const bar_el = document.querySelector('.controls__section, .run-panel__footer');
        if (bar_el) ro?.observe(bar_el);
        return () => {
            timers.forEach(clearTimeout);
            window.removeEventListener('resize', fit);
            window.removeEventListener('orientationchange', fit);
            ro?.disconnect();
        };
    }, [is_mobile]);

    const type = TYPES.find(t => t.key === type_key) || TYPES[0];
    const market = MARKETS.find(m => m.symbol === symbol) || MARKETS[0];
    const stake_n = Number(stake);
    const stake_ok = stake_n > 0;
    const needs_digits = type.dur === 'ticks';

    // sensible defaults when the trade type changes
    useEffect(() => {
        setSide(0);
        setQuotes([]);
        setError('');
        if (DEFAULT_BARRIER[type.key]) setBarrierTxt(DEFAULT_BARRIER[type.key]);
        if (type.dur === 'time') {
            setDurUnit('m');
            setDurVal(type.min_min || 3);
        }
        if (type.pick) setDigit(d => clamp(d, type.pick[0], type.pick[1]));
        if (type.key === 'matchdiffer') setDigit(d => d);
        if (!type.basis) setBasis('stake');
    }, [type.key]);

    // lock page scroll behind the full-screen trade types sheet on phones
    useEffect(() => {
        if (!show_types || !is_mobile) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [show_types, is_mobile]);

    // multiplier list depends on the market
    useEffect(() => setMultI(0), [symbol]);

    // ---- live ticks (digit circles + footer clock). The chart has its own feed. ----
    useEffect(() => {
        if (!api_base.api) {
            setFeedStatus(localize('Not connected. Please refresh the page.'));
            return;
        }
        let cancelled = false;
        let sub_id = '';
        let pip = market.dp;
        const digits: number[] = [];
        const counts: number[] = Array(10).fill(0);
        setLastTick(null);
        setPct(Array(10).fill(0));
        setLastDigit(null);
        setDp(pip);
        setFeedStatus(localize('Loading ticks…'));

        // incremental digit stats: O(1) per tick instead of re-scanning 1000 ticks
        const addDigit = (q: number) => {
            if (!needs_digits) return;
            const d = toDigit(q, pip);
            digits.push(d);
            counts[d] += 1;
            if (digits.length > HIST) counts[digits.shift() as number] -= 1;
        };
        const publishDigits = () => {
            if (!needs_digits) return;
            const total = digits.length || 1;
            setPct(counts.map(n => (n / total) * 100));
            setLastDigit(digits.length ? digits[digits.length - 1] : null);
        };

        const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data?.msg_type !== 'tick' || data.tick?.symbol !== symbol) return;
            if (data.tick.pip_size !== undefined && Number(data.tick.pip_size) !== pip) {
                pip = Number(data.tick.pip_size);
                setDp(pip);
            }
            const quote = Number(data.tick.quote);
            addDigit(quote);
            setLastTick({ epoch: data.tick.epoch, quote });
            publishDigits();
        });

        const start = async () => {
            // only digit trades need history; everything else just needs the latest tick
            const base = { ticks_history: symbol, adjust_start_time: 1, count: needs_digits ? HIST : 1, end: 'latest', style: 'ticks' };
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
                prices.forEach((q: number) => addDigit(Number(q)));
                if (prices.length) setLastTick({ epoch: Number(times[prices.length - 1]), quote: Number(prices[prices.length - 1]) });
                publishDigits();
                setFeedStatus(localize('Live'));
            } catch (e) {
                if (!cancelled) setFeedStatus(errMsg(e));
            }
        };
        start();

        return () => {
            cancelled = true;
            sub.unsubscribe();
            if (sub_id && api_base.api) api_base.api.send({ forget: sub_id }).catch(() => {});
        };
    }, [symbol, needs_digits]);

    // ---- request parameters for one side of the current trade type ----
    const dur_n = clamp(Math.round(Number(dur_val)) || 1, type.min_min || 1, UNITS.find(u => u.u === dur_unit)?.max || 1440);
    const buildParams = useCallback(
        (s: any) => {
            const p: any = {
                amount: stake_n,
                basis: type.basis ? basis : 'stake',
                contract_type: s.ct,
                currency,
                underlying_symbol: symbol,
            };
            if (type.key === 'accumulators') {
                p.contract_type = 'ACCU';
                p.growth_rate = growth / 100;
                if (take_profit) p.limit_order = { take_profit: Number(tp_amount) };
                return p;
            }
            if (type.key === 'multipliers') {
                p.multiplier = market.mult[mult_i];
                const lo: any = {};
                if (take_profit) lo.take_profit = Number(tp_amount);
                if (stop_loss) lo.stop_loss = Number(sl_amount);
                if (Object.keys(lo).length) p.limit_order = lo;
                if (deal_cancel) p.cancellation = '60m';
                return p;
            }
            if (type.key === 'risefall' && equals) p.contract_type = s.ct === 'CALL' ? 'CALLE' : 'PUTE';
            if (type.dur === 'ticks') {
                p.duration = ticks_dur;
                p.duration_unit = 't';
                if (type.pick) p.barrier = String(digit);
            } else if (type.dur === 'time') {
                p.duration = dur_n;
                p.duration_unit = dur_unit;
                if (type.bar) p.barrier = barrier_txt;
            }
            return p;
        },
        [stake_n, basis, currency, symbol, growth, take_profit, tp_amount, stop_loss, sl_amount, deal_cancel, equals, ticks_dur, digit, dur_n, dur_unit, barrier_txt, mult_i, market, type.key]
    );

    const sides_to_quote = type.kind === 'dual' || type.kind === 'mult' ? [0, 1] : type.kind === 'accu' ? [0] : [side];

    // ---- price quotes ----
    useEffect(() => {
        if (!api_base.api || !stake_ok) {
            setQuotes([]);
            return;
        }
        let cancelled = false;
        const defs = type.kind === 'accu' ? [{ ct: 'ACCU' }] : type.sides;
        const timer = setTimeout(async () => {
            const out = await Promise.all(
                sides_to_quote.map(async i => {
                    try {
                        const res = await api_base.api.send({ proposal: 1, ...buildParams(defs[i]) });
                        return { ok: true, ...res.proposal };
                    } catch (e) {
                        return { ok: false, error: errMsg(e) };
                    }
                })
            );
            if (!cancelled) setQuotes(out);
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [buildParams, stake_ok, side, type.key]);

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
                        : { ...t, profit: Number(c.profit), status: c.is_sold ? (Number(c.profit) >= 0 ? 'won' : 'lost') : 'open' }
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
        async (i: number) => {
            setError('');
            if (!is_logged_in) return setError(localize('Please log in to trade.'));
            if (!stake_ok) return setError(localize('Enter a stake.'));
            const defs = type.kind === 'accu' ? [{ ct: 'ACCU', label: 'Accumulators' }] : type.sides;
            const s = defs[i];
            const qi = sides_to_quote.indexOf(i);
            const q = quotes[qi];
            // Stake basis: the price is the stake itself, so the click never waits for a quote
            const price = basis === 'stake' ? stake_n : q?.ok && q.ask_price ? Number(q.ask_price) : NaN;
            if (!Number.isFinite(price)) return setError(localize('Waiting for a price. Try again in a moment.'));

            // show the trade on screen straight away; the real contract id replaces it when Deriv answers
            const tmp = `tmp-${Date.now()}-${Math.random()}`;
            const label = type.kind === 'accu' ? 'Accumulators' : `${type.label}: ${s.label}`;
            setTrades(prev => [{ id: tmp, label, market: market.name, stake: price, profit: null, status: 'open' }, ...prev].slice(0, 30));
            try {
                const parameters = buildParams(s);
                const res = await batch_lanes.sendFast({ buy: '1', price, parameters }, r => api_base.api.send(r));
                const id = res.buy.contract_id;
                setTrades(prev => prev.map(t => (t.id === tmp ? { ...t, id } : t)));
                // follow the contract in the background
                api_base.api
                    .send({ proposal_open_contract: 1, contract_id: id, subscribe: 1 })
                    .then((r: any) => {
                        if (r?.subscription?.id) sub_ids.current[id] = r.subscription.id;
                    })
                    .catch(() => {});
            } catch (e) {
                setTrades(prev => prev.filter(t => t.id !== tmp));
                setError(errMsg(e));
            }
        },
        [is_logged_in, stake_ok, stake_n, quotes, buildParams, type.key, market, basis, side]
    );

    const hi = Math.max(...pct);
    const lo = Math.min(...pct);
    const has_data = pct.some(p => p > 0);
    const is_digit = type.dur === 'ticks';
    const open_count = trades.filter(t => t.status === 'open').length;
    const total = round2(trades.reduce((sum, t) => sum + (t.status !== 'open' && t.profit !== null ? t.profit : 0), 0));

    const num = (setter: any, v: number | string, step = 1, min = 0, max = 1e9) => ({
        dec: () => setter(round2(clamp(Number(v) - step, min, max))),
        inc: () => setter(round2(clamp(Number(v) + step, min, max))),
    });
    const stake_ctl = num(setStake, stake, 1, 0.35);
    const tp_ctl = num(setTpAmount, tp_amount, 1, 0.01);
    const sl_ctl = num(setSlAmount, sl_amount, 1, 0.01);
    const dur_ctl = num(setDurVal, dur_val, 1, type.min_min || 1);

    const payout_pct = (q: any) => (q?.ok && q.payout && q.ask_price ? ((q.payout - q.ask_price) / q.ask_price) * 100 : null);

    const renderDualButton = (i: number) => {
        const s = type.sides[i];
        const q = quotes[i];
        const p = payout_pct(q);
        return (
            <div key={i} className='dtrader__buywrap'>
                <div className='dtrader__payout'>
                    {localize('Payout')} <strong>{q?.ok && q.payout ? `${money(q.payout)} ${currency}` : '…'}</strong>
                </div>
                <button type='button' className={`dtrader__buy dtrader__buy--${i ? 'b' : 'a'}`} disabled={!stake_ok} onClick={() => buy(i)}>
                    <span>
                        {type.icon[i] === undefined ? '' : <em>{type.icon[i]}</em>}
                        {localize(s.label)}
                        {type.pick ? ` ${digit}` : ''}
                    </span>
                    <b>{p === null ? '…' : `${p.toFixed(2)}%`}</b>
                </button>
            </div>
        );
    };

    const renderMobileDual = (i: number) => {
        const s = type.sides[i];
        const q = quotes[i];
        return (
            <button key={i} type='button' className={`dtrader__mbtn dtrader__mbtn--${i ? 'b' : 'a'}`} disabled={!stake_ok} onClick={() => buy(i)}>
                <span className='dtrader__mbtn-top'>
                    <em>{type.icon[i]}</em>
                    {localize(s.label)}
                    {type.pick ? ` ${digit}` : ''}
                </span>
                <span className='dtrader__mbtn-bot'>
                    <span>{localize('Payout')}</span>
                    <b>{q?.ok && q.payout ? `${money(q.payout)} ${currency}` : '…'}</b>
                </span>
            </button>
        );
    };

    const q0 = quotes[0];
    const cd0 = q0?.contract_details || {};
    const filtered = TYPES.filter(t => (cat === 'all' || t.cat === cat) && (!search || t.label.toLowerCase().includes(search.toLowerCase()) || t.group.toLowerCase().includes(search.toLowerCase())));
    const quote_err = quotes.find(q => q && !q.ok)?.error;

    const trade_types_modal = (
        <div className={classNames('dtr-modal', { 'dtr-modal--pop': !is_mobile })} role='dialog' aria-label={localize('Trade types')}>
            <div className='dtr-modal__head'>
                <strong>{localize('Trade types')}</strong>
                <button type='button' onClick={() => setShowTypes(false)} aria-label={localize('Close')}>
                    ✕
                </button>
            </div>
            <div className='dtr-modal__body'>
                <ul className='dtr-modal__cats'>
                    {CATEGORIES.map(c => (
                        <li key={c.key}>
                            <button type='button' className={classNames({ active: cat === c.key })} onClick={() => setCat(c.key)}>
                                {localize(c.label)}
                            </button>
                        </li>
                    ))}
                </ul>
                <div className='dtr-modal__list'>
                    <input className='dtr-modal__search' placeholder={localize('Search')} value={search} onChange={e => setSearch(e.target.value)} />
                    {GROUP_ORDER.filter(g => filtered.some(t => t.group === g)).map(g => (
                        <div key={g} className='dtr-modal__group'>
                            <h4>{localize(g)}</h4>
                            {filtered
                                .filter(t => t.group === g)
                                .map(t => (
                                    <button
                                        key={t.key}
                                        type='button'
                                        className={classNames('dtr-modal__item', { active: t.key === type_key })}
                                        onClick={() => {
                                            setTypeKey(t.key);
                                            setShowTypes(false);
                                        }}
                                    >
                                        <Icons t={t} />
                                        {localize(t.label)}
                                    </button>
                                ))}
                        </div>
                    ))}
                    {filtered.length === 0 && <p className='dtr-modal__none'>{localize('No trade types found.')}</p>}
                </div>
            </div>
        </div>
    );



    const sheet_mode = is_mobile && !is_digit;
    const digit_phone = is_mobile && is_digit;
    const [digit_view, setDigitView] = useState<'digits' | 'chart'>('digits');
    const show_chart = !digit_phone || digit_view === 'chart';
    const show_circles = is_digit && (!digit_phone || digit_view === 'digits');
    const pickSide = (i: number) => {
        setSide(i);
        if (type.key === 'turbos') {
            const v = Math.abs(Number(barrier_txt) || 7.04).toFixed(2);
            setBarrierTxt(i === 0 ? `-${v}` : `+${v}`);
        }
    };
    const stakeInput = (
        <span className='dtm__amt'>
            <input type='number' inputMode='decimal' value={stake} onChange={e => setStake(e.target.value)} />
            <small>{currency}</small>
        </span>
    );
    const unitBtn = (i: number) => {
        const s = type.sides[i];
        const q = quotes[i];
        return (
            <button key={i} type='button' className={`dtm__ubtn dtm__ubtn--${i ? 'b' : 'a'}`} disabled={!stake_ok} onClick={() => buy(i)}>
                <span className='dtm__ubtn-top'>
                    <em>{type.icon[i]}</em>
                    {localize(s.label)}
                </span>
                <span className='dtm__ubtn-bot'>
                    {type.kind === 'mult' ? `${money(stake_n || 0)} ${currency}` : q?.ok && q.payout ? `${money(q.payout)} ${currency}` : '…'}
                </span>
            </button>
        );
    };
    // Accumulators: blue band around the price (kept as offsets so it follows each tick)
    const accu_off = (() => {
        if (type.kind !== 'accu' || !q0?.ok) return 0;
        const cd = q0.contract_details || {};
        const ref = Number(q0.spot);
        const hi_v = absPrice(cd.high_barrier, ref);
        return Number.isFinite(hi_v) && Number.isFinite(ref) ? Math.abs(hi_v - ref) : 0;
    })();
    const chart_barriers = useMemo(
        () => (accu_off > 0 ? [{ shade: 'BETWEEN', color: '#2a8be6', relative: true, high: accu_off, low: -accu_off, hidePriceLines: false }] : []),
        [accu_off]
    );

    const mobile_sheet = (
        <aside className='dtrader__panel dtm'>
            <a className='dtrader__learn'>{localize('Learn about this trade type')}</a>
            {show_types && createPortal(trade_types_modal, document.body)}
            <div className='dtm__top'>
                <button type='button' className='dtm__type' onClick={() => setShowTypes(s => !s)}>
                    <Icons t={type} />
                    <strong>{localize(type.label)}</strong>
                    <span className='dtm__chev'>›</span>
                </button>
                {type.kind === 'accu' && (
                    <label className='dtm__chip'>
                        <select value={growth} onChange={e => setGrowth(Number(e.target.value))}>
                            {[1, 2, 3, 4, 5].map(g => (
                                <option key={g} value={g}>
                                    {g}%
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {type.kind === 'mult' && (
                    <label className='dtm__chip'>
                        <select value={mult_i} onChange={e => setMultI(Number(e.target.value))}>
                            {market.mult.map((m, i) => (
                                <option key={m} value={i}>
                                    x{m}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {type.kind === 'single' && (
                    <div className='dtm__seg'>
                        {type.sides.map((sd, i) => (
                            <button key={sd.ct} type='button' className={classNames({ active: side === i })} onClick={() => pickSide(i)}>
                                {localize(sd.label)}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {type.bar === 'strike' && (
                <div className='dtm__row dtm__row--3'>
                    <span className='dtm__k'>{localize('Spot')}</span>
                    <input className='dtm__v' value={barrier_txt} onChange={e => setBarrierTxt(e.target.value)} />
                    <span className='dtm__lab'>{localize('Strike price')}</span>
                </div>
            )}

            {type.dur === 'time' && (
                <div className='dtm__row dtm__row--3'>
                    <span className='dtm__dur'>
                        <input type='number' inputMode='numeric' value={dur_val} onChange={e => setDurVal(e.target.value)} />
                        <select value={dur_unit} onChange={e => setDurUnit(e.target.value)}>
                            {UNITS.map(u => (
                                <option key={u.u} value={u.u}>
                                    {UNIT_SHORT[u.u]}
                                </option>
                            ))}
                        </select>
                    </span>
                    {stakeInput}
                    {type.basis ? (
                        <button type='button' className='dtm__lab dtm__lab--btn' onClick={() => setBasis(b => (b === 'stake' ? 'payout' : 'stake'))}>
                            {basis === 'stake' ? localize('Stake') : localize('Payout')}
                        </button>
                    ) : (
                        <span className='dtm__lab'>{localize('Stake')}</span>
                    )}
                </div>
            )}

            {(type.bar === 'turbo' || type.bar === 'rel') && (
                <div className='dtm__row dtm__row--3'>
                    <input className='dtm__k dtm__bar' value={barrier_txt} onChange={e => setBarrierTxt(e.target.value)} />
                    <span className='dtm__v'>{type.bar === 'turbo' && q0?.ok ? `${q0.contract_details?.payout_per_point ?? q0.payout} ${currency}` : ''}</span>
                    <span className='dtm__lab'>{type.bar === 'turbo' ? localize('Payout per point') : localize('Barrier')}</span>
                </div>
            )}

            {type.kind === 'accu' && (
                <>
                    <div className='dtm__row dtm__row--step'>
                        <button type='button' onClick={stake_ctl.dec} aria-label='Stake -'>
                            −
                        </button>
                        <input type='number' inputMode='decimal' value={stake} onChange={e => setStake(e.target.value)} />
                        <button type='button' onClick={stake_ctl.inc} aria-label='Stake +'>
                            +
                        </button>
                        <span className='dtm__lab'>{localize('Stake')}</span>
                    </div>
                    <label className='dtm__row dtm__check'>
                        <input type='checkbox' checked={take_profit} onChange={e => setTakeProfit(e.target.checked)} />
                        <span>{localize('Take profit')}</span>
                    </label>
                    {take_profit && (
                        <div className='dtm__row dtm__row--step'>
                            <button type='button' onClick={tp_ctl.dec} aria-label='Take profit -'>
                                −
                            </button>
                            <input type='number' inputMode='decimal' value={tp_amount} onChange={e => setTpAmount(e.target.value)} />
                            <button type='button' onClick={tp_ctl.inc} aria-label='Take profit +'>
                                +
                            </button>
                            <span className='dtm__lab'>{currency}</span>
                        </div>
                    )}
                    {q0?.ok && (
                        <div className='dtm__maxes'>
                            <div>
                                <span>{localize('Max. payout')}</span>
                                <u>{money(cd0.maximum_payout ?? q0.payout ?? 0)} {currency}</u>
                            </div>
                            <div>
                                <span>{localize('Max. ticks')}</span>
                                <u>{cd0.maximum_ticks ?? '—'} {localize('ticks')}</u>
                            </div>
                        </div>
                    )}
                </>
            )}

            {type.kind === 'mult' && (
                <>
                    <div className='dtm__card'>
                        <div className='dtm__big'>{stakeInput}</div>
                        {q0?.ok && (
                            <div className='dtm__mini'>
                                {localize('Commission')}: {money(q0.commission ?? 0)} {currency}
                                <span>
                                    {localize('Stop out')}: {q0.limit_order?.stop_out?.order_amount !== undefined ? `${money(Math.abs(q0.limit_order.stop_out.order_amount))} ${currency}` : '—'}
                                </span>
                            </div>
                        )}
                    </div>
                    <button type='button' className='dtm__row dtm__risk' onClick={() => setRiskOpen(o => !o)}>
                        <span>{localize('Risk management')}</span>
                        <b>{take_profit || stop_loss || deal_cancel ? localize('Set') : localize('Not set')}</b>
                    </button>
                    {risk_open && (
                        <div className='dtm__card'>
                            <label className='dtm__check'>
                                <input type='checkbox' checked={take_profit} onChange={e => setTakeProfit(e.target.checked)} />
                                <span>{localize('Take profit')}</span>
                            </label>
                            {take_profit && <Stepper value={tp_amount} onChange={setTpAmount} ctl={tp_ctl} label='Take profit' />}
                            <label className='dtm__check'>
                                <input
                                    type='checkbox'
                                    checked={stop_loss}
                                    onChange={e => {
                                        setStopLoss(e.target.checked);
                                        if (e.target.checked) setDealCancel(false);
                                    }}
                                />
                                <span>{localize('Stop loss')}</span>
                            </label>
                            {stop_loss && <Stepper value={sl_amount} onChange={setSlAmount} ctl={sl_ctl} label='Stop loss' />}
                            <label className='dtm__check'>
                                <input
                                    type='checkbox'
                                    checked={deal_cancel}
                                    onChange={e => {
                                        setDealCancel(e.target.checked);
                                        if (e.target.checked) setStopLoss(false);
                                    }}
                                />
                                <span>{localize('Deal cancellation')}</span>
                            </label>
                        </div>
                    )}
                </>
            )}

            {type.equals && (
                <label className='dtm__row dtm__check'>
                    <input type='checkbox' checked={equals} onChange={e => setEquals(e.target.checked)} />
                    <span>{localize('Allow equals')}</span>
                </label>
            )}

            <div className='dtm__buys'>
                {(type.kind === 'dual' || type.kind === 'mult') && <div className='dtm__pair'>{[0, 1].map(unitBtn)}</div>}
                {(type.kind === 'accu' || type.kind === 'single') && (
                    <button type='button' className='dtm__buy' disabled={!stake_ok} onClick={() => buy(type.kind === 'accu' ? 0 : side)}>
                        <em>{type.kind === 'accu' ? '📈' : side ? '↘' : '↗'}</em>
                        {type.kind === 'accu' ? localize('Buy') : localize(type.sides[side].label)}
                    </button>
                )}
            </div>
            {(error || quote_err) && <p className='dtrader__error'>{error || quote_err}</p>}
        </aside>
    );

    return (
        <div ref={root_ref} dir='ltr' className={classNames('dtrader', { 'dtrader--digit': type.dur === 'ticks', 'dtrader--sheet': sheet_mode, 'dtrader--dm': digit_phone })}>
            {/* ---------- open positions ---------- */}
            <aside className={classNames('dtrader__positions', { 'dtrader__positions--closed': !pos_open, 'dtrader__positions--empty': trades.length === 0 })}>
                <div className='dtrader__positions-head'>
                    <strong>{localize('Open positions')}</strong>
                    <button type='button' onClick={() => setPosOpen(o => !o)} aria-label={localize('Toggle open positions')}>
                        {pos_open ? '−' : '+'}
                    </button>
                </div>
                {pos_open &&
                    (trades.length === 0 ? (
                        <div className='dtrader__empty'>
                            <svg width='48' height='48' viewBox='0 0 24 24' fill='none' stroke='#9aa4a6' strokeWidth='1.5'>
                                <rect x='3' y='7' width='18' height='13' rx='2' />
                                <path d='M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18' />
                            </svg>
                            <p>{localize('You have no open positions.')}</p>
                        </div>
                    ) : (
                        <div className='dtrader__poslist'>
                            {trades.map(t => (
                                <div key={t.id} className={`dtrader__pos dtrader__pos--${t.status}`}>
                                    <span>
                                        <strong>{t.label}</strong>
                                        <small>{t.market}</small>
                                    </span>
                                    <span className='dtrader__pos-pl'>
                                        {t.status === 'open' && t.profit === null
                                            ? localize('Open…')
                                            : `${t.profit > 0 ? '+' : ''}${Number(t.profit).toFixed(2)} ${currency}`}
                                        <small>{t.status === 'open' ? localize('Running') : t.status === 'won' ? localize('Won') : localize('Lost')}</small>
                                    </span>
                                </div>
                            ))}
                            <div className='dtrader__postotal'>
                                <span>
                                    {open_count} {localize('open')}
                                </span>
                                <span className={classNames({ win: total > 0, loss: total < 0 })}>
                                    {total > 0 ? '+' : ''}
                                    {total.toFixed(2)} {currency}
                                </span>
                                <button type='button' onClick={() => setTrades(p => p.filter(t => t.status === 'open'))}>
                                    {localize('Clear')}
                                </button>
                            </div>
                        </div>
                    ))}
            </aside>

            {/* ---------- chart ---------- */}
            <section className='dtrader__center'>
                <div className='dtrader__plot'>
                    {show_chart && (
                        <div className='dtrader__chart dtrader__chart--smart'>
                            <ChartWrapper prefix='dtrader-chart' show_digits_stats={false} barriers={chart_barriers} />
                        </div>
                    )}

                    {digit_phone && digit_view === 'digits' && (
                        <>
                            <button type='button' className='dtrader__swap dtrader__swap--l' onClick={() => setDigitView('chart')} aria-label={localize('Show chart')}>
                                «
                            </button>
                            <button type='button' className='dtrader__swap dtrader__swap--r' onClick={() => setDigitView('chart')} aria-label={localize('Show chart')}>
                                »
                            </button>
                        </>
                    )}
                    {digit_phone && digit_view === 'chart' && (
                        <button type='button' className='dtrader__swap dtrader__swap--back' onClick={() => setDigitView('digits')}>
                            « {localize('Digits')}
                        </button>
                    )}

                    {show_circles && (
                        <div className='dtrader__circles' role='group' aria-label={localize('Last digit statistics')}>
                            {DIGITS.map(d => {
                                const is_hi = has_data && pct[d] === hi;
                                const is_lo = has_data && pct[d] === lo;
                                return (
                                    <button
                                        key={d}
                                        type='button'
                                        disabled={!type.pick || d < type.pick[0] || d > type.pick[1]}
                                        onClick={() => type.pick && setDigit(d)}
                                        style={{ ['--deg' as any]: `${Math.min(340, pct[d] * 18)}deg` }}
                                        className={classNames('dtrader__circle', {
                                            'dtrader__circle--high': is_hi,
                                            'dtrader__circle--low': is_lo && !is_hi,
                                            'dtrader__circle--picked': !!type.pick && digit === d,
                                            'dtrader__circle--last': last_digit === d,
                                        })}
                                    >
                                        <span className='dtrader__digit'>{d}</span>
                                        <span className='dtrader__pct'>{has_data ? `${pct[d].toFixed(1)}%` : '—'}</span>
                                        {last_digit === d && <i className='dtrader__pointer' />}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div className='dtrader__foot'>
                    <span className={classNames('dtrader__dot', { on: feed_status === localize('Live') })} />
                    <span>{last_tick ? `${new Date(last_tick.epoch * 1000).toISOString().replace('T', ' ').slice(0, 19)} GMT` : feed_status}</span>
                </div>
            </section>

            {/* ---------- trade panel ---------- */}
            {sheet_mode ? mobile_sheet : (
            <aside className='dtrader__panel'>
                <a className='dtrader__learn'>{localize('Learn about this trade type')}</a>
                <button type='button' className='dtrader__typebtn' onClick={() => setShowTypes(s => !s)}>
                    <span className='dtrader__chev2'>{show_types ? '›' : '‹'}</span>
                    <Icons t={type} />
                    <strong>{type.label}</strong>
                </button>

                {show_types && (is_mobile ? createPortal(trade_types_modal, document.body) : trade_types_modal)}

                {/* sides (single Buy button types) */}
                {type.kind === 'single' && (
                    <div className='dtrader__seg'>
                        {type.sides.map((s, i) => (
                            <button
                                key={s.ct}
                                type='button'
                                className={classNames({ active: side === i })}
                                onClick={() => {
                                    setSide(i);
                                    if (type.key === 'turbos') {
                                        const v = Math.abs(Number(barrier_txt) || 7.04).toFixed(2);
                                        setBarrierTxt(i === 0 ? `-${v}` : `+${v}`);
                                    }
                                }}
                            >
                                {localize(s.label)}
                            </button>
                        ))}
                    </div>
                )}

                {type.kind === 'accu' && (
                    <div className='dtrader__card'>
                        <div className='dtrader__label'>{localize('Growth rate')}</div>
                        <div className='dtrader__growth'>
                            {[1, 2, 3, 4, 5].map(g => (
                                <button key={g} type='button' className={classNames({ active: growth === g })} onClick={() => setGrowth(g)}>
                                    {g}%
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {type.kind === 'mult' && (
                    <div className='dtrader__card'>
                        <div className='dtrader__label'>{localize('Multiplier')}</div>
                        <select className='dtrader__select' value={mult_i} onChange={e => setMultI(Number(e.target.value))}>
                            {market.mult.map((m, i) => (
                                <option key={m} value={i}>
                                    x{m}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {type.dur === 'time' && (
                    <>
                        <div className='dtrader__card'>
                            <div className='dtrader__seg dtrader__seg--flat'>
                                <button type='button' className='active'>{localize('Duration')}</button>
                                <button type='button' disabled>{localize('End time')}</button>
                            </div>
                            <select className='dtrader__select' value={dur_unit} onChange={e => setDurUnit(e.target.value)}>
                                {UNITS.map(u => (
                                    <option key={u.u} value={u.u}>
                                        {localize(u.label)}
                                    </option>
                                ))}
                            </select>
                            <Stepper value={dur_val} onChange={setDurVal} ctl={dur_ctl} label='Duration' />
                            <small className='dtrader__range'>
                                {localize('Range')}: {type.min_min || 1} - {UNITS.find(u => u.u === dur_unit)?.max} {localize(UNITS.find(u => u.u === dur_unit)?.label.toLowerCase())}
                            </small>
                        </div>
                        {type.bar && (
                            <div className='dtrader__card'>
                                <div className='dtrader__label'>
                                    {type.bar === 'strike' ? localize('Strike price') : type.bar === 'turbo' ? localize('Barrier') : localize('Barrier')}
                                </div>
                                <div className='dtrader__barrier'>
                                    {type.bar === 'strike' && <span>{localize('Spot')}</span>}
                                    <input value={barrier_txt} onChange={e => setBarrierTxt(e.target.value)} />
                                </div>
                                {type.bar === 'turbo' && q0?.ok && (
                                    <div className='dtrader__ppp'>
                                        {localize('Payout per point')}
                                        <strong>{q0.contract_details?.payout_per_point ?? q0.payout} {currency}</strong>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}

                {is_digit && !is_mobile && (
                    <div className='dtrader__card'>
                        <div className='dtrader__label'>{localize('Ticks')}</div>
                        <input type='range' min={1} max={10} step={1} value={ticks_dur} onChange={e => setTicksDur(Number(e.target.value))} className='dtrader__slider' />
                        <div className='dtrader__ticks-val'>{ticks_dur} {ticks_dur === 1 ? localize('Tick') : localize('Ticks')}</div>
                    </div>
                )}

                {type.pick && (
                    <div className='dtrader__card dtrader__card--digits'>
                        <div className='dtrader__label'>{localize('Last Digit Prediction')}</div>
                        <div className='dtrader__digits'>
                            {DIGITS.map(d => (
                                <button
                                    key={d}
                                    type='button'
                                    disabled={d < type.pick[0] || d > type.pick[1]}
                                    className={classNames({ active: digit === d })}
                                    onClick={() => setDigit(d)}
                                >
                                    {d}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* compact row on phones for digit trades */}
                {is_digit && is_mobile && (
                    <div className='dtrader__crow'>
                        <select value={ticks_dur} onChange={e => setTicksDur(Number(e.target.value))}>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                                <option key={n} value={n}>
                                    {n} {n === 1 ? localize('tick') : localize('ticks')}
                                </option>
                            ))}
                        </select>
                        <span className='dtrader__amt'>
                            <input type='number' inputMode='decimal' value={stake} onChange={e => setStake(e.target.value)} />
                            <small>{currency}</small>
                        </span>
                        <button type='button' onClick={() => setBasis(b => (b === 'stake' ? 'payout' : 'stake'))}>
                            {basis === 'stake' ? localize('Stake') : localize('Payout')}
                        </button>
                    </div>
                )}

                {/* stake */}
                {!(is_digit && is_mobile) && (
                <div className='dtrader__card'>
                    {type.basis ? (
                        <div className='dtrader__seg dtrader__seg--flat'>
                            <button type='button' className={classNames({ active: basis === 'stake' })} onClick={() => setBasis('stake')}>
                                {localize('Stake')}
                            </button>
                            <button type='button' className={classNames({ active: basis === 'payout' })} onClick={() => setBasis('payout')}>
                                {localize('Payout')}
                            </button>
                        </div>
                    ) : (
                        <div className='dtrader__label'>{localize('Stake')}</div>
                    )}
                    <Stepper value={stake} onChange={setStake} ctl={stake_ctl} label='Stake' />
                    {type.kind === 'mult' && q0?.ok && (
                        <div className='dtrader__mini'>
                            <span>
                                {localize('Commission')}
                                <u>{money(q0.commission ?? 0)} {currency}</u>
                            </span>
                            <span>
                                {localize('Stop out')}
                                <u>{q0.limit_order?.stop_out?.order_amount !== undefined ? `${money(Math.abs(q0.limit_order.stop_out.order_amount))} ${currency}` : '—'}</u>
                            </span>
                        </div>
                    )}
                    {type.equals && (
                        <label className='dtrader__check'>
                            <input type='checkbox' checked={equals} onChange={e => setEquals(e.target.checked)} />
                            {localize('Allow equals')}
                        </label>
                    )}
                </div>
                )}

                {(type.kind === 'accu' || type.kind === 'mult') && (
                    <div className='dtrader__card dtrader__card--tight'>
                        <label className='dtrader__check'>
                            <input type='checkbox' checked={take_profit} onChange={e => setTakeProfit(e.target.checked)} />
                            {localize('Take profit')}
                        </label>
                        {take_profit && <Stepper value={tp_amount} onChange={setTpAmount} ctl={tp_ctl} label='Take profit' />}
                        {type.kind === 'mult' && (
                            <>
                                <label className='dtrader__check'>
                                    <input
                                        type='checkbox'
                                        checked={stop_loss}
                                        onChange={e => {
                                            setStopLoss(e.target.checked);
                                            if (e.target.checked) setDealCancel(false);
                                        }}
                                    />
                                    {localize('Stop loss')}
                                </label>
                                {stop_loss && <Stepper value={sl_amount} onChange={setSlAmount} ctl={sl_ctl} label='Stop loss' />}
                                <label className='dtrader__check'>
                                    <input
                                        type='checkbox'
                                        checked={deal_cancel}
                                        onChange={e => {
                                            setDealCancel(e.target.checked);
                                            if (e.target.checked) setStopLoss(false);
                                        }}
                                    />
                                    {localize('Deal cancellation')}
                                </label>
                            </>
                        )}
                        {type.kind === 'accu' && q0?.ok && (
                            <div className='dtrader__maxes'>
                                <div>
                                    <span>{localize('Max. payout')}</span>
                                    <u>{money(cd0.maximum_payout ?? q0.payout ?? 0)} {currency}</u>
                                </div>
                                <div>
                                    <span>{localize('Max. ticks')}</span>
                                    <u>{cd0.maximum_ticks ?? '—'} {localize('ticks')}</u>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* buy buttons */}
                <div className='dtrader__buys'>
                    {type.kind === 'dual' && !is_mobile && [0, 1].map(renderDualButton)}
                    {type.kind === 'dual' && is_mobile && <div className='dtrader__mbuy'>{[0, 1].map(renderMobileDual)}</div>}
                    {type.kind === 'mult' &&
                        [0, 1].map(i => (
                            <button key={i} type='button' className={`dtrader__buy dtrader__buy--${i ? 'b' : 'a'} dtrader__buy--wide`} disabled={!stake_ok} onClick={() => buy(i)}>
                                <span>
                                    <em>{i ? '↘' : '↗'}</em>
                                    {localize(type.sides[i].label)}
                                </span>
                                <b>{money(stake_n || 0)} {currency}</b>
                            </button>
                        ))}
                    {(type.kind === 'accu' || type.kind === 'single') && (
                        <button type='button' className='dtrader__buy dtrader__buy--a dtrader__buy--wide' disabled={!stake_ok} onClick={() => buy(type.kind === 'accu' ? 0 : side)}>
                            <span>
                                <em>{type.kind === 'accu' ? '📈' : side ? '↘' : '↗'}</em>
                                {localize('Buy')}
                            </span>
                            <b>{quotes[0]?.ok && quotes[0].ask_price ? `${money(quotes[0].ask_price)} ${currency}` : ''}</b>
                        </button>
                    )}
                </div>
                {(error || quote_err) && <p className='dtrader__error'>{error || quote_err}</p>}
            </aside>
            )}
        </div>
    );
});

export default DTrader;
