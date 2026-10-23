// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import React, { useEffect, useMemo, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { localize } from '@deriv-com/translations';
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
const STRATEGIES = [{ key: 'over_under', label: 'Over & Under' }];

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

const MarketInsights = () => {
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

    const [tick, setTick] = useState<number | null>(null);
    const [dp, setDp] = useState(2);
    const [digit, setDigit] = useState<number | null>(null);
    const [try_n, setTryN] = useState(0);

    const market = MARKETS.find(m => m.symbol === symbol) || MARKETS[0];
    const log_lines = useMemo(() => buildLogLines(90), []);

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
        <div className='mi'>
            <div className='mi__log' aria-hidden='true'>
                {log_lines.map((l, i) => (
                    <p key={i} className={i % 2 ? 'mi__log-r' : ''}>
                        {l}
                    </p>
                ))}
            </div>
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
                        <b>{market.v}</b>
                        {market.s1 && <i>1s</i>}
                    </span>
                    <select id='mi-market' value={symbol} onChange={e => setSymbol(e.target.value)}>
                        {MARKETS.map(m => (
                            <option key={m.symbol} value={m.symbol}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                </div>

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

                    <div className='mi__mode'>
                        <span className={fast_mode ? '' : 'on'}>{localize('NORMAL MODE')}</span>
                        <button type='button' role='switch' aria-checked={fast_mode} aria-label={localize('Fast mode')} className={fast_mode ? 'mi__switch mi__switch--on' : 'mi__switch'} onClick={() => setFastMode(f => !f)}>
                            <i />
                        </button>
                        <span className={fast_mode ? 'on' : ''}>{localize('FAST MODE')}</span>
                    </div>
                    {/* more trade configuration fields continue here */}
                </div>

                <button type='button' className='mi__analyse'>
                    {localize('Analyse')}
                </button>
            </div>
        </div>
    );
};

export default MarketInsights;
