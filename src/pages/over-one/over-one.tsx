// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import LimitPopup, { LimitKind } from '@/components/limit-popup/limit-popup';
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
const round2 = (n: number) => Math.round(n * 100) / 100;
const OVER1 = { key: 'DIGITOVER', digit: 1, label: 'Over 1' };
// digits Deriv accepts for the recovery contract
const REC_RANGE: Record<string, [number, number]> = { over: [0, 8], under: [1, 9] };
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
    const [take_profit, setTakeProfit] = useState<number>(0);
    const [stop_loss, setStopLoss] = useState<number>(0);
    const [rec_on, setRecOn] = useState(false);
    const [rec_type, setRecType] = useState<'over' | 'under'>('over');
    const [rec_digit, setRecDigit] = useState<number>(5);
    const [multiplier, setMultiplier] = useState<number>(2);
    const [duration, setDuration] = useState<number>(1);
    const [ticks_input, setTicksInput] = useState<number>(1000);
    const [ticks_count, setTicksCount] = useState<number>(1000);
    const [auto_trade, setAutoTrade] = useState(true);

    const [scanning, setScanning] = useState(false);
    const [trading, setTrading] = useState(false);
    const [pl, setPl] = useState<{ n: number; total: number } | null>(null);
    const [scan_pct, setScanPct] = useState<Record<string, number[]>>({});
    const [status, setStatus] = useState('');
    const [limit, setLimit] = useState<LimitKind>(null);
    const [error, setError] = useState('');
    const [, setRetry] = useState(0);

    const cfg = useRef<any>({});
    const run_id = useRef(0);
    const audio = useRef<any>(null);
    const cancel_wait = useRef<(() => void) | null>(null);
    cfg.current = {
        stake,
        duration,
        auto_trade,
        currency,
        is_logged_in,
        transactions,
        take_profit,
        stop_loss,
        rec_on,
        rec_type,
        rec_digit,
        multiplier,
    };

    // ---- sound (made with the browser's own audio, no files) ----
    const unlockAudio = () => {
        try {
            if (!audio.current) {
                const AC = window.AudioContext || (window as any).webkitAudioContext;
                if (AC) audio.current = new AC();
            }
            audio.current?.resume?.();
        } catch (e) {
            // no sound available
        }
    };
    const tone = useCallback((freq: number, dur: number, vol: number, delay = 0) => {
        const ctx = audio.current;
        if (!ctx) return;
        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const t0 = ctx.currentTime + delay;
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t0);
            osc.stop(t0 + dur + 0.02);
        } catch (e) {
            // no sound available
        }
    }, []);

    // A soft, machine-like "beep beep" that loops (3.2 seconds long) while scanning. It plays on
    // the audio clock and needs no timer, so it keeps going when you switch to another tab or app.
    useEffect(() => {
        if (!scanning) return;
        const ctx = audio.current;
        if (!ctx) return;
        let src: any = null;
        try {
            const rate = ctx.sampleRate;
            const buf = ctx.createBuffer(1, Math.floor(rate * 3.2), rate);
            const data = buf.getChannelData(0);
            const FREQ = 1100;
            const BEEP = 0.07; // seconds
            const edge = Math.floor(rate * 0.008); // short fade in/out so it does not click
            // a pair of beeps every 0.8 seconds
            for (let k = 0; k < 4; k++) {
                [0, 0.15].forEach(offset => {
                    const from = Math.floor(rate * (k * 0.8 + offset));
                    const n = Math.floor(rate * BEEP);
                    for (let i = 0; i < n; i++) {
                        const t = (2 * Math.PI * FREQ * i) / rate;
                        // a square-ish tone (odd harmonics) is what gives it the machine character
                        const wave = Math.sin(t) + Math.sin(3 * t) / 3 + Math.sin(5 * t) / 5;
                        const env = Math.min(1, i / edge, (n - i) / edge);
                        data[from + i] = wave * env * 0.18;
                    }
                });
            }
            src = ctx.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            const soften = ctx.createBiquadFilter(); // rounds off the harsh highs
            soften.type = 'lowpass';
            soften.frequency.value = 2600;
            const gain = ctx.createGain();
            gain.gain.value = 0.5; // soft
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

    // debounce the "number of ticks" box
    useEffect(() => {
        const t = setTimeout(() => setTicksCount(clamp(Math.round(Number(ticks_input) || 1000), 20, MAX_TICKS)), 600);
        return () => clearTimeout(t);
    }, [ticks_input]);

    // Wait until one contract is sold (pushed updates, with a slow poll as a safety net)
    const waitForResult = useCallback(
        (cid: number, my_run: number) =>
            new Promise<number | null>(resolve => {
                let done = false;
                let sub_id = '';
                const finish = (v: number | null) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    clearInterval(poll);
                    msg.unsubscribe();
                    cancel_wait.current = null;
                    if (sub_id) api_base.api.send({ forget: sub_id }).catch(() => {});
                    resolve(v);
                };
                const handle = (poc: any) => {
                    if (done || !poc || poc.contract_id !== cid) return;
                    try {
                        cfg.current.transactions?.onBotContractEvent?.(poc);
                    } catch (e) {
                        // the side panel is optional
                    }
                    if (poc.is_sold) finish(Number(poc.profit));
                };
                const msg = api_base.api.onMessage().subscribe(({ data }: any) => {
                    if (data?.msg_type === 'proposal_open_contract') handle(data.proposal_open_contract);
                });
                const timer = setTimeout(() => finish(null), SETTLE_TIMEOUT_MS);
                const poll = setInterval(() => {
                    if (run_id.current !== my_run) return finish(null);
                    api_base.api
                        .send({ proposal_open_contract: 1, contract_id: cid })
                        .then((r: any) => handle(r?.proposal_open_contract))
                        .catch(() => {});
                }, 3000);
                cancel_wait.current = () => finish(null);
                api_base.api
                    .send({ proposal_open_contract: 1, contract_id: cid, subscribe: 1 })
                    .then((r: any) => {
                        sub_id = r?.subscription?.id || '';
                        if (done && sub_id) api_base.api.send({ forget: sub_id }).catch(() => {});
                        handle(r?.proposal_open_contract);
                    })
                    .catch(() => {});
            }),
        []
    );

    // Trade one contract at a time on `symbol`: Over 1, or the recovery contract after a loss,
    // until Stop is pressed or take profit / stop loss is reached
    const runTrades = useCallback(
        async (symbol: string) => {
            run_id.current += 1;
            const my_run = run_id.current;
            const name = MARKETS.find(m => m.symbol === symbol)?.name || symbol;
            let total = 0;
            let n = 0;
            let losses = 0; // losses in a row
            setPl({ n: 0, total: 0 });
            setTrading(true);
            try {
                while (run_id.current === my_run) {
                    const c = cfg.current;
                    const recovering = c.rec_on && losses > 0;
                    const [lo, hi] = REC_RANGE[c.rec_type];
                    const rec_digit_ok = clamp(Math.round(c.rec_digit) || lo, lo, hi);
                    const key = recovering ? (c.rec_type === 'under' ? 'DIGITUNDER' : 'DIGITOVER') : OVER1.key;
                    const barrier = recovering ? rec_digit_ok : OVER1.digit;
                    const label = recovering ? `${c.rec_type === 'under' ? 'Under' : 'Over'} ${barrier}` : OVER1.label;
                    const amount = recovering ? round2(c.stake * Math.pow(Math.max(1, c.multiplier), losses)) : c.stake;
                    setStatus(`${localize('Trading')} ${name}: ${label}, ${localize('stake')} ${amount} ${c.currency}…`);

                    let cid: number;
                    try {
                        const res = await api_base.api.send({
                            buy: '1',
                            price: Number(amount),
                            parameters: {
                                amount,
                                basis: 'stake',
                                contract_type: key,
                                barrier: String(barrier),
                                currency: c.currency,
                                duration: clamp(Math.round(c.duration) || 1, 1, 10),
                                duration_unit: 't',
                                underlying_symbol: symbol,
                            },
                        });
                        cid = res.buy.contract_id;
                    } catch (e) {
                        if (run_id.current === my_run) setError(errMsg(e));
                        break;
                    }
                    const profit = await waitForResult(cid, my_run);
                    if (run_id.current !== my_run) break;
                    if (profit === null) {
                        setError(localize('Could not confirm the result of the last trade, so trading stopped.'));
                        break;
                    }
                    total = round2(total + profit);
                    n += 1;
                    setPl({ n, total });
                    losses = profit < 0 ? losses + 1 : 0;

                    if (c.take_profit > 0 && total >= c.take_profit) {
                        setStatus(`${localize('Take profit reached. Trading stopped.')}`);
                        setLimit('tp');
                        break;
                    }
                    if (c.stop_loss > 0 && total <= -c.stop_loss) {
                        setStatus(`${localize('Stop loss reached. Trading stopped.')}`);
                        setLimit('sl');
                        break;
                    }
                }
            } finally {
                if (run_id.current === my_run) setTrading(false);
            }
        },
        [waitForResult]
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

        const check = () => {
            if (fired || cancelled || !loaded_all) return;
            const hit = MARKETS.find(m => pct_now[m.symbol] && meets(pct_now[m.symbol]));
            if (!hit) return;
            fired = true;
            setScanning(false);
            // signal found: three soft rising beeps
            tone(880, 0.16, 0.1);
            tone(1100, 0.16, 0.1, 0.2);
            tone(1320, 0.28, 0.1, 0.4);
            if (!cfg.current.auto_trade) {
                setStatus(`${localize('Signal found on')} ${hit.name}. ${localize('Auto trade is off, so no trade was placed.')}`);
                return;
            }
            setStatus(`${localize('Signal found on')} ${hit.name}. ${localize('Placing Over 1…')}`);
            runTrades(hit.symbol);
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
    }, [scanning, ticks_count, runTrades, tone]);

    const startScan = () => {
        unlockAudio(); // browsers only allow sound after a click
        if (auto_trade && !is_logged_in) {
            setError(localize('Please log in to trade.'));
            return;
        }
        if (auto_trade && !(stake >= 0.35)) {
            setError(localize('Minimum stake is 0.35.'));
            return;
        }
        setError('');
        setPl(null);
        setScanning(true);
    };

    const stopAll = () => {
        run_id.current += 1; // ends the trading loop
        cancel_wait.current?.();
        setScanning(false);
        setTrading(false);
        setStatus(localize('Stopped.'));
    };

    // leaving the tab ends any trading
    useEffect(
        () => () => {
            run_id.current += 1;
            cancel_wait.current?.();
            audio.current?.close?.();
        },
        []
    );

    const active = scanning || trading;

    return (
        <div className='bulk'>
            <LimitPopup kind={limit} onClose={() => setLimit(null)} />
            <p className='bulk__hint'>
                {`${localize('Run scans all 10 volatilities and, on the first one where')} ${RULES.map(r => `${r.digit} ≥ ${r.min}%`).join(', ')}, ${localize('trades Over 1 one trade at a time until you press Stop or your take profit / stop loss is reached.')}`}
            </p>

            <div className='bulk__grid bulk__grid--three'>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Stake')}</label>
                    <NumInput value={stake} onChange={setStake} min={0.35} max={100000} fallback={1} />
                </div>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Ticks')}</label>
                    <NumInput value={duration} onChange={setDuration} min={1} max={10} integer fallback={1} />
                </div>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Ticks to analyse')}</label>
                    <NumInput value={ticks_input} onChange={setTicksInput} min={20} max={MAX_TICKS} integer fallback={1000} />
                </div>
            </div>
            <div className='bulk__grid'>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Take profit (0 = off)')}</label>
                    <NumInput value={take_profit} onChange={setTakeProfit} min={0} max={1000000} fallback={0} />
                </div>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Stop loss (0 = off)')}</label>
                    <NumInput value={stop_loss} onChange={setStopLoss} min={0} max={1000000} fallback={0} />
                </div>
            </div>

            <div className='bulk__modes'>
                <Check checked={auto_trade} onChange={() => setAutoTrade(v => !v)} label={localize('Auto trade after a signal')} />
            </div>

            <div className='bulk__martingale'>
                <Check checked={rec_on} onChange={() => setRecOn(v => !v)} label={localize('Recovery mode (after a loss)')} />
                {rec_on && (
                    <>
                        <div className='bulk__modes'>
                            <Check
                                checked={rec_type === 'over'}
                                onChange={() => {
                                    setRecType('over');
                                    setRecDigit(d => clamp(d, REC_RANGE.over[0], REC_RANGE.over[1]));
                                }}
                                label={localize('Recover with Over')}
                            />
                            <Check
                                checked={rec_type === 'under'}
                                onChange={() => {
                                    setRecType('under');
                                    setRecDigit(d => clamp(d, REC_RANGE.under[0], REC_RANGE.under[1]));
                                }}
                                label={localize('Recover with Under')}
                            />
                        </div>
                        <div className='bulk__martingale-fields'>
                            <div className='bulk__field'>
                                <label className='bulk__label'>{localize('Recovery prediction')}</label>
                                <NumInput
                                    value={rec_digit}
                                    onChange={setRecDigit}
                                    min={REC_RANGE[rec_type][0]}
                                    max={REC_RANGE[rec_type][1]}
                                    integer
                                    fallback={5}
                                />
                            </div>
                            <div className='bulk__field'>
                                <label className='bulk__label'>{localize('Stake multiplier after a loss')}</label>
                                <NumInput value={multiplier} onChange={setMultiplier} min={1} max={100} fallback={2} />
                            </div>
                        </div>
                    </>
                )}
            </div>

            <button
                type='button'
                className={classNames('bulk__run', { 'bulk__run--stop': active })}
                onClick={active ? stopAll : startScan}
            >
                {active ? localize('Stop') : localize('Run')}
            </button>
            {status && <p className='bulk__muted'>{status}</p>}
            {pl && (
                <p className={pl.total >= 0 ? 'bulk__good' : 'bulk__bad'}>
                    {`${pl.n} ${localize('trades')} · ${localize('Profit/Loss')} ${pl.total >= 0 ? '+' : ''}${pl.total.toFixed(2)} ${currency}`}
                </p>
            )}
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
