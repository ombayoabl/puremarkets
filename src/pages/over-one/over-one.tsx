// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { batch_lanes, MAX_EXTRA_LANES } from '../bulk-trader/batch-sockets';
import { Check, NumInput } from '../bulk-trader/bulk-trader';
import '../bulk-trader/bulk-trader.scss';

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
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// Trade Over 1 on the first volatility whose digit percentages reach all of these levels
const RULES = [
    { digit: 0, min: 10.2 },
    { digit: 1, min: 9 },
    { digit: 8, min: 9.2 },
    { digit: 9, min: 9.2 },
];
const MAX_TICKS = 5000;
const SETTLE_TIMEOUT_MS = 60000;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const toDigit = (quote: number | string, dp: number) => Number(Number(quote).toFixed(dp).slice(-1));
const errMsg = (e: any) => e?.error?.message || e?.message || localize('Something went wrong');
const digitPercents = (list: number[]) => {
    const counts = Array(10).fill(0);
    list.forEach(d => (counts[d] += 1));
    const total = list.length || 1;
    return counts.map(n => (n / total) * 100);
};
// compared the way they are shown (1 decimal), so a box that reads 9.2% counts as 9.2%
const meets = (pct: number[]) => RULES.every(r => Number(pct[r.digit].toFixed(1)) >= r.min);

