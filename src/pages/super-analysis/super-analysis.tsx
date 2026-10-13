// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import React, { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import {
    clamp,
    DIGITS,
    digitPercents,
    getSignal,
    MARKETS,
    MIN_SIGNAL_TICKS,
    round2,
    STRATEGIES,
    streaks,
} from './analysis';
import { Check, MarketIcon, NumInput, SelectBox } from './controls';
import { errMsg, useTicks } from './use-ticks';
import './super-analysis.scss';

const SUB_TABS = [
    { key: 'signal', label: 'Signal' },
    { key: 'patterns', label: 'Tick Patterns' },
    { key: 'analyser', label: 'Tick Analyser' },
];

const SETTLE_TIMEOUT_MS = 60000;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const fmt = (n: number) => `${n.toFixed(1)}%`;

const MarketSelect = ({ market, onChange }: { market: string; onChange: (symbol: string) => void }) => {
    const def = MARKETS.find(m => m.symbol === market) || MARKETS[0];
    return (
        <SelectBox
            variant='triangle'
            value={market}
            label={def.name}
            icon={<MarketIcon name={def.name} />}
            onChange={e => onChange(e.target.value)}
        >
            {MARKETS.map(m => (
                <option key={m.symbol} value={m.symbol}>
                    {m.name}
                </option>
            ))}
        </SelectBox>
    );
};

const BarrierSelect = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => (
    <SelectBox value={value} label={String(value)} onChange={e => onChange(Number(e.target.value))}>
        {DIGITS.map(d => (
            <option key={d} value={d}>
                {d}
            </option>
        ))}
    </SelectBox>
);

/* ------------------------------------------------------------------ */
/* Signal                                                              */
/* ------------------------------------------------------------------ */

type TLogLine = { id: number; time: string; kind: string; text: string };

