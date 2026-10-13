// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
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
const MAX_TICKS = 5000;
const SETTLE_TIMEOUT_MS = 60000;

const errMsg = (e: any) => e?.error?.message || e?.message || localize('Something went wrong');
const toDigit = (quote: number | string, dp: number) => Number(Number(quote).toFixed(dp).slice(-1));
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

type TLog = { id: number; time: string; label: string; stake: number; profit?: number };

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

const BulkTrader = observer(() => {
    const { client } = useStore();
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
    const [manual_on, setManualOn] = useState(true);
    const [auto_on, setAutoOn] = useState(false);
    const [martingale, setMartingale] = useState(false);
    const [multiplier, setMultiplier] = useState<number>(2);
    const [current_stake, setCurrentStake] = useState<number>(1);

    const [digits, setDigits] = useState<number[]>([]);
    const [last_quote, setLastQuote] = useState<string>('');
    const [feed_error, setFeedError] = useState('');
    const [retry, setRetry] = useState(0);

    const [busy, setBusy] = useState(false);
    const [auto_running, setAutoRunning] = useState(false);
    const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
    const [log, setLog] = useState<TLog[]>([]);

    const root_ref = useRef<HTMLDivElement>(null);
    const dp_ref = useRef<number>(MARKETS[0].dp);
    const sub_id = useRef('');
    const stop_ref = useRef(false);
    const waiters = useRef<Map<number, (profit: number) => void>>(new Map());
    const settled = useRef<Set<number>>(new Set());
    const own = useRef<Set<number>>(new Set());
    const live = useRef<any>({});
    live.current = { stake, current_stake, martingale, multiplier };

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
            try {
                const res = await api_base.api.send({
                    ticks_history: market,
                    adjust_start_time: 1,
                    count: ticks_count,
                    end: 'latest',
                    style: 'ticks',
                });
                if (cancelled) return;
                if (res?.pip_size !== undefined) dp_ref.current = Number(res.pip_size);
                const prices = res?.history?.prices || [];
                setDigits(prices.map((p: number) => toDigit(p, dp_ref.current)).slice(-ticks_count));
                if (prices.length) setLastQuote(Number(prices[prices.length - 1]).toFixed(dp_ref.current));
            } catch (e) {
                if (!cancelled) setFeedError(errMsg(e));
                return;
            }

            msg_sub = api_base.api.onMessage().subscribe(({ data }: any) => {
                if (data?.msg_type !== 'tick' || data.tick?.symbol !== market) return;
                if (data.tick.pip_size !== undefined) dp_ref.current = Number(data.tick.pip_size);
                const dp = dp_ref.current;
                setLastQuote(Number(data.tick.quote).toFixed(dp));
                setDigits(prev => [...prev, toDigit(data.tick.quote, dp)].slice(-ticks_count));
            });

            try {
                const res = await api_base.api.send({ ticks: market, subscribe: 1 });
                sub_id.current = res?.subscription?.id || '';
            } catch (e) {
                // AlreadySubscribed: the stream is already flowing through onMessage
                if (e?.error?.code !== 'AlreadySubscribed' && !cancelled) setFeedError(errMsg(e));
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
        setLog(prev => prev.map(l => (l.id === c.contract_id ? { ...l, profit } : l)));
        const { martingale: m, multiplier: mult, stake: base } = live.current;
        if (m) {
            if (profit < 0) {
                live.current.current_stake = round2(live.current.current_stake * Math.max(1, mult));
            } else {
                live.current.current_stake = base;
            }
            setCurrentStake(live.current.current_stake);
        }
        waiters.current.get(c.contract_id)?.(profit);
        waiters.current.delete(c.contract_id);
    }, []);

    // Push messages from the shared connection
    useEffect(() => {
        if (!api_base.api) return;
        const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data?.msg_type === 'proposal_open_contract') settleContract(data.proposal_open_contract);
        });
        return () => sub.unsubscribe();
    }, [retry, settleContract]);

    // Poll one contract until it is sold (same one-shot request the bot engine uses)
    const trackContract = useCallback(
        async (cid: number) => {
            const started = Date.now();
            while (!settled.current.has(cid) && Date.now() - started < SETTLE_TIMEOUT_MS) {
                await new Promise(r => setTimeout(r, 1500));
                try {
                    const res = await api_base.api.send({ proposal_open_contract: 1, contract_id: cid });
                    settleContract(res?.proposal_open_contract);
                } catch (e) {
                    // try again on the next round
                }
            }
        },
        [settleContract]
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
    const buyOne = async (side: { key: string; label: string; barrier: boolean }) => {
        const amount = live.current.current_stake;
        const req: Record<string, any> = {
            proposal: 1,
            amount,
            basis: 'stake',
            contract_type: side.key,
            currency,
            symbol: market,
            duration: clamp(Math.round(duration) || 1, 1, 10),
            duration_unit: 't',
        };
        if (side.barrier) req.barrier = String(prediction);
        const prop = await api_base.api.send(req);
        const { id, ask_price } = prop.proposal;
        const res = await api_base.api.send({ buy: id, price: Number(ask_price) });
        const cid = res.buy.contract_id;
        own.current.add(cid);
        setLog(prev =>
            [
                {
                    id: cid,
                    time: new Date().toLocaleTimeString(),
                    label: `${market_def.name} · ${side.label}`,
                    stake: Number(res.buy.buy_price),
                },
                ...prev,
            ].slice(0, 30)
        );
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

    const fire = async (side: { key: string; label: string; barrier: boolean }) => {
        if (!is_logged_in) {
            setMessage({ type: 'error', text: localize('Please log in to trade.') });
            return;
        }
        if (!manual_on && !auto_on) {
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
        try {
            if (auto_on) {
                // Automated: keep buying this side, one contract after another, until done or stopped
                setAutoRunning(true);
                let done = 0;
                for (let i = 0; i < count && !stop_ref.current; i++) {
                    const cid = await buyOne(side);
                    done += 1;
                    await waitForResult(cid);
                }
                setMessage({ type: 'ok', text: `${localize('Automated run finished:')} ${done} ${localize('trade(s).')}` });
            } else {
                // Manual: fire all contracts straight away
                setBusy(true);
                for (let i = 0; i < count; i++) await buyOne(side);
                setMessage({ type: 'ok', text: localize('Contract(s) purchased.') });
            }
        } catch (e) {
            setMessage({ type: 'error', text: errMsg(e) });
        } finally {
            setBusy(false);
            setAutoRunning(false);
        }
    };

    const scrollToTop = () => root_ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const total_pl = log.reduce((a, l) => a + (l.profit ?? 0), 0);

    return (
        <div className='bulk' ref={root_ref}>
            <div className='bulk__grid'>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Market')}</label>
                    <select className='bulk__select bulk__select--market' value={market} onChange={e => setMarket(e.target.value)}>
                        {MARKETS.map(m => (
                            <option key={m.symbol} value={m.symbol}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Trade type')}</label>
                    <select className='bulk__select' value={trade_type} onChange={e => setTradeType(e.target.value)}>
                        {TRADE_TYPES.map(t => (
                            <option key={t.key} value={t.key}>
                                {t.label}
                            </option>
                        ))}
                    </select>
                </div>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Number of ticks')}</label>
                    <input
                        className='bulk__input'
                        type='number'
                        min={20}
                        max={MAX_TICKS}
                        value={ticks_input}
                        onChange={e => setTicksInput(Number(e.target.value))}
                    />
                </div>
                {type_def.has_prediction && (
                    <div className='bulk__field'>
                        <label className='bulk__label'>{localize('Prediction')}</label>
                        <input
                            className='bulk__input'
                            type='number'
                            min={trade_type === 'over_under' ? 1 : 0}
                            max={trade_type === 'over_under' ? 8 : 9}
                            value={prediction}
                            onChange={e =>
                                setPrediction(
                                    clamp(
                                        Math.round(Number(e.target.value) || 0),
                                        trade_type === 'over_under' ? 1 : 0,
                                        trade_type === 'over_under' ? 8 : 9
                                    )
                                )
                            }
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
                    <input
                        className='bulk__input'
                        type='number'
                        min={0.35}
                        step='0.01'
                        value={stake}
                        onChange={e => setStake(Number(e.target.value))}
                    />
                </div>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('No of trades')}</label>
                    <input
                        className='bulk__input'
                        type='number'
                        min={1}
                        max={50}
                        value={trades}
                        onChange={e => setTrades(clamp(Math.round(Number(e.target.value) || 1), 1, 50))}
                    />
                </div>
                <div className='bulk__field'>
                    <label className='bulk__label'>{localize('Ticks')}</label>
                    <input
                        className='bulk__input'
                        type='number'
                        min={1}
                        max={10}
                        value={duration}
                        onChange={e => setDuration(clamp(Math.round(Number(e.target.value) || 1), 1, 10))}
                    />
                </div>
            </div>

            <div className='bulk__modes'>
                <label className='bulk__check'>
                    <input type='checkbox' checked={manual_on} onChange={e => setManualOn(e.target.checked)} />
                    {localize('Manual')}
                </label>
                <label className='bulk__check'>
                    <input type='checkbox' checked={auto_on} onChange={e => setAutoOn(e.target.checked)} />
                    {localize('Automated')}
                </label>
            </div>
            <p className='bulk__hint'>
                {auto_on
                    ? `${localize('Click a side button to start: it buys that side one contract after another,')} ${trades} ${localize('in total, or until you press Stop.')}`
                    : manual_on
                      ? `${localize('Click a side button to fire')} ${trades} ${trades === 1 ? localize('contract') : localize('contracts')} ${localize('instantly')}`
                      : localize('Tick Manual or Automated to trade.')}
            </p>

            <div className='bulk__sides'>
                {sides.map((s, i) => (
                    <button
                        type='button'
                        key={s.key}
                        className={classNames('bulk__side', i === 0 ? 'bulk__side--left' : 'bulk__side--right')}
                        disabled={busy || auto_running}
                        onClick={() => fire(s)}
                    >
                        <span className='bulk__side-top'>{s.label}</span>
                        <span className='bulk__side-bottom'>{digits.length ? `${sidePct(i).toFixed(1)}%` : '—'}</span>
                    </button>
                ))}
            </div>

            {auto_running && (
                <button type='button' className='bulk__stop' onClick={() => (stop_ref.current = true)}>
                    {localize('Stop')}
                </button>
            )}

            <label className='bulk__check bulk__check--martingale'>
                <input type='checkbox' checked={martingale} onChange={e => setMartingale(e.target.checked)} />
                {localize('Enable martingale')}
            </label>
            {martingale && (
                <div className='bulk__grid bulk__grid--three'>
                    <div className='bulk__field'>
                        <label className='bulk__label'>{localize('Martingale multiplier')}</label>
                        <input
                            className='bulk__input'
                            type='number'
                            min={1}
                            step='0.1'
                            value={multiplier}
                            onChange={e => setMultiplier(Number(e.target.value))}
                        />
                    </div>
                    <div className='bulk__field'>
                        <label className='bulk__label'>{localize('Next stake')}</label>
                        <div className='bulk__static'>
                            {current_stake.toFixed(2)} {currency}
                        </div>
                    </div>
                </div>
            )}

            {!is_logged_in && <p className='bulk__muted'>{localize('Log in to place trades.')}</p>}
            {message && <p className={message.type === 'ok' ? 'bulk__good' : 'bulk__bad'}>{message.text}</p>}

            {log.length > 0 && (
                <div className='bulk__log'>
                    <div className='bulk__log-head'>
                        <strong>{localize('Recent trades')}</strong>
                        <span className={total_pl >= 0 ? 'bulk__good' : 'bulk__bad'}>
                            {localize('Total')}: {total_pl >= 0 ? '+' : ''}
                            {total_pl.toFixed(2)} {currency}
                        </span>
                    </div>
                    <table className='bulk__table'>
                        <tbody>
                            {log.map(l => (
                                <tr key={l.id}>
                                    <td>{l.time}</td>
                                    <td>{l.label}</td>
                                    <td>{l.stake.toFixed(2)}</td>
                                    <td className={l.profit === undefined ? '' : l.profit >= 0 ? 'bulk__good' : 'bulk__bad'}>
                                        {l.profit === undefined ? '…' : `${l.profit >= 0 ? '+' : ''}${l.profit.toFixed(2)}`}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <button type='button' className='bulk__top' onClick={scrollToTop} aria-label={localize('Back to top')}>
                ↑
            </button>
            <p className='bulk__attribution'>{localize('Live markets provided by Deriv')}</p>
        </div>
    );
});

export default BulkTrader;
