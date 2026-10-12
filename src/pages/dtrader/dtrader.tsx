// @ts-nocheck — talks to the shared Deriv API connection (api_base), which is loosely typed upstream
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import TickChart from './tick-chart';
import { getTradeType, TRADE_TYPES } from './trade-types';
import './dtrader.scss';

const TICK_COUNT = 120;
const DEFAULT_SYMBOL = 'R_100';

type TPosition = {
    contract_id: number;
    label: string;
    buy_price: number;
    profit?: number;
    is_sold?: boolean;
    can_sell?: boolean;
};

const errMsg = (e: any) => e?.error?.message || e?.message || localize('Something went wrong');

const DTrader = observer(() => {
    const { client } = useStore();
    const currency = client?.currency || 'USD';
    const is_logged_in = !!client?.is_logged_in;

    const [symbols, setSymbols] = useState<any[]>([]);
    const [symbol, setSymbol] = useState<string>(DEFAULT_SYMBOL);
    const [ticks, setTicks] = useState<{ epoch: number; quote: number }[]>([]);
    const [chart_error, setChartError] = useState<string>('');
    const [is_picker_open, setPickerOpen] = useState(false);
    const [search, setSearch] = useState('');

    const [trade_key, setTradeKey] = useState<string>('accumulators');
    const [is_types_open, setTypesOpen] = useState(false);
    const [stake, setStake] = useState<number>(10);
    const [growth_rate, setGrowthRate] = useState<number>(0.03);
    const [duration, setDuration] = useState<number>(5);
    const [barrier, setBarrier] = useState<number>(5);
    const [take_profit_on, setTakeProfitOn] = useState(false);
    const [take_profit, setTakeProfit] = useState<number>(10);

    const [is_buying, setIsBuying] = useState(false);
    const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
    const [positions, setPositions] = useState<TPosition[]>([]);
    const [quote_preview, setQuotePreview] = useState<Record<string, string>>({});

    const trade_type = getTradeType(trade_key);
    const own_contracts = useRef<Set<number>>(new Set());
    const tick_sub_id = useRef<string>('');

    // ---- Symbols (live markets provided by Deriv) ----
    useEffect(() => {
        let cancelled = false;
        let tries = 0;
        const load = async () => {
            let list = api_base.active_symbols || [];
            if (!list.length && api_base.api) {
                try {
                    list = (await api_base.getActiveSymbols()) || [];
                } catch (e) {
                    // retry below
                }
            }
            if (cancelled) return;
            if (list.length) {
                setSymbols(list);
                if (!list.some(s => s.symbol === DEFAULT_SYMBOL)) setSymbol(list[0].symbol);
            } else if (tries < 10) {
                tries += 1;
                setTimeout(load, 1500);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, []);

    const grouped_symbols = useMemo(() => {
        const q = search.trim().toLowerCase();
        const groups: Record<string, any[]> = {};
        symbols
            .filter(s => !q || `${s.display_name} ${s.symbol}`.toLowerCase().includes(q))
            .forEach(s => {
                const market = s.market_display_name || s.market || localize('Markets');
                (groups[market] = groups[market] || []).push(s);
            });
        return groups;
    }, [symbols, search]);

    const current_symbol = symbols.find(s => s.symbol === symbol);
    const display_name = current_symbol?.display_name || symbol;

    // ---- Live ticks ----
    useEffect(() => {
        let cancelled = false;
        let msg_sub: { unsubscribe: () => void } | null = null;
        setTicks([]);
        setChartError('');

        const start = async () => {
            if (!api_base.api) {
                setChartError(localize('Connecting to live markets…'));
                return;
            }
            try {
                const history = await api_base.api.send({
                    ticks_history: symbol,
                    adjust_start_time: 1,
                    count: TICK_COUNT,
                    end: 'latest',
                    style: 'ticks',
                });
                if (cancelled) return;
                const { prices = [], times = [] } = history?.history || {};
                setTicks(prices.map((p: number, i: number) => ({ quote: +p, epoch: +times[i] })));
            } catch (e) {
                if (!cancelled) setChartError(errMsg(e));
                return;
            }

            msg_sub = api_base.api.onMessage().subscribe(({ data }: any) => {
                if (data?.msg_type !== 'tick' || data.tick?.symbol !== symbol) return;
                const { epoch, quote } = data.tick;
                setTicks(prev => {
                    if (prev.length && prev[prev.length - 1].epoch >= +epoch) return prev;
                    return [...prev.slice(-(TICK_COUNT - 1)), { epoch: +epoch, quote: +quote }];
                });
            });

            try {
                const res = await api_base.api.send({ ticks: symbol, subscribe: 1 });
                tick_sub_id.current = res?.subscription?.id || '';
            } catch (e) {
                // AlreadySubscribed means the stream is already flowing through onMessage; ignore.
                if (e?.error?.code !== 'AlreadySubscribed' && !cancelled) setChartError(errMsg(e));
            }
        };
        start();

        return () => {
            cancelled = true;
            msg_sub?.unsubscribe();
            if (tick_sub_id.current && api_base.api) {
                api_base.api.send({ forget: tick_sub_id.current }).catch(() => {});
                tick_sub_id.current = '';
            }
        };
    }, [symbol]);

    // ---- Open positions updates ----
    useEffect(() => {
        if (!api_base.api) return;
        const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data?.msg_type !== 'proposal_open_contract') return;
            const c = data.proposal_open_contract;
            if (!c || !own_contracts.current.has(c.contract_id)) return;
            setPositions(prev =>
                prev.map(p =>
                    p.contract_id === c.contract_id
                        ? {
                              ...p,
                              profit: Number(c.profit),
                              is_sold: !!c.is_sold,
                              can_sell: !!c.is_valid_to_sell && !c.is_sold,
                          }
                        : p
                )
            );
        });
        return () => sub.unsubscribe();
    }, []);

    // ---- Proposal request builder ----
    const buildProposal = useCallback(
        (contract_type: string) => {
            const req: Record<string, any> = {
                proposal: 1,
                amount: Number(stake),
                basis: 'stake',
                contract_type,
                currency,
                symbol,
            };
            if (trade_type.key === 'accumulators') {
                req.growth_rate = growth_rate;
                if (take_profit_on) req.limit_order = { take_profit: Number(take_profit) };
            } else {
                req.duration = Number(duration);
                req.duration_unit = 't';
                if (trade_type.has_barrier) req.barrier = String(barrier);
            }
            return req;
        },
        [stake, currency, symbol, trade_type, growth_rate, take_profit_on, take_profit, duration, barrier]
    );

    // Preview payouts (re-requested whenever inputs change)
    useEffect(() => {
        setQuotePreview({});
        if (!api_base.api || !(Number(stake) > 0)) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            trade_type.contracts.forEach(async c => {
                try {
                    const res = await api_base.api.send(buildProposal(c.contract_type));
                    if (cancelled) return;
                    const p = res?.proposal;
                    if (p) {
                        const text =
                            trade_type.key === 'accumulators'
                                ? `${localize('Max. payout')}: ${Number(p.contract_details?.maximum_payout ?? 0).toFixed(2)} ${currency}`
                                : `${localize('Payout')}: ${Number(p.payout ?? 0).toFixed(2)} ${currency}`;
                        setQuotePreview(prev => ({ ...prev, [c.contract_type]: text }));
                    }
                } catch (e) {
                    if (!cancelled) setQuotePreview(prev => ({ ...prev, [c.contract_type]: errMsg(e) }));
                }
            });
        }, 600);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [buildProposal, trade_type, stake, currency]);

    const buy = async (contract_type: string, label: string) => {
        if (!is_logged_in) {
            setMessage({ type: 'error', text: localize('Please log in to trade.') });
            return;
        }
        if (!(Number(stake) > 0)) {
            setMessage({ type: 'error', text: localize('Enter a stake greater than 0.') });
            return;
        }
        setIsBuying(true);
        setMessage(null);
        try {
            const prop = await api_base.api.send(buildProposal(contract_type));
            const { id, ask_price } = prop.proposal;
            const res = await api_base.api.send({ buy: id, price: Number(ask_price) });
            const b = res.buy;
            own_contracts.current.add(b.contract_id);
            setPositions(prev => [
                { contract_id: b.contract_id, label: `${display_name} · ${label}`, buy_price: Number(b.buy_price) },
                ...prev,
            ]);
            api_base.api.send({ proposal_open_contract: 1, contract_id: b.contract_id, subscribe: 1 }).catch(() => {});
            setMessage({ type: 'ok', text: b.longcode || localize('Contract purchased.') });
        } catch (e) {
            setMessage({ type: 'error', text: errMsg(e) });
        } finally {
            setIsBuying(false);
        }
    };

    const sell = async (contract_id: number) => {
        try {
            await api_base.api.send({ sell: contract_id, price: 0 });
        } catch (e) {
            setMessage({ type: 'error', text: errMsg(e) });
        }
    };

    const last = ticks[ticks.length - 1];
    const prev = ticks[ticks.length - 2];
    const change = last && prev ? last.quote - prev.quote : 0;

    return (
        <div className='dtrader'>
            {/* Open positions */}
            <aside className='dtrader__positions'>
                <h3 className='dtrader__heading'>{localize('Open positions')}</h3>
                {positions.length === 0 ? (
                    <p className='dtrader__muted'>{localize('You have no open positions.')}</p>
                ) : (
                    <ul className='dtrader__position-list'>
                        {positions.map(p => (
                            <li key={p.contract_id} className='dtrader__position'>
                                <div className='dtrader__position-label'>{p.label}</div>
                                <div className='dtrader__muted'>
                                    {localize('Stake')}: {p.buy_price.toFixed(2)} {currency}
                                </div>
                                {p.profit !== undefined && (
                                    <div className={p.profit >= 0 ? 'dtrader__profit' : 'dtrader__loss'}>
                                        {p.profit >= 0 ? '+' : ''}
                                        {p.profit.toFixed(2)} {currency}
                                        {p.is_sold ? ` · ${localize('Closed')}` : ''}
                                    </div>
                                )}
                                {p.can_sell && (
                                    <button type='button' className='dtrader__link-btn' onClick={() => sell(p.contract_id)}>
                                        {localize('Close')}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </aside>

            {/* Chart */}
            <section className='dtrader__chart'>
                <div className='dtrader__symbol'>
                    <button type='button' className='dtrader__symbol-btn' onClick={() => setPickerOpen(o => !o)}>
                        <span className='dtrader__symbol-name'>{display_name}</span>
                        <span className='dtrader__symbol-price'>
                            {last ? last.quote : '—'}{' '}
                            {last && prev && (
                                <span className={change >= 0 ? 'dtrader__profit' : 'dtrader__loss'}>
                                    {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}
                                </span>
                            )}
                        </span>
                    </button>
                    {is_picker_open && (
                        <div className='dtrader__picker'>
                            <input
                                className='dtrader__input'
                                placeholder={localize('Search markets')}
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                autoFocus
                            />
                            <div className='dtrader__picker-list'>
                                {Object.keys(grouped_symbols).length === 0 && (
                                    <p className='dtrader__muted'>{localize('Loading live markets…')}</p>
                                )}
                                {Object.entries(grouped_symbols).map(([market, list]) => (
                                    <div key={market}>
                                        <div className='dtrader__picker-group'>{market}</div>
                                        {list.map(s => (
                                            <button
                                                type='button'
                                                key={s.symbol}
                                                className={classNames('dtrader__picker-item', {
                                                    'dtrader__picker-item--active': s.symbol === symbol,
                                                })}
                                                onClick={() => {
                                                    setSymbol(s.symbol);
                                                    setPickerOpen(false);
                                                    setSearch('');
                                                }}
                                            >
                                                {s.display_name}
                                            </button>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <div className='dtrader__canvas'>
                    {chart_error ? <p className='dtrader__muted dtrader__center'>{chart_error}</p> : <TickChart ticks={ticks} />}
                </div>
                <p className='dtrader__attribution'>{localize('Live markets provided by Deriv')}</p>
            </section>

            {/* Trade panel */}
            <aside className='dtrader__panel'>
                <div className='dtrader__card'>
                    <button type='button' className='dtrader__type-btn' onClick={() => setTypesOpen(o => !o)}>
                        <span>{trade_type.label}</span>
                        <span>{is_types_open ? '▴' : '▾'}</span>
                    </button>
                    {is_types_open && (
                        <ul className='dtrader__type-list'>
                            {TRADE_TYPES.map(t => (
                                <li key={t.key}>
                                    <button
                                        type='button'
                                        disabled={!t.available}
                                        className={classNames('dtrader__type-item', {
                                            'dtrader__type-item--active': t.key === trade_key,
                                        })}
                                        onClick={() => {
                                            setTradeKey(t.key);
                                            setTypesOpen(false);
                                            setMessage(null);
                                        }}
                                    >
                                        {t.label}
                                        {!t.available && <small> · {localize('Coming soon')}</small>}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {trade_type.key === 'accumulators' ? (
                    <div className='dtrader__card'>
                        <label className='dtrader__label'>{localize('Growth rate')}</label>
                        <div className='dtrader__segment'>
                            {[0.01, 0.02, 0.03, 0.04, 0.05].map(r => (
                                <button
                                    type='button'
                                    key={r}
                                    className={classNames('dtrader__segment-btn', {
                                        'dtrader__segment-btn--active': growth_rate === r,
                                    })}
                                    onClick={() => setGrowthRate(r)}
                                >
                                    {Math.round(r * 100)}%
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className='dtrader__card'>
                        <label className='dtrader__label'>{localize('Duration (ticks)')}</label>
                        <input
                            className='dtrader__input'
                            type='number'
                            min={trade_type.min_ticks}
                            max={10}
                            value={duration}
                            onChange={e => setDuration(Math.max(trade_type.min_ticks, Math.min(10, Number(e.target.value) || trade_type.min_ticks)))}
                        />
                        {trade_type.has_barrier && (
                            <>
                                <label className='dtrader__label'>{localize('Last digit prediction')}</label>
                                <input
                                    className='dtrader__input'
                                    type='number'
                                    min={trade_type.barrier_min}
                                    max={trade_type.barrier_max}
                                    value={barrier}
                                    onChange={e =>
                                        setBarrier(
                                            Math.max(
                                                trade_type.barrier_min,
                                                Math.min(trade_type.barrier_max, Math.round(Number(e.target.value) || 0))
                                            )
                                        )
                                    }
                                />
                            </>
                        )}
                    </div>
                )}

                <div className='dtrader__card'>
                    <label className='dtrader__label'>{localize('Stake')} ({currency})</label>
                    <div className='dtrader__stepper'>
                        <button type='button' onClick={() => setStake(s => Math.max(1, +(Number(s) - 1).toFixed(2)))}>
                            −
                        </button>
                        <input
                            className='dtrader__input'
                            type='number'
                            min={0.35}
                            step='0.01'
                            value={stake}
                            onChange={e => setStake(Number(e.target.value))}
                        />
                        <button type='button' onClick={() => setStake(s => +(Number(s) + 1).toFixed(2))}>
                            +
                        </button>
                    </div>
                    {trade_type.key === 'accumulators' && (
                        <>
                            <label className='dtrader__check'>
                                <input
                                    type='checkbox'
                                    checked={take_profit_on}
                                    onChange={e => setTakeProfitOn(e.target.checked)}
                                />
                                {localize('Take profit')}
                            </label>
                            {take_profit_on && (
                                <input
                                    className='dtrader__input'
                                    type='number'
                                    min={1}
                                    value={take_profit}
                                    onChange={e => setTakeProfit(Number(e.target.value))}
                                />
                            )}
                        </>
                    )}
                </div>

                <div className='dtrader__buy-wrap'>
                    {trade_type.contracts.map(c => (
                        <div key={c.contract_type}>
                            <button
                                type='button'
                                className={classNames('dtrader__buy', `dtrader__buy--${c.tone}`)}
                                disabled={is_buying || !is_logged_in}
                                onClick={() => buy(c.contract_type, c.label)}
                            >
                                {c.label}
                            </button>
                            <p className='dtrader__muted dtrader__preview'>{quote_preview[c.contract_type] || '\u00a0'}</p>
                        </div>
                    ))}
                    {!is_logged_in && <p className='dtrader__muted'>{localize('Log in to place trades.')}</p>}
                    {message && (
                        <p className={message.type === 'ok' ? 'dtrader__profit' : 'dtrader__loss'}>{message.text}</p>
                    )}
                </div>
            </aside>
        </div>
    );
});

export default DTrader;
