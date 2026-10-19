// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import './dtrader.scss';

// Manual trading (DTrader style): pick a market and a trade type, watch the last-digit circles
// live, then buy by hand. Uses the same Deriv connection as the other pages.

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

// barrier: 'digit' = the player picks a digit by tapping a circle, with the allowed range
const TYPES = [
    {
        key: 'overunder',
        label: 'Over/Under',
        barrier: true,
        min_ticks: 1,
        a: { ct: 'DIGITOVER', label: 'Over', range: [0, 8] },
        b: { ct: 'DIGITUNDER', label: 'Under', range: [1, 9] },
    },
    {
        key: 'matchdiffer',
        label: 'Matches/Differs',
        barrier: true,
        min_ticks: 1,
        a: { ct: 'DIGITMATCH', label: 'Matches', range: [0, 9] },
        b: { ct: 'DIGITDIFF', label: 'Differs', range: [0, 9] },
    },
    {
        key: 'evenodd',
        label: 'Even/Odd',
        barrier: false,
        min_ticks: 1,
        a: { ct: 'DIGITEVEN', label: 'Even' },
        b: { ct: 'DIGITODD', label: 'Odd' },
    },
    {
        key: 'risefall',
        label: 'Rise/Fall',
        barrier: false,
        min_ticks: 5,
        a: { ct: 'CALL', label: 'Rise' },
        b: { ct: 'PUT', label: 'Fall' },
    },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const toDigit = (quote: number | string, dp: number) => Number(Number(quote).toFixed(dp).slice(-1));
const errMsg = (e: any) => e?.error?.message || e?.message || localize('Something went wrong');
const percents = (list: number[]) => {
    const counts = Array(10).fill(0);
    list.forEach(d => (counts[d] += 1));
    const total = list.length || 1;
    return counts.map(n => (n / total) * 100);
};

const DTrader = observer(() => {
    const { client } = useStore();
    const currency = client?.currency || 'USD';
    const is_logged_in = !!client?.is_logged_in;

    const [symbol, setSymbol] = useState(MARKETS[0].symbol);
    const [type_key, setTypeKey] = useState('overunder');
    const [barrier, setBarrier] = useState(5);
    const [stake, setStake] = useState<number | string>(1);
    const [duration, setDuration] = useState<number | string>(1);
    const [ticks_count, setTicksCount] = useState(1000);

    const [pct, setPct] = useState<number[]>(Array(10).fill(0));
    const [last, setLast] = useState<{ quote: string; digit: number } | null>(null);
    const [feed_status, setFeedStatus] = useState(localize('Connecting…'));
    const [quotes, setQuotes] = useState<{ a?: any; b?: any }>({});
    const [trades, setTrades] = useState<any[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const sub_ids = useRef<Record<number, string>>({});

    const type = TYPES.find(t => t.key === type_key) || TYPES[0];
    const stake_n = Number(stake);
    const min_ticks = type.min_ticks;
    const duration_n = clamp(Math.round(Number(duration)) || min_ticks, min_ticks, 10);
    const stake_ok = stake_n >= 0.35;
    const name = MARKETS.find(m => m.symbol === symbol)?.name || symbol;

    // keep the barrier inside what both contracts of the chosen type accept
    useEffect(() => {
        if (!type.barrier) return;
        const lo = Math.max(type.a.range[0], type.b.range[0]);
        const hi = Math.min(type.a.range[1], type.b.range[1]);
        setBarrier(b => clamp(b, lo, hi));
    }, [type.key]);

    // keep the duration valid for the chosen type (Rise/Fall needs at least 5 ticks)
    useEffect(() => {
        setDuration(d => clamp(Math.round(Number(d)) || min_ticks, min_ticks, 10));
    }, [min_ticks]);

    // ---- live ticks for the circles ----
    useEffect(() => {
        if (!api_base.api) {
            setFeedStatus(localize('Not connected. Please refresh the page.'));
            return;
        }
        let cancelled = false;
        let sub_id = '';
        let buf: number[] = [];
        let dp = MARKETS.find(m => m.symbol === symbol)?.dp ?? 2;
        setPct(Array(10).fill(0));
        setLast(null);
        setFeedStatus(localize('Loading ticks…'));

        const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data?.msg_type !== 'tick' || data.tick?.symbol !== symbol) return;
            if (data.tick.pip_size !== undefined) dp = Number(data.tick.pip_size);
            const digit = toDigit(data.tick.quote, dp);
            buf.push(digit);
            if (buf.length > ticks_count) buf.shift();
            setPct(percents(buf));
            setLast({ quote: Number(data.tick.quote).toFixed(dp), digit });
        });

        const start = async () => {
            const base = {
                ticks_history: symbol,
                adjust_start_time: 1,
                count: ticks_count,
                end: 'latest',
                style: 'ticks',
            };
            try {
                let res;
                try {
                    res = await api_base.api.send({ ...base, subscribe: 1 });
                    sub_id = res?.subscription?.id || '';
                    if (cancelled && sub_id) api_base.api.send({ forget: sub_id }).catch(() => {});
                } catch (e) {
                    // already streamed by another page: read the history, live ticks still reach us
                    if (e?.error?.code !== 'AlreadySubscribed') throw e;
                    res = await api_base.api.send(base);
                }
                if (cancelled) return;
                if (res?.pip_size !== undefined) dp = Number(res.pip_size);
                const prices = res?.history?.prices || [];
                buf = prices.map((q: number) => toDigit(q, dp)).slice(-ticks_count);
                setPct(percents(buf));
                if (prices.length)
                    setLast({ quote: Number(prices[prices.length - 1]).toFixed(dp), digit: buf[buf.length - 1] });
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
    }, [symbol, ticks_count]);

    // ---- payout quotes for both buttons ----
    useEffect(() => {
        if (!api_base.api || !stake_ok) {
            setQuotes({});
            return;
        }
        let cancelled = false;
        const ask = async (side: any) => {
            try {
                const params: any = {
                    proposal: 1,
                    amount: stake_n,
                    basis: 'stake',
                    contract_type: side.ct,
                    currency,
                    duration: duration_n,
                    duration_unit: 't',
                    underlying_symbol: symbol,
                };
                if (type.barrier) params.barrier = String(barrier);
                const res = await api_base.api.send(params);
                return { payout: Number(res?.proposal?.payout) };
            } catch (e) {
                return { error: errMsg(e) };
            }
        };
        const timer = setTimeout(async () => {
            const [a, b] = await Promise.all([ask(type.a), ask(type.b)]);
            if (!cancelled) setQuotes({ a, b });
        }, 450);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [symbol, type.key, barrier, stake_n, duration_n, currency, stake_ok]);

    // ---- follow open trades until they are sold ----
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
        async (side: any) => {
            setError('');
            if (!is_logged_in) {
                setError(localize('Please log in to trade.'));
                return;
            }
            if (!stake_ok) {
                setError(localize('Minimum stake is 0.35.'));
                return;
            }
            setBusy(true);
            try {
                const parameters: any = {
                    amount: stake_n,
                    basis: 'stake',
                    contract_type: side.ct,
                    currency,
                    duration: duration_n,
                    duration_unit: 't',
                    underlying_symbol: symbol,
                };
                if (type.barrier) parameters.barrier = String(barrier);
                const res = await api_base.api.send({ buy: '1', price: stake_n, parameters });
                const id = res.buy.contract_id;
                setTrades(prev =>
                    [
                        {
                            id,
                            label: type.barrier ? `${side.label} ${barrier}` : side.label,
                            market: name,
                            stake: stake_n,
                            profit: null,
                            status: 'open',
                        },
                        ...prev,
                    ].slice(0, 30)
                );
                const r = await api_base.api.send({ proposal_open_contract: 1, contract_id: id, subscribe: 1 });
                if (r?.subscription?.id) sub_ids.current[id] = r.subscription.id;
            } catch (e) {
                setError(errMsg(e));
            }
            setBusy(false);
        },
        [is_logged_in, stake_ok, stake_n, currency, duration_n, symbol, type.key, barrier, name]
    );

    const hi = Math.max(...pct);
    const lo = Math.min(...pct);
    const has_data = pct.some(p => p > 0);
    const total = round2(trades.reduce((sum, t) => sum + (t.status !== 'open' && t.profit !== null ? t.profit : 0), 0));
    const closed = trades.filter(t => t.status !== 'open').length;

    const renderBuy = (side: any, quote: any, tone: 'a' | 'b') => (
        <button
            type='button'
            className={`dtrader__buy dtrader__buy--${tone}`}
            disabled={busy || !stake_ok}
            onClick={() => buy(side)}
        >
            <span className='dtrader__buy-name'>
                {localize(side.label)}
                {type.barrier ? ` ${barrier}` : ''}
            </span>
            <span className='dtrader__buy-payout'>
                {quote?.payout ? `${localize('Payout')} ${round2(quote.payout)} ${currency}` : quote?.error ? '—' : '…'}
            </span>
        </button>
    );

    return (
        <div className='dtrader'>
            <div className='dtrader__main'>
                <div className='dtrader__top'>
                    <select className='dtrader__select' value={symbol} onChange={e => setSymbol(e.target.value)}>
                        {MARKETS.map(m => (
                            <option key={m.symbol} value={m.symbol}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                    <div className='dtrader__price'>
                        <span className='dtrader__price-value'>{last?.quote ?? '—'}</span>
                        <span className='dtrader__feed'>{feed_status}</span>
                    </div>
                </div>

                <div className='dtrader__types'>
                    {TYPES.map(t => (
                        <button
                            key={t.key}
                            type='button'
                            className={classNames('dtrader__type', { 'dtrader__type--active': t.key === type_key })}
                            onClick={() => setTypeKey(t.key)}
                        >
                            {localize(t.label)}
                        </button>
                    ))}
                </div>

                <div className='dtrader__circles' role='group' aria-label={localize('Last digit statistics')}>
                    {DIGITS.map(d => {
                        const is_hi = has_data && pct[d] === hi;
                        const is_lo = has_data && pct[d] === lo;
                        const picks = type.barrier;
                        return (
                            <button
                                key={d}
                                type='button'
                                disabled={!picks}
                                onClick={() => {
                                    const lo_ok = Math.max(type.a.range[0], type.b.range[0]);
                                    const hi_ok = Math.min(type.a.range[1], type.b.range[1]);
                                    if (d >= lo_ok && d <= hi_ok) setBarrier(d);
                                }}
                                className={classNames('dtrader__circle', {
                                    'dtrader__circle--high': is_hi,
                                    'dtrader__circle--low': is_lo && !is_hi,
                                    'dtrader__circle--picked': picks && barrier === d,
                                })}
                            >
                                <span className='dtrader__pointer' aria-hidden='true'>
                                    {last?.digit === d ? '▼' : ''}
                                </span>
                                <span className='dtrader__digit'>{d}</span>
                                <span className='dtrader__pct'>{has_data ? `${pct[d].toFixed(1)}%` : '—'}</span>
                            </button>
                        );
                    })}
                </div>
                <p className='dtrader__hint'>
                    {type.barrier
                        ? localize(
                              'Tap a circle to choose your digit. Green = most often, red = least often. ▼ = last digit.'
                          )
                        : localize('Green = most often, red = least often. ▼ = last digit.')}
                </p>

                <div className='dtrader__form'>
                    <label className='dtrader__field'>
                        <span>
                            {localize('Stake')} ({currency})
                        </span>
                        <input
                            type='number'
                            inputMode='decimal'
                            min='0.35'
                            step='0.01'
                            value={stake}
                            onChange={e => setStake(e.target.value)}
                        />
                    </label>
                    <label className='dtrader__field'>
                        <span>{localize('Ticks')}</span>
                        <input
                            type='number'
                            inputMode='numeric'
                            min={min_ticks}
                            max='10'
                            step='1'
                            value={duration}
                            onChange={e => setDuration(e.target.value)}
                            onBlur={() => setDuration(duration_n)}
                        />
                    </label>
                    <label className='dtrader__field'>
                        <span>{localize('Analyse last')}</span>
                        <select value={ticks_count} onChange={e => setTicksCount(Number(e.target.value))}>
                            {[100, 250, 500, 1000, 2000, 5000].map(n => (
                                <option key={n} value={n}>
                                    {n} {localize('ticks')}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                <div className='dtrader__buys'>
                    {renderBuy(type.a, quotes.a, 'a')}
                    {renderBuy(type.b, quotes.b, 'b')}
                </div>
                {(error || quotes.a?.error) && <p className='dtrader__error'>{error || quotes.a?.error}</p>}
            </div>

            <div className='dtrader__trades'>
                <div className='dtrader__trades-head'>
                    <span>{localize('Trades')}</span>
                    <span className={classNames({ dtrader__win: total > 0, dtrader__loss: total < 0 })}>
                        {closed ? `${total > 0 ? '+' : ''}${total.toFixed(2)} ${currency}` : ''}
                    </span>
                </div>
                {trades.length === 0 ? (
                    <p className='dtrader__empty'>{localize('Your trades will appear here.')}</p>
                ) : (
                    trades.map(t => (
                        <div key={t.id} className={`dtrader__trade dtrader__trade--${t.status}`}>
                            <span className='dtrader__trade-main'>
                                <strong>{t.label}</strong>
                                <small>{t.market}</small>
                            </span>
                            <span className='dtrader__trade-result'>
                                {t.status === 'open'
                                    ? localize('Open…')
                                    : `${t.profit > 0 ? '+' : ''}${Number(t.profit).toFixed(2)} ${currency}`}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
});

export default DTrader;