const SignalTab = observer(({ market, onMarket }: { market: string; onMarket: (s: string) => void }) => {
    const { client, transactions } = useStore();
    const currency = client?.currency || 'USD';
    const is_logged_in = !!client?.is_logged_in;
    const market_def = MARKETS.find(m => m.symbol === market) || MARKETS[0];

    const [strategy, setStrategy] = useState('over_under');
    const [auto, setAuto] = useState(false);
    const [stake, setStake] = useState<number>(1);
    const [duration, setDuration] = useState<number>(1);
    const [stoploss, setStoploss] = useState<number>(10);
    const [busy, setBusy] = useState(false);
    const [pnl, setPnl] = useState(0);
    const [record, setRecord] = useState({ won: 0, lost: 0 });
    const [log, setLog] = useState<TLogLine[]>([]);

    const { ticks, dp, error } = useTicks(market, market_def.dp, 100);
    const digits = useMemo(() => ticks.map(t => t.d), [ticks]);
    const last = ticks.length ? ticks[ticks.length - 1] : null;
    const signal = useMemo(() => getSignal(strategy, digits), [strategy, digits]);

    const alive = useRef(true);
    const busy_ref = useRef(false);
    const pnl_ref = useRef(0);
    const log_seq = useRef(0);
    const last_label = useRef<string | null>(null);
    const live = useRef<any>({});
    live.current = { auto, stake, duration, stoploss, market, currency };

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    const addLog = (kind: string, text: string) => {
        if (!alive.current) return;
        log_seq.current += 1;
        const entry = { id: log_seq.current, time: new Date().toLocaleTimeString(), kind, text };
        setLog(prev => [entry, ...prev].slice(0, 60));
    };

    // log what the analyser is watching
    useEffect(() => {
        last_label.current = null;
        const s_label = STRATEGIES.find(s => s.key === strategy)?.label;
        addLog('INFO', `Watching ${market_def.name} with the ${s_label} strategy`);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [market, strategy]);

    // log when a signal appears, changes or ends
    useEffect(() => {
        const label = signal?.label ?? null;
        if (label === last_label.current) return;
        const had_signal = last_label.current !== null;
        last_label.current = label;
        if (signal) addLog('SIGNAL', `${signal.label} (${signal.confidence.toFixed(0)}%): ${signal.reason}`);
        else if (had_signal) addLog('INFO', 'Signal ended');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signal]);

    const placeTrade = async (sig: any) => {
        const { stake: amount_raw, duration: dur, market: symbol, currency: cur } = live.current;
        const amount = round2(amount_raw);
        busy_ref.current = true;
        setBusy(true);
        const parameters: Record<string, any> = {
            amount,
            basis: 'stake',
            contract_type: sig.contract_type,
            currency: cur,
            duration: clamp(Math.round(dur) || 1, 1, 10),
            duration_unit: 't',
            underlying_symbol: symbol,
        };
        if (sig.barrier !== undefined) parameters.barrier = String(sig.barrier);
        try {
            const res = await api_base.api.send({ buy: '1', price: amount, parameters });
            const cid = res.buy.contract_id;
            addLog('TRADE', `Bought ${sig.label}, stake ${amount} ${cur}`);

            let contract: any = null;
            const started = Date.now();
            while (Date.now() - started < SETTLE_TIMEOUT_MS) {
                await sleep(1000);
                try {
                    const r = await api_base.api.send({ proposal_open_contract: 1, contract_id: cid });
                    contract = r?.proposal_open_contract;
                    try {
                        transactions?.onBotContractEvent?.(contract);
                    } catch (e) {
                        // the side panel is optional
                    }
                    if (contract?.is_sold) break;
                } catch (e) {
                    // try again on the next round
                }
            }

            if (contract?.is_sold) {
                const profit = Number(contract.profit);
                pnl_ref.current = round2(pnl_ref.current + profit);
                if (alive.current) {
                    setPnl(pnl_ref.current);
                    setRecord(r => (profit >= 0 ? { ...r, won: r.won + 1 } : { ...r, lost: r.lost + 1 }));
                }
                addLog(
                    profit >= 0 ? 'WIN' : 'LOSS',
                    `${sig.label} ${profit >= 0 ? 'won' : 'lost'} ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} ${cur}`
                );
                if (live.current.auto && pnl_ref.current <= -live.current.stoploss) {
                    live.current.auto = false;
                    if (alive.current) setAuto(false);
                    addLog('STOP', `Stoploss reached (${pnl_ref.current.toFixed(2)} ${cur}). Auto trade is off`);
                }
            } else {
                addLog('ERROR', `${sig.label}: no result after ${SETTLE_TIMEOUT_MS / 1000}s, check Transactions`);
            }
        } catch (e) {
            addLog('ERROR', errMsg(e));
        } finally {
            busy_ref.current = false;
            if (alive.current) setBusy(false);
        }
    };

    // a new tick came in: if there is a signal and auto trade is on, take it (one trade at a time)
    useEffect(() => {
        if (!signal || !live.current.auto || busy_ref.current || !is_logged_in) return;
        placeTrade(signal);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [last?.n]);

    const toggleAuto = () => {
        if (auto) {
            setAuto(false);
            addLog('INFO', 'Auto trade turned off');
            return;
        }
        if (!is_logged_in) {
            addLog('ERROR', 'Log in to a Deriv account to auto trade');
            return;
        }
        pnl_ref.current = 0;
        setPnl(0);
        setRecord({ won: 0, lost: 0 });
        setAuto(true);
        addLog('INFO', `Auto trade on: stake ${round2(stake)} ${currency}, ${duration} tick(s), stoploss ${stoploss}`);
    };

    const waiting = digits.length < MIN_SIGNAL_TICKS;

    return (
        <div className='sa__signal-page'>
            <div className='sa__card'>
                <h2 className='sa__title'>{localize('Signal Analyzer')}</h2>

                <label className='sa__label'>{localize('Select strategy')}</label>
                <SelectBox
                    accent
                    value={strategy}
                    label={STRATEGIES.find(s => s.key === strategy)?.label}
                    onChange={e => setStrategy(e.target.value)}
                >
                    {STRATEGIES.map(s => (
                        <option key={s.key} value={s.key}>
                            {s.label}
                        </option>
                    ))}
                </SelectBox>

                <label className='sa__label'>{localize('Select market')}</label>
                <MarketSelect market={market} onChange={onMarket} />

                <div className='sa__readout'>
                    <div>
                        {localize('Latest Tick')}: <strong>{last ? last.q.toFixed(dp) : '…'}</strong>
                    </div>
                    <div>
                        {localize('Last Digit')}: <strong>{last ? last.d : '…'}</strong>
                    </div>
                </div>

                <div
                    className={classNames('sa__signal', {
                        'sa__signal--on': !!signal,
                    })}
                    aria-live='polite'
                >
                    {error && !ticks.length ? (
                        <span>{error}</span>
                    ) : signal ? (
                        <>
                            <div className='sa__signal-head'>
                                <strong>{signal.label}</strong>
                                <span>{signal.confidence.toFixed(0)}%</span>
                            </div>
                            <small>{signal.reason}</small>
                        </>
                    ) : waiting ? (
                        <span>
                            {localize('Collecting ticks')}… {digits.length}/{MIN_SIGNAL_TICKS}
                        </span>
                    ) : (
                        <span>{localize('No signal right now. Watching the market…')}</span>
                    )}
                </div>

                <Check checked={auto} onChange={toggleAuto} label={localize('Auto trade after a signal')} />

                <div className='sa__rows'>
                    <div className='sa__row'>
                        <label>{localize('Stake')}</label>
                        <NumInput value={stake} onChange={setStake} min={0.35} max={10000} fallback={1} />
                    </div>
                    <div className='sa__row'>
                        <label>{localize('Duration (ticks)')}</label>
                        <NumInput value={duration} onChange={setDuration} min={1} max={10} integer fallback={1} />
                    </div>
                    <div className='sa__row'>
                        <label>{localize('Stoploss')}</label>
                        <NumInput value={stoploss} onChange={setStoploss} min={0.35} max={1000000} fallback={10} />
                    </div>
                </div>

                <div className='sa__session'>
                    <span>
                        {localize('Session P/L')}:{' '}
                        <strong className={pnl > 0 ? 'sa__good' : pnl < 0 ? 'sa__bad' : ''}>
                            {pnl > 0 ? '+' : ''}
                            {pnl.toFixed(2)} {currency}
                        </strong>
                    </span>
                    <span>
                        {localize('Won')} {record.won} · {localize('Lost')} {record.lost}
                    </span>
                    {busy && <span className='sa__muted'>{localize('Trade open…')}</span>}
                </div>

                <p className='sa__note'>
                    {localize(
                        'Signals describe what the last ticks have been doing. They cannot tell you the next tick, and trading can lose money.'
                    )}
                </p>
            </div>

            <div className='sa__log' aria-label='Activity log'>
                {log.map(line => (
                    <div key={line.id} className={`sa__log-line sa__log-line--${line.kind.toLowerCase()}`}>
                        <span className='sa__log-time'>{line.time}</span> [{line.kind}] {line.text}
                    </div>
                ))}
            </div>
        </div>
    );
});

/* ------------------------------------------------------------------ */
/* Tick Patterns                                                       */
/* ------------------------------------------------------------------ */

const PatternsTab = ({ market, onMarket }: { market: string; onMarket: (s: string) => void }) => {
    const market_def = MARKETS.find(m => m.symbol === market) || MARKETS[0];
    const [count, setCount] = useState(100);
    const [barrier, setBarrier] = useState(4);
    const { ticks, error } = useTicks(market, market_def.dp, count);
    const digits = useMemo(() => ticks.map(t => t.d), [ticks]);

    const rows = useMemo(() => {
        const eo = digits.map(d => (d % 2 === 0 ? 'E' : 'O'));
        const ou = digits.map(d => (d > barrier ? 'O' : d < barrier ? 'U' : '='));
        const rf = ticks.slice(1).map((t, i) => (t.q > ticks[i].q ? 'R' : t.q < ticks[i].q ? 'F' : '='));
        return [
            {
                key: 'eo',
                title: localize('Even / Odd'),
                seq: eo,
                names: { E: 'Even', O: 'Odd' },
                tone: { E: 'good', O: 'bad' },
            },
            {
                key: 'ou',
                title: `${localize('Over / Under')} ${barrier}`,
                seq: ou,
                names: { O: 'Over', U: 'Under', '=': 'Equal' },
                tone: { O: 'good', U: 'bad', '=': 'neutral' },
            },
            {
                key: 'rf',
                title: localize('Rise / Fall'),
                seq: rf,
                names: { R: 'Rise', F: 'Fall', '=': 'Flat' },
                tone: { R: 'good', F: 'bad', '=': 'neutral' },
            },
        ];
    }, [digits, ticks, barrier]);

    // most common 3-tick Even/Odd sequences in the window
    const triples = useMemo(() => {
        const eo = digits.map(d => (d % 2 === 0 ? 'E' : 'O'));
        const map: Record<string, number> = {};
        for (let i = 0; i + 2 < eo.length; i += 1) {
            const key = eo.slice(i, i + 3).join(' ');
            map[key] = (map[key] || 0) + 1;
        }
        const total = Math.max(1, eo.length - 2);
        return Object.entries(map)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([key, n]) => ({ key, n, pct: (n / total) * 100 }));
    }, [digits]);

    return (
        <div className='sa__page'>
            <div className='sa__grid'>
                <div>
                    <label className='sa__label'>{localize('Market')}</label>
                    <MarketSelect market={market} onChange={onMarket} />
                </div>
                <div className='sa__grid sa__grid--inner'>
                    <div>
                        <label className='sa__label'>{localize('Ticks')}</label>
                        <SelectBox value={count} label={String(count)} onChange={e => setCount(Number(e.target.value))}>
                            {[50, 100, 200, 500].map(n => (
                                <option key={n} value={n}>
                                    {n}
                                </option>
                            ))}
                        </SelectBox>
                    </div>
                    <div>
                        <label className='sa__label'>{localize('Over/Under digit')}</label>
                        <BarrierSelect value={barrier} onChange={setBarrier} />
                    </div>
                </div>
            </div>

            {!ticks.length && <p className='sa__center sa__muted'>{error || localize('Waiting for ticks…')}</p>}

            {!!ticks.length &&
                rows.map(row => {
                    const { current, longest } = streaks(row.seq);
                    const total = row.seq.length || 1;
                    const keys = Object.keys(row.names);
                    return (
                        <div className='sa__panel' key={row.key}>
                            <div className='sa__panel-head'>
                                <h3>{row.title}</h3>
                                <span className='sa__muted'>
                                    {keys
                                        .map(k => {
                                            const n = row.seq.filter(x => x === k).length;
                                            return `${row.names[k]} ${n} (${((n / total) * 100).toFixed(0)}%)`;
                                        })
                                        .join(' · ')}
                                </span>
                            </div>
                            <div className='sa__strip'>
                                {row.seq.map((k, i) => (
                                    <span key={i} className={`sa__badge sa__badge--${row.tone[k]}`}>
                                        {k}
                                    </span>
                                ))}
                            </div>
                            <div className='sa__streaks'>
                                <span>
                                    {localize('Now')}:{' '}
                                    <strong>{current.len ? `${row.names[current.key]} ×${current.len}` : '-'}</strong>
                                </span>
                                <span>
                                    {localize('Longest run')}:{' '}
                                    <strong>{longest.len ? `${row.names[longest.key]} ×${longest.len}` : '-'}</strong>
                                </span>
                            </div>
                        </div>
                    );
                })}

            {!!triples.length && (
                <div className='sa__panel'>
                    <div className='sa__panel-head'>
                        <h3>{localize('Common 3-tick Even/Odd patterns')}</h3>
                        <span className='sa__muted'>E = even, O = odd</span>
                    </div>
                    <div className='sa__chips'>
                        {triples.map(t => (
                            <span className='sa__chip' key={t.key}>
                                <strong>{t.key}</strong> {t.n}× · {fmt(t.pct)}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {!!digits.length && (
                <div className='sa__panel'>
                    <div className='sa__panel-head'>
                        <h3>{localize('Latest digits')}</h3>
                        <span className='sa__muted'>{localize('oldest → newest')}</span>
                    </div>
                    <div className='sa__digit-line'>
                        {digits.slice(-60).map((d, i) => (
                            <span key={i} className={d % 2 === 0 ? 'sa__good' : 'sa__bad'}>
                                {d}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

/* ------------------------------------------------------------------ */
/* Tick Analyser                                                       */
/* ------------------------------------------------------------------ */

const AnalyserTab = ({ market, onMarket }: { market: string; onMarket: (s: string) => void }) => {
    const market_def = MARKETS.find(m => m.symbol === market) || MARKETS[0];
    const [ticks_input, setTicksInput] = useState<number>(1000);
    const [count, setCount] = useState<number>(1000);
    const [barrier, setBarrier] = useState(4);
    const { ticks, dp, error } = useTicks(market, market_def.dp, count);
    const digits = useMemo(() => ticks.map(t => t.d), [ticks]);

    // debounce the "ticks" box
    useEffect(() => {
        const t = setTimeout(() => setCount(clamp(Math.round(Number(ticks_input) || 1000), 20, 5000)), 600);
        return () => clearTimeout(t);
    }, [ticks_input]);

    const stats = useMemo(() => {
        const { counts, pct } = digitPercents(digits);
        const total = digits.length || 1;
        const sum = (f: (d: number) => boolean) => DIGITS.filter(f).reduce((a, d) => a + pct[d], 0);
        const max = Math.max(...pct);
        const min = Math.min(...pct);
        let rise = 0;
        let fall = 0;
        for (let i = 1; i < ticks.length; i += 1) {
            if (ticks[i].q > ticks[i - 1].q) rise += 1;
            else if (ticks[i].q < ticks[i - 1].q) fall += 1;
        }
        const moves = Math.max(1, ticks.length - 1);
        return {
            counts,
            pct,
            max,
            min,
            most: pct.indexOf(max),
            least: pct.indexOf(min),
            even: sum(d => d % 2 === 0),
            over: sum(d => d > barrier),
            under: sum(d => d < barrier),
            rise: (rise / moves) * 100,
            fall: (fall / moves) * 100,
            total,
        };
    }, [digits, ticks, barrier]);

    const last = ticks.length ? ticks[ticks.length - 1] : null;

    return (
        <div className='sa__page'>
            <div className='sa__grid'>
                <div>
                    <label className='sa__label'>{localize('Market')}</label>
                    <MarketSelect market={market} onChange={onMarket} />
                </div>
                <div className='sa__grid sa__grid--inner'>
                    <div>
                        <label className='sa__label'>{localize('Ticks')}</label>
                        <NumInput
                            value={ticks_input}
                            onChange={setTicksInput}
                            min={20}
                            max={5000}
                            integer
                            fallback={1000}
                        />
                    </div>
                    <div>
                        <label className='sa__label'>{localize('Over/Under digit')}</label>
                        <BarrierSelect value={barrier} onChange={setBarrier} />
                    </div>
                </div>
            </div>

            {!ticks.length ? (
                <p className='sa__center sa__muted'>{error || localize('Waiting for ticks…')}</p>
            ) : (
                <>
                    <div className='sa__readout sa__readout--row'>
                        <div>
                            {localize('Latest Tick')}: <strong>{last.q.toFixed(dp)}</strong>
                        </div>
                        <div>
                            {localize('Last Digit')}: <strong>{last.d}</strong>
                        </div>
                        <div>
                            {localize('Ticks analysed')}: <strong>{ticks.length}</strong>
                        </div>
                    </div>

                    <div className='sa__panel'>
                        <div className='sa__panel-head'>
                            <h3>{localize('Digit frequency')}</h3>
                            <span className='sa__muted'>
                                <span className='sa__dot sa__dot--max' /> {localize('most')}{' '}
                                <span className='sa__dot sa__dot--min' /> {localize('least')}
                            </span>
                        </div>
                        <div className='sa__bars'>
                            {DIGITS.map(d => (
                                <div className='sa__bar-col' key={d}>
                                    <span className='sa__bar-pct'>{stats.pct[d].toFixed(1)}%</span>
                                    <div className='sa__bar-track'>
                                        <div
                                            className={classNames('sa__bar', {
                                                'sa__bar--max': stats.pct[d] === stats.max,
                                                'sa__bar--min': stats.pct[d] === stats.min,
                                            })}
                                            style={{ height: `${stats.max ? (stats.pct[d] / stats.max) * 100 : 0}%` }}
                                        />
                                    </div>
                                    <span
                                        className={classNames('sa__bar-digit', { 'sa__bar-digit--now': last.d === d })}
                                    >
                                        {d}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className='sa__stats'>
                        <div className='sa__stat'>
                            <h4>{localize('Even / Odd')}</h4>
                            <p>
                                <span className='sa__good'>{fmt(stats.even)}</span> /{' '}
                                <span className='sa__bad'>{fmt(100 - stats.even)}</span>
                            </p>
                        </div>
                        <div className='sa__stat'>
                            <h4>
                                {localize('Over / Under')} {barrier}
                            </h4>
                            <p>
                                <span className='sa__good'>{fmt(stats.over)}</span> /{' '}
                                <span className='sa__bad'>{fmt(stats.under)}</span>
                            </p>
                        </div>
                        <div className='sa__stat'>
                            <h4>{localize('Rise / Fall')}</h4>
                            <p>
                                <span className='sa__good'>{fmt(stats.rise)}</span> /{' '}
                                <span className='sa__bad'>{fmt(stats.fall)}</span>
                            </p>
                        </div>
                        <div className='sa__stat'>
                            <h4>{localize('Most / least common digit')}</h4>
                            <p>
                                <span className='sa__good'>{stats.most}</span> /{' '}
                                <span className='sa__bad'>{stats.least}</span>
                            </p>
                        </div>
                    </div>

                    <div className='sa__panel'>
                        <div className='sa__panel-head'>
                            <h3>{localize('Last 20 ticks')}</h3>
                            <span className='sa__muted'>{localize('newest first')}</span>
                        </div>
                        <div className='sa__chips'>
                            {ticks
                                .slice(-20)
                                .reverse()
                                .map(t => (
                                    <span className='sa__chip' key={t.n}>
                                        {t.q.toFixed(dp).slice(0, -1)}
                                        <strong className={t.d % 2 === 0 ? 'sa__good' : 'sa__bad'}>
                                            {t.q.toFixed(dp).slice(-1)}
                                        </strong>
                                    </span>
                                ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const SuperAnalysis = observer(() => {
    const [tab, setTab] = useState('signal');
    const [market, setMarket] = useState(MARKETS[8].symbol);

    return (
        <div className='sa'>
            <div className='sa__tabs' role='tablist'>
                {SUB_TABS.map(t => (
                    <button
                        key={t.key}
                        type='button'
                        role='tab'
                        aria-selected={tab === t.key}
                        className={classNames('sa__tab', { 'sa__tab--active': tab === t.key })}
                        onClick={() => setTab(t.key)}
                    >
                        {localize(t.label)}
                    </button>
                ))}
            </div>

            {/* Signal stays mounted so auto trading keeps running while you look at the other tabs */}
            <div hidden={tab !== 'signal'}>
                <SignalTab market={market} onMarket={setMarket} />
            </div>
            {tab === 'patterns' && <PatternsTab market={market} onMarket={setMarket} />}
            {tab === 'analyser' && <AnalyserTab market={market} onMarket={setMarket} />}
        </div>
    );
});

export default SuperAnalysis;
