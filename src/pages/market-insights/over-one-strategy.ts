// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { localize } from '@deriv-com/translations';
import { run_panel as RUN_PANEL } from '@/constants/run-panel';

// Over 1 pays when the last digit is 2-9. Place it when the share of digits 2-9 in the last N ticks
// is above the level set for that window (any one window meeting its level is a signal).
export const OVER1_WINDOWS = [
    { ticks: 100, min: 85 },
    { ticks: 500, min: 81 },
    { ticks: 1000, min: 83 },
];
const MAX_TICKS = 1000;
// After a loss: take a 5-10 second break, then look at the last 50 ticks of the market being traded.
// Digits 5-9 above 80% -> recover with Over 4 immediately; digits 0-6 above 85% -> recover with Under 5.
const REC_TICKS = 50;
const REC_HIGH_MIN = 80; // digits 5-9
const REC_LOW_MIN = 85; // digits 0-6
const BREAK_MIN_MS = 5000;
const BREAK_MAX_MS = 10000;
const share = (digits: number[], test: (d: number) => boolean) =>
    (digits.filter(test).length / (digits.length || 1)) * 100;
const SETTLE_TIMEOUT_MS = 60000;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const toDigit = (quote: number | string, dp: number) => Number(Number(quote).toFixed(dp).slice(-1));
const errMsg = (e: any) => e?.error?.message || e?.message || localize('Something went wrong');

export type Over1Row = {
    symbol: string;
    pct: (number | null)[]; // share of digits 2-9 for each window (null while not enough ticks)
    hit: boolean[]; // window meets its level
    score: number; // best margin above a level (negative when nothing meets)
    signal: boolean;
};

const analyse = (symbol: string, digits: number[]): Over1Row => {
    const pct = OVER1_WINDOWS.map(w => {
        if (digits.length < w.ticks) return null;
        const slice = digits.slice(-w.ticks);
        return (slice.filter(d => d >= 2).length / w.ticks) * 100;
    });
    // compared the way they are shown (1 decimal)
    const hit = pct.map((p, i) => p !== null && Number(p.toFixed(1)) > OVER1_WINDOWS[i].min);
    const margins = pct.map((p, i) => (p === null ? -Infinity : p - OVER1_WINDOWS[i].min));
    return { symbol, pct, hit, score: Math.max(...margins), signal: hit.some(Boolean) };
};

type Cfg = {
    stake: number;
    duration: number;
    martingale: boolean;
    multiplier: number;
    stop_loss: number;
    take_profit: number;
    max_trades: number;
    auto_trade: boolean;
    fast_mode: boolean;
    currency: string;
    is_logged_in: boolean;
    transactions?: any;
    run_panel?: any;
    summary_card?: any;
};

