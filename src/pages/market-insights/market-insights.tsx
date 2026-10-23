// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { OVER1_WINDOWS, useOverOneStrategy } from './over-one-strategy';
import './market-insights.scss';

// Deriv's 10 volatility indices (dp = default decimals; the API's pip_size overrides it)
const MARKETS = [
    { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index', dp: 2, v: 10, s1: true },
    { symbol: 'R_10', name: 'Volatility 10 Index', dp: 3, v: 10 },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index', dp: 2, v: 25, s1: true },
    { symbol: 'R_25', name: 'Volatility 25 Index', dp: 3, v: 25 },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index', dp: 2, v: 50, s1: true },
    { symbol: 'R_50', name: 'Volatility 50 Index', dp: 4, v: 50 },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index', dp: 2, v: 75, s1: true },
    { symbol: 'R_75', name: 'Volatility 75 Index', dp: 4, v: 75 },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index', dp: 2, v: 100, s1: true },
    { symbol: 'R_100', name: 'Volatility 100 Index', dp: 2, v: 100 },
];

// Strategies offered in the "Select strategy" box (more are added here as they are built)
const STRATEGIES = [
    { key: 'over_under', label: 'Over & Under' },
    { key: 'even_odd', label: 'Even & Odd' },
    { key: 'matches_differs', label: 'Matches & Differs' },
    { key: 'rise_fall', label: 'Rise & Fall' },
];

// Scrolling "terminal" text that fills the page behind the box
const LOG_PHRASES = [
    '[WARNING] Analysing Volatility Index...',
    '[SUCCESS] Data transmission complete...',
    '[INFO] Connecting...',
    'Every Man Market Insights...',
    'Any moment, the story can change...',
    'Easy is the only way I do anything.',
    'I have to win...',
    'What if I tell you we are hitting take profit...',
    '[INFO] Predicting next digit...',
    '[SECURITY] Authenticating API key...',
    '[INFO] Compiling results...',
];
const buildLogLines = (count: number) => {
    let seed = 7;
    const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    return Array.from({ length: count }, () => {
        let line = '';
        while (line.length < 900) line += `${LOG_PHRASES[Math.floor(rnd() * LOG_PHRASES.length)]} `;
        return line;
    });
};

const lastDigitOf = (quote: number, dp: number) => Number(quote.toFixed(dp).slice(-1));

const MarketInsights = observer(() => {
    const { client, transactions, run_panel, summary_card } = useStore();
    const [strategy, setStrategy] = useState(STRATEGIES[0].key);
    const [symbol, setSymbol] = useState('1HZ100V');
    const [stake, setStake] = useState<string>('0.35');
    const [duration, setDuration] = useState<string>('10');
    const [stoploss, setStoploss] = useState<string>('1000');
    const [take_profit, setTakeProfit] = useState<string>('50');
    const [martingale, setMartingale] = useState(true);
    const [multiplier, setMultiplier] = useState<string>('2');
    const [max_trades, setMaxTrades] = useState<string>('200');
    const [fast_mode, setFastMode] = useState(false);
    const [scope, setScope] = useState<'one' | 'all'>('all');
    const [auto_trade, setAutoTrade] = useState(true);

    const [tick, setTick] = useState<number | null>(null);
    const [dp, setDp] = useState(2);
    const [digit, setDigit] = useState<number | null>(null);
    const [try_n, setTryN] = useState(0);

    const market = MARKETS.find(m => m.symbol === symbol) || MARKETS[0];
    const over_one = useOverOneStrategy(MARKETS, {
        stake: Number(stake) || 0.35,
        duration: Number(duration) || 1,
        martingale,
        multiplier: Number(multiplier) || 2,
        stop_loss: Number(stoploss) || 0,
        take_profit: Number(take_profit) || 0,
        max_trades: Number(max_trades) || 0,
        auto_trade,
        fast_mode,
        currency: client?.currency || 'USD',
        is_logged_in: !!client?.is_logged_in,
        transactions,
        run_panel,
        summary_card,
    });
    const is_over_under = strategy === 'over_under';
    const over_rows = Object.values(over_one.rows).sort((a, b) => b.score - a.score);
    const best_symbol = over_rows[0] && over_rows[0].score > -Infinity ? over_rows[0].symbol : '';
    // analysing all volatilities: the Select market box follows the market the analysis picked
    // (the one being traded, otherwise the best one so far)
    const picked_symbol = over_one.traded || best_symbol;
    useEffect(() => {
        if (is_over_under && scope === 'all' && over_one.running && picked_symbol) setSymbol(picked_symbol);
    }, [is_over_under, scope, over_one.running, picked_symbol]);
    const show_all = is_over_under && scope === 'all' && !(over_one.running && picked_symbol);
    const onAnalyse = () => {
        if (!is_over_under) return;
        if (over_one.running) over_one.stop();
        else over_one.start(scope === 'all' ? MARKETS.map(m => m.symbol) : [symbol]);
    };
    const log_lines = useMemo(() => buildLogLines(90), []);
    const root_ref = useRef<HTMLDivElement>(null);

    // Phones: size the page to exactly the space between its top and the Run bar, so the box scrolls
    // inside it and nothing hides under the bar.
    useLayoutEffect(() => {
        const el = root_ref.current;
        if (!el) return;
        const mq = window.matchMedia('(max-width: 760px)');
        const fit = () => {
            if (!mq.matches) {
                el.style.removeProperty('height');
                return;
            }
            const top = el.getBoundingClientRect().top;
            const bar = document.querySelector('.controls__section, .run-panel__footer') as HTMLElement | null;
            const r = bar?.getBoundingClientRect();
            const bar_top = r && r.height > 0 && r.top > top ? r.top : window.innerHeight;
            el.style.height = `${Math.max(280, Math.floor(Math.min(window.innerHeight, bar_top) - top))}px`;
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
    }, []);

    // ---- live latest tick + last digit ----
    useEffect(() => {
        if (!api_base.api) {
            const retry = setTimeout(() => setTryN(n => n + 1), 700);
            return () => clearTimeout(retry);
        }
        let cancelled = false;
        let sub_id = '';
        let pip = market.dp;
        setTick(null);
        setDigit(null);
        setDp(pip);

        const show = (q: number) => {
            setTick(q);
            setDigit(lastDigitOf(q, pip));
        };

        const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data?.msg_type !== 'tick' || data.tick?.symbol !== symbol) return;
            if (data.tick.pip_size !== undefined && Number(data.tick.pip_size) !== pip) {
                pip = Number(data.tick.pip_size);
                setDp(pip);
            }
            show(Number(data.tick.quote));
        });

        (async () => {
            try {
                const res = await api_base.api.send({ ticks_history: symbol, count: 1, end: 'latest', style: 'ticks' });
                if (!cancelled && res?.pip_size !== undefined) {
                    pip = Number(res.pip_size);
                    setDp(pip);
                }
                const last = res?.history?.prices?.slice(-1)[0];
                if (!cancelled && last !== undefined) show(Number(last));
            } catch (e) {
                /* the live stream below fills it in */
            }
            try {
                const r = await api_base.api.send({ ticks: symbol, subscribe: 1 });
                sub_id = r?.subscription?.id || '';
                if (cancelled && sub_id) api_base.api.send({ forget: sub_id }).catch(() => {});
            } catch (e) {
                // already subscribed elsewhere on this connection: ticks still arrive through onMessage
            }
        })();

        return () => {
            cancelled = true;
            sub.unsubscribe();
            if (sub_id && api_base.api) api_base.api.send({ forget: sub_id }).catch(() => {});
        };
    }, [symbol, try_n]);

    return (
        <div className='mi' ref={root_ref}>
            <div className='mi__log' aria-hidden='true'>
                {log_lines.map((l, i) => (
                    <p key={i} className={i % 2 ? 'mi__log-r' : ''}>
                        {l}
                    </p>
                ))}
            </div>
            <div className='mi__scroll'>
            <div className='mi__core'>
                <h2 className='mi__title'>{localize('DYNAMIC SIGNAL CORE')}</h2>

                <label className='mi__label' htmlFor='mi-strategy'>
                    {localize('SELECT STRATEGY')}
                </label>
                <div className='mi__select'>
                    <select id='mi-strategy' value={strategy} onChange={e => setStrategy(e.target.value)}>
                        {STRATEGIES.map(s => (
                            <option key={s.key} value={s.key}>
                                {localize(s.label)}
                            </option>
                        ))}
                    </select>
                </div>

                <label className='mi__label' htmlFor='mi-market'>
                    {localize('SELECT MARKET')}
                </label>
                <div className='mi__select mi__select--market'>
                    <span className='mi__badge' aria-hidden='true'>
                        {show_all ? <b className='mi__badge-all'>ALL</b> : <b>{market.v}</b>}
                        {!show_all && market.s1 && <i>1s</i>}
                    </span>
                    <select
                        id='mi-market'
                        value={is_over_under && scope === 'all' ? 'ALL' : symbol}
                        disabled={is_over_under && scope === 'all' && over_one.running}
                        onChange={e => {
                            if (e.target.value === 'ALL') setScope('all');
                            else {
                                setScope('one');
                                setSymbol(e.target.value);
                            }
                        }}
                    >
                        {is_over_under && <option value='ALL'>{localize('Analyse all volatilities')}</option>}
                        {MARKETS.map(m => (
                            <option key={m.symbol} value={m.symbol}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                </div>
                {is_over_under && scope === 'all' && over_one.running && picked_symbol && (
                    <p className='mi__picked'>
                        {over_one.traded ? localize('Trading:') : localize('Best so far:')} {market.name}
                    </p>
                )}

                <div className='mi__tick'>
                    <p>
                        <span>{localize('Latest Tick:')}</span> <strong>{tick === null ? '—' : tick.toFixed(dp)}</strong>
                    </p>
                    <p>
                        <span>{localize('Last Digit:')}</span> <strong>{digit === null ? '—' : digit}</strong>
                    </p>
                </div>

                <div className='mi__config'>
                    <h3>{localize('TRADE CONFIGURATION')}</h3>
                    <label htmlFor='mi-stake'>{localize('Stake')}</label>
                    <input id='mi-stake' type='number' inputMode='decimal' min='0.35' step='0.01' value={stake} onChange={e => setStake(e.target.value)} />
                    <label htmlFor='mi-duration'>{localize('Duration (ticks)')}</label>
                    <input id='mi-duration' type='number' inputMode='numeric' min='1' max='10' step='1' value={duration} onChange={e => setDuration(e.target.value)} />
                    <label htmlFor='mi-stoploss'>{localize('Stoploss')}</label>
                    <input id='mi-stoploss' type='number' inputMode='decimal' min='0' step='1' value={stoploss} onChange={e => setStoploss(e.target.value)} />
                    <label htmlFor='mi-tp'>{localize('Take profit')}</label>
                    <input id='mi-tp' type='number' inputMode='decimal' min='0' step='1' value={take_profit} onChange={e => setTakeProfit(e.target.value)} />

                    <label className='mi__check' htmlFor='mi-martingale'>
                        <input id='mi-martingale' type='checkbox' checked={martingale} onChange={e => setMartingale(e.target.checked)} />
                        <span className='mi__box' aria-hidden='true' />
                        <span>{localize('Enable martingale on loss')}</span>
                    </label>

                    <label htmlFor='mi-mult'>{localize('Martingale multiplier')}</label>
                    <input id='mi-mult' type='number' inputMode='decimal' min='1' step='0.1' value={multiplier} onChange={e => setMultiplier(e.target.value)} />
                    <label htmlFor='mi-max'>{localize('Max trades per signal')}</label>
                    <input id='mi-max' type='number' inputMode='numeric' min='1' step='1' value={max_trades} onChange={e => setMaxTrades(e.target.value)} />

                    {is_over_under && (
                        <label className='mi__check' htmlFor='mi-auto'>
                            <input id='mi-auto' type='checkbox' checked={auto_trade} onChange={e => setAutoTrade(e.target.checked)} />
                            <span className='mi__box' aria-hidden='true' />
                            <span>{localize('Auto-place Over 1 on a signal')}</span>
                        </label>
                    )}

                    <div className='mi__mode'>
                        <span className={fast_mode ? '' : 'on'}>{localize('NORMAL MODE')}</span>
                        <button type='button' role='switch' aria-checked={fast_mode} aria-label={localize('Fast mode')} className={fast_mode ? 'mi__switch mi__switch--on' : 'mi__switch'} onClick={() => setFastMode(f => !f)}>
                            <i />
                        </button>
                        <span className={fast_mode ? 'on' : ''}>{localize('FAST MODE')}</span>
                    </div>
                    {/* more trade configuration fields continue here */}
                </div>

                <button type='button' className='mi__analyse' onClick={onAnalyse}>
                    {over_one.running ? localize('Stop') : localize('Analyse')}
                </button>

                {is_over_under && (over_one.running || over_rows.length > 0 || over_one.error) && (
                    <div className='mi__over1'>
                        <h3>{localize('OVER 1 STRATEGY')}</h3>
                        <p className='mi__over1-rule'>
                            {localize('Digits 2-9 share:')}{' '}
                            {OVER1_WINDOWS.map(w => `${w.ticks} ticks > ${w.min}%`).join(' · ')}
                        </p>
                        {over_one.status && <p className='mi__over1-status'>{over_one.status}</p>}
                        {over_one.error && <p className='mi__over1-error'>{over_one.error}</p>}
                        {over_rows.length > 0 && (
                            <div className='mi__over1-table'>
                                <div className='mi__over1-row mi__over1-row--head'>
                                    <span>{localize('Market')}</span>
                                    {OVER1_WINDOWS.map(w => (
                                        <span key={w.ticks}>{w.ticks}</span>
                                    ))}
                                </div>
                                {over_rows.map(r => (
                                    <div key={r.symbol} className={`mi__over1-row${r.signal ? ' mi__over1-row--signal' : ''}`}>
                                        <span>
                                            {MARKETS.find(m => m.symbol === r.symbol)?.name.replace(' Index', '')}
                                            {r.symbol === best_symbol && scope === 'all' && <b className='mi__over1-best'>{localize('BEST')}</b>}
                                        </span>
                                        {r.pct.map((p, i) => (
                                            <span key={i} className={r.hit[i] ? 'mi__over1-hit' : ''}>
                                                {p === null ? '—' : `${p.toFixed(1)}%`}
                                            </span>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
            </div>
        </div>
    );
});

export default MarketInsights;