const OverOne = observer(() => {
    const { client, transactions } = useStore();
    const currency = client?.currency || 'USD';
    const is_logged_in = !!client?.is_logged_in;

    const [stake, setStake] = useState<number>(1);
    const [trades, setTrades] = useState<number>(1);
    const [duration, setDuration] = useState<number>(1);
    const [ticks_input, setTicksInput] = useState<number>(1000);
    const [ticks_count, setTicksCount] = useState<number>(1000);
    const [auto_trade, setAutoTrade] = useState(true);

    const [scanning, setScanning] = useState(false);
    const [scan_pct, setScanPct] = useState<Record<string, number[]>>({});
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [result, setResult] = useState('');
    const [, setRetry] = useState(0);

    const cfg = useRef<any>({});
    cfg.current = { stake, trades, duration, auto_trade, currency, is_logged_in, transactions };

    // debounce the "number of ticks" box
    useEffect(() => {
        const t = setTimeout(() => setTicksCount(clamp(Math.round(Number(ticks_input) || 1000), 20, MAX_TICKS)), 600);
        return () => clearTimeout(t);
    }, [ticks_input]);

    // Follow a contract until it is sold; feeds the Summary / Transactions panel and the result line
    const trackContract = useCallback(async (cid: number, done: (profit: number | null) => void) => {
        const started = Date.now();
        while (Date.now() - started < SETTLE_TIMEOUT_MS) {
            await new Promise(r => setTimeout(r, 1500));
            try {
                const res = await api_base.api.send({ proposal_open_contract: 1, contract_id: cid });
                const c = res?.proposal_open_contract;
                if (!c) continue;
                try {
                    cfg.current.transactions?.onBotContractEvent?.(c);
                } catch (e) {
                    // the side panel is optional
                }
                if (c.is_sold) return done(Number(c.profit));
            } catch (e) {
                // try again on the next round
            }
        }
        done(null);
    }, []);

    // Fire the whole batch of Over 1 contracts at the same moment (one connection each)
    const fireOver1 = useCallback(
        async (symbol: string) => {
            const { stake: amount, trades: n, duration: ticks, currency: cur } = cfg.current;
            const count = clamp(Math.round(n) || 1, 1, 50);
            const buyOne = async (lane: number) => {
                const parameters = {
                    amount,
                    basis: 'stake',
                    contract_type: 'DIGITOVER',
                    barrier: '1',
                    currency: cur,
                    duration: clamp(Math.round(ticks) || 1, 1, 10),
                    duration_unit: 't',
                    underlying_symbol: symbol,
                };
                const res = await batch_lanes.send(lane, { buy: '1', price: Number(amount), parameters }, request =>
                    api_base.api.send(request)
                );
                return res.buy.contract_id as number;
            };
            const results = await Promise.allSettled(Array.from({ length: count }, (_, i) => buyOne(i)));
            const ids = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value as number);
            const first_error = (results.find(r => r.status === 'rejected') as any)?.reason;
            if (first_error) setError(errMsg(first_error));
            if (!ids.length) return;
            setResult(`${localize('Placed')} ${ids.length} × Over 1 ${localize('on')} ${MARKETS.find(m => m.symbol === symbol)?.name}`);
            let pending = ids.length;
            let total = 0;
            ids.forEach(id =>
                trackContract(id, profit => {
                    pending -= 1;
                    if (profit !== null) total += profit;
                    if (pending <= 0) {
                        setResult(`${localize('Result:')} ${total >= 0 ? '+' : ''}${total.toFixed(2)} ${cfg.current.currency}`);
                    }
                })
            );
        },
        [trackContract]
    );

    // ---- scan all 10 volatilities, trade the first one that meets the rule ----
    useEffect(() => {
        if (!scanning) return;
        if (!api_base.api) {
            setStatus(localize('Connecting to live markets…'));
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
        setStatus(localize('Analysing the volatilities…'));
        if (cfg.current.auto_trade) batch_lanes.warm(Math.min(clamp(Math.round(cfg.current.trades) || 1, 1, 50) - 1, MAX_EXTRA_LANES));

        const check = () => {
            if (fired || cancelled || !loaded_all) return;
            const hit = MARKETS.find(m => pct_now[m.symbol] && meets(pct_now[m.symbol]));
            if (!hit) return;
            fired = true;
            setScanning(false);
            if (!cfg.current.auto_trade) {
                setStatus(`${localize('Signal found on')} ${hit.name}. ${localize('Auto trade is off, so no trade was placed.')}`);
                return;
            }
            setStatus(`${localize('Signal found on')} ${hit.name}. ${localize('Placing Over 1…')}`);
            fireOver1(hit.symbol);
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
                        // already streamed by the chart or another page: read the history, ticks still reach us
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
                setStatus(`${localize('Analysing the volatilities…')} ${i + 1}/${MARKETS.length}`);
            }
            if (cancelled) return;
            loaded_all = true;
            setStatus(
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
            // let other pages (Bulk Trader digits feed) pick their own stream up again
            if (own_subs.length) setRetry(r => r + 1);
        };
    }, [scanning, ticks_count, fireOver1]);

    const startScan = () => {
        if (auto_trade && !is_logged_in) {
            setError(localize('Please log in to trade.'));
            return;
        }
        if (auto_trade && !(stake >= 0.35)) {
            setError(localize('Minimum stake is 0.35.'));
            return;
        }
        setError('');
        setResult('');
        setScanning(true);
    };

    const stopScan = () => {
        setScanning(false);
        setStatus(localize('Stopped.'));
    };

    return (
        <div className='bulk'>
            <p className='bulk__hint'>
                {`${localize('Run scans all 10 volatilities and trades Over 1 on the first one where')} ${RULES.map(r => `${r.digit} ≥ ${r.min}%`).join(', ')}. ${localize('It stops after it trades.')}`}
            </p>

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
            <div className='bulk__grid'>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Number of ticks to analyse')}</label>
                    <NumInput value={ticks_input} onChange={setTicksInput} min={20} max={MAX_TICKS} integer fallback={1000} />
                </div>
            </div>

            <div className='bulk__modes'>
                <Check checked={auto_trade} onChange={() => setAutoTrade(v => !v)} label={localize('Auto trade after a signal')} />
            </div>

            <button
                type='button'
                className={classNames('bulk__run', { 'bulk__run--stop': scanning })}
                onClick={scanning ? stopScan : startScan}
            >
                {scanning ? localize('Stop') : localize('Run')}
            </button>
            {status && <p className='bulk__muted'>{status}</p>}
            {result && <p className='bulk__good'>{result}</p>}
            {error && <p className='bulk__bad'>{error}</p>}

            <div className='bulk__scan-list'>
                {MARKETS.map(m => {
                    const pct = scan_pct[m.symbol];
                    const ok = !!pct && meets(pct);
                    return (
                        <div key={m.symbol} className={classNames('bulk__scan-row', { 'bulk__scan-row--hit': ok })}>
                            <div className='bulk__scan-name'>
                                {m.name}
                                {ok ? '  ✓' : ''}
                            </div>
                            <div className='bulk__scan-cells'>
                                {DIGITS.map(d => {
                                    const rule = RULES.find(r => r.digit === d);
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
    );
});

export default OverOne;