export const useOverOneStrategy = (markets: { symbol: string; name: string; dp: number }[], cfg_in: Cfg) => {
    const [running, setRunning] = useState(false);
    const [rows, setRows] = useState<Record<string, Over1Row>>({});
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [traded, setTraded] = useState(''); // the market the strategy is trading right now
    const [pl, setPl] = useState<{ n: number; total: number } | null>(null);
    const [trades, setTrades] = useState<{ id: number; symbol: string; stake: number; profit: number }[]>([]);

    const cfg = useRef<Cfg>(cfg_in);
    cfg.current = cfg_in;
    const run_id = useRef(0);
    const cancel_wait = useRef<(() => void) | null>(null);

    const stop = useCallback(() => {
        run_id.current += 1;
        cancel_wait.current?.();
        setRunning(false);
        setStatus('');
    }, []);

    useEffect(() => () => {
        run_id.current += 1;
        cancel_wait.current?.();
    }, []);

    // wait until one contract is sold (pushed updates, with a slow poll as a safety net)
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
                        cfg.current.summary_card?.onBotContractEvent?.(poc);
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

    // symbols = the markets to watch (one market, or all ten)
    const start = useCallback(
        async (symbols: string[]) => {
            if (!api_base.api) {
                setError(localize('Not connected yet. Please wait a moment and try again.'));
                return;
            }
            run_id.current += 1;
            const my_run = run_id.current;
            const alive = () => run_id.current === my_run;

            setError('');
            setTraded('');
            setRows({});
            setPl(null);
            setTrades([]);
            setRunning(true);
            // show every trade (with win / loss) in the Transactions tab of the Run panel
            try {
                const rp = cfg.current.run_panel;
                if (rp) {
                    rp.run_id = `run-${Date.now()}`;
                    rp.toggleDrawer?.(true);
                    rp.setActiveTabIndex?.(RUN_PANEL.TRANSACTIONS);
                }
            } catch (e) {
                // the panel is optional
            }
            setStatus(localize('Analysing the last 1,000 ticks…'));

            const bufs: Record<string, number[]> = {};
            const dps: Record<string, number> = {};
            const own_subs: string[] = [];
            let loaded = false;
            let locked = ''; // the market being traded: stays on it while its signal holds
            let open = 0; // trades bought and not settled yet
            let buying = false;
            let tick_n = 0; // fast mode: ticks seen on the market being traded
            let pause_until = 0; // after Deriv's rate limit, wait before buying again
            let total = 0;
            let n = 0;
            let losses = 0;
            let in_a_row = 0;
            let recovering = false; // a loss happened: Over 1 is paused until a recovery trade wins
            let rec_open = false; // a recovery trade is bought and not settled yet
            let resume_at = 0; // no break after a loss
            let rec_flip = false; // alternates the recovery trade: Over 4, Under 5, Over 4...

            const publish = () => {
                const next: Record<string, Over1Row> = {};
                symbols.forEach(s => {
                    if (bufs[s]) next[s] = analyse(s, bufs[s]);
                });
                setRows(next);
                return next;
            };

            const nameOf = (sym: string) => markets.find(m => m.symbol === sym)?.name || sym;

            const showTransactions = () => {
                try {
                    const rp = cfg.current.run_panel;
                    rp?.toggleDrawer?.(true);
                    rp?.setActiveTabIndex?.(RUN_PANEL.TRANSACTIONS);
                } catch (e) {
                    // the panel is optional
                }
            };

            // settle one bought trade in the background (profit / loss, martingale, take profit, stop loss)
            const settle = async (cid: number, symbol: string, amount: number, is_recovery = false) => {
                const profit = await waitForResult(cid, my_run);
                open = Math.max(0, open - 1);
                if (!alive()) return;
                if (profit === null) {
                    setError(localize('Could not confirm the result of the last trade, so trading stopped.'));
                    stop();
                    return;
                }
                total = round2(total + profit);
                n += 1;
                losses = profit < 0 ? losses + 1 : 0;
                if (is_recovery) rec_open = false;
                if (profit < 0) {
                    // a loss (Over 1 or recovery, slow or fast mode): break for 5-10 seconds, then analyse and recover
                    if (is_recovery || !recovering) {
                        recovering = true;
                        resume_at = 0;
                        setStatus(localize('Loss. Recovering now with Over 4 / Under 5…'));
                    }
                } else if (is_recovery) {
                    recovering = false;
                    in_a_row = 0;
                    setStatus(localize('Recovered. Back to Over 1…'));
                }
                setPl({ n, total });
                setTrades(prev => [{ id: cid, symbol, stake: amount, profit }, ...prev].slice(0, 50));
                const c = cfg.current;
                if (c.take_profit > 0 && total >= c.take_profit) {
                    stop();
                    setStatus(localize('Take profit reached. Trading stopped.'));
                    return;
                }
                if (c.stop_loss > 0 && total <= -c.stop_loss) {
                    stop();
                    setStatus(localize('Stop loss reached. Trading stopped.'));
                    return;
                }
                check(false); // normal mode: the next trade goes straight out when this one settles
            };

            // buy right now on `symbol`: Over 1, or a recovery contract (Over 4 / Under 5) after a loss
            const placeTrade = async (symbol: string, kind: 'over1' | 'over4' | 'under5' = 'over1') => {
                const c = cfg.current;
                const spec = {
                    over1: { type: 'DIGITOVER', barrier: '1', label: 'Over 1' },
                    over4: { type: 'DIGITOVER', barrier: '4', label: 'Over 4' },
                    under5: { type: 'DIGITUNDER', barrier: '5', label: 'Under 5' },
                }[kind];
                const amount = c.martingale && losses > 0 ? round2(c.stake * Math.pow(Math.max(1, c.multiplier), losses)) : c.stake;
                buying = true;
                if (kind === 'over1') in_a_row += 1;
                else rec_open = true;
                setStatus(`${spec.label} ${localize('on')} ${nameOf(symbol)}, ${localize('stake')} ${amount} ${c.currency}…`);
                try {
                    const res = await api_base.api.send({
                        buy: '1',
                        price: Number(amount),
                        parameters: {
                            amount,
                            basis: 'stake',
                            contract_type: spec.type,
                            barrier: spec.barrier,
                            currency: c.currency,
                            duration: clamp(Math.round(c.duration) || 1, 1, 10),
                            duration_unit: 't',
                            underlying_symbol: symbol,
                        },
                    });
                    open += 1;
                    showTransactions();
                    settle(res.buy.contract_id, symbol, amount, kind !== 'over1');
                } catch (e) {
                    if (kind !== 'over1') rec_open = false;
                    if (e?.error?.code === 'RateLimit') {
                        // Deriv's request limit: back off for a moment instead of stopping
                        if (kind === 'over1') in_a_row = Math.max(0, in_a_row - 1);
                        pause_until = Date.now() + 4000;
                        if (alive()) setStatus(localize('Deriv rate limit reached. Pausing a few seconds…'));
                    } else {
                        if (alive()) setError(errMsg(e));
                        stop();
                    }
                } finally {
                    buying = false;
                }
            };

            // runs on every tick of a watched market
            const check = (from_tick = false) => {
                const all = publish();
                if (!loaded || !alive()) return;
                const c = cfg.current;

                // after a loss: stay on this market, wait out the break, then look at the last 50 ticks
                if (recovering && locked) {
                    if (!c.auto_trade || buying || rec_open || Date.now() < pause_until || Date.now() < resume_at) return;
                    // no break, no analysis: recovery trades go out at once, alternating Over 4 and Under 5
                    rec_flip = !rec_flip;
                    placeTrade(locked, rec_flip ? 'over4' : 'under5');
                    return;
                }

                // keep the market we are on; only look for another one when its signal is gone
                if (locked && !all[locked]?.signal) {
                    if (open > 0) return;
                    locked = '';
                    setTraded('');
                    in_a_row = 0;
                    setStatus(localize('Signal gone. Watching live ticks for the next one…'));
                }
                if (!locked) {
                    const best = Object.values(all).filter(r => r.signal).sort((a, b) => b.score - a.score)[0];
                    if (!best) return;
                    if (!c.auto_trade) {
                        setStatus(`${localize('Signal: Over 1 on')} ${nameOf(best.symbol)}`);
                        return;
                    }
                    if (!c.is_logged_in) {
                        setError(localize('Log in to place trades.'));
                        return;
                    }
                    locked = best.symbol;
                    setTraded(locked);
                }
                if (!c.auto_trade || buying || Date.now() < pause_until) return;
                // normal mode: one trade at a time. Fast mode: a new trade on the ticks of the market (3 of every
                // 4 ticks, 25% slower than every tick, to stay under Deriv's limit), never in between
                if (c.fast_mode) {
                    if (!from_tick) return;
                    tick_n += 1;
                    if (tick_n % 4 === 0) return;
                } else if (open > 0) return;
                if (open >= 30) return;
                if (c.max_trades > 0 && in_a_row >= c.max_trades) {
                    if (open === 0) {
                        locked = '';
                        setTraded('');
                        in_a_row = 0;
                        setStatus(localize('Max trades for this signal reached. Watching for the next signal…'));
                    }
                    return;
                }
                placeTrade(locked);
            };

            const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
                if (data?.msg_type !== 'tick') return;
                const s = data.tick?.symbol;
                if (!symbols.includes(s) || !bufs[s]) return;
                if (data.tick.pip_size !== undefined) dps[s] = Number(data.tick.pip_size);
                bufs[s].push(toDigit(data.tick.quote, dps[s]));
                if (bufs[s].length > MAX_TICKS) bufs[s].shift();
                check(s === locked || !locked);
            });

            // every market's last 1,000 ticks, all at the same time
            const failed: string[] = [];
            let loaded_count = 0;
            await Promise.all(
                symbols.map(async symbol => {
                    const m = markets.find(x => x.symbol === symbol);
                    const base = { ticks_history: m.symbol, adjust_start_time: 1, count: MAX_TICKS, end: 'latest', style: 'ticks' };
                    try {
                        let res;
                        try {
                            res = await api_base.api.send({ ...base, subscribe: 1 });
                            const id = res?.subscription?.id;
                            if (id) {
                                if (!alive()) api_base.api.send({ forget: id }).catch(() => {});
                                else own_subs.push(id);
                            }
                        } catch (e) {
                            // already streamed by the chart or another page: read the history, ticks still reach us
                            if (e?.error?.code !== 'AlreadySubscribed') throw e;
                            res = await api_base.api.send(base);
                        }
                        if (!alive()) return;
                        dps[m.symbol] = res?.pip_size !== undefined ? Number(res.pip_size) : m.dp;
                        bufs[m.symbol] = (res?.history?.prices || []).map((q: number) => toDigit(q, dps[m.symbol])).slice(-MAX_TICKS);
                        publish();
                    } catch (e) {
                        failed.push(m.name);
                    }
                    loaded_count += 1;
                    setStatus(`${localize('Analysing the volatilities…')} ${loaded_count}/${symbols.length}`);
                })
            );

            if (!alive()) {
                sub.unsubscribe();
                own_subs.forEach(id => api_base.api?.send({ forget: id }).catch(() => {}));
                return;
            }
            loaded = true;
            setStatus(
                failed.length
                    ? `${localize('Watching live ticks. Could not load:')} ${failed.join(', ')}`
                    : localize('Analysis done. Watching live ticks for a signal…')
            );
            check();

            // clean up when this run is stopped
            const cleaner = setInterval(() => {
                if (alive()) return;
                clearInterval(cleaner);
                sub.unsubscribe();
                own_subs.forEach(id => api_base.api?.send({ forget: id }).catch(() => {}));
            }, 500);
        },
        [markets, stop, waitForResult]
    );

    return { running, rows, status, error, pl, trades, traded, start, stop };
};
