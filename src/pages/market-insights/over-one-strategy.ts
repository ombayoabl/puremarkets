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
    currency: string;
    is_logged_in: boolean;
    transactions?: any;
    run_panel?: any;
};

export const useOverOneStrategy = (markets: { symbol: string; name: string; dp: number }[], cfg_in: Cfg) => {
    const [running, setRunning] = useState(false);
    const [rows, setRows] = useState<Record<string, Over1Row>>({});
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
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
            let trading = false;
            let total = 0;
            let n = 0;
            let losses = 0;
            let in_a_row = 0;

            const publish = () => {
                const next: Record<string, Over1Row> = {};
                symbols.forEach(s => {
                    if (bufs[s]) next[s] = analyse(s, bufs[s]);
                });
                setRows(next);
                return next;
            };

            const tradeLoop = async (first_symbol: string) => {
                trading = true;
                let symbol = first_symbol;
                try {
                    while (alive()) {
                        const c = cfg.current;
                        const amount = c.martingale && losses > 0
                            ? round2(c.stake * Math.pow(Math.max(1, c.multiplier), losses))
                            : c.stake;
                        const name = markets.find(m => m.symbol === symbol)?.name || symbol;
                        setStatus(`${localize('Signal! Over 1 on')} ${name}, ${localize('stake')} ${amount} ${c.currency}…`);
                        let cid: number;
                        try {
                            const res = await api_base.api.send({
                                buy: '1',
                                price: Number(amount),
                                parameters: {
                                    amount,
                                    basis: 'stake',
                                    contract_type: 'DIGITOVER',
                                    barrier: '1',
                                    currency: c.currency,
                                    duration: clamp(Math.round(c.duration) || 1, 1, 10),
                                    duration_unit: 't',
                                    underlying_symbol: symbol,
                                },
                            });
                            cid = res.buy.contract_id;
                        } catch (e) {
                            if (alive()) setError(errMsg(e));
                            stop();
                            return;
                        }
                        const profit = await waitForResult(cid, my_run);
                        if (!alive()) return;
                        if (profit === null) {
                            setError(localize('Could not confirm the result of the last trade, so trading stopped.'));
                            stop();
                            return;
                        }
                        total = round2(total + profit);
                        n += 1;
                        in_a_row += 1;
                        losses = profit < 0 ? losses + 1 : 0;
                        setPl({ n, total });
                        setTrades(prev => [{ id: cid, symbol, stake: amount, profit }, ...prev].slice(0, 50));

                        if (c.take_profit > 0 && total >= c.take_profit) {
                            setError('');
                            stop();
                            setStatus(localize('Take profit reached. Trading stopped.'));
                            return;
                        }
                        if (c.stop_loss > 0 && total <= -c.stop_loss) {
                            stop();
                            setStatus(localize('Stop loss reached. Trading stopped.'));
                            return;
                        }
                        if (c.max_trades > 0 && in_a_row >= c.max_trades) {
                            in_a_row = 0;
                            setStatus(localize('Max trades for this signal reached. Watching for the next signal…'));
                            break;
                        }
                        // keep trading while a signal holds (the best market now), otherwise go back to watching
                        const best = Object.values(publish()).filter(r => r.signal).sort((a, b) => b.score - a.score)[0];
                        if (!best) {
                            in_a_row = 0;
                            setStatus(localize('Signal gone. Watching live ticks for the next one…'));
                            break;
                        }
                        symbol = best.symbol;
                    }
                } finally {
                    trading = false;
                }
            };

            const check = () => {
                const all = publish();
                if (!loaded || trading || !alive()) return;
                const best = Object.values(all).filter(r => r.signal).sort((a, b) => b.score - a.score)[0];
                if (!best) return;
                if (!cfg.current.auto_trade) {
                    const name = markets.find(m => m.symbol === best.symbol)?.name || best.symbol;
                    setStatus(`${localize('Signal: Over 1 on')} ${name}`);
                    return;
                }
                if (!cfg.current.is_logged_in) {
                    setError(localize('Log in to place trades.'));
                    return;
                }
                tradeLoop(best.symbol);
            };

            const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
                if (data?.msg_type !== 'tick') return;
                const s = data.tick?.symbol;
                if (!symbols.includes(s) || !bufs[s]) return;
                if (data.tick.pip_size !== undefined) dps[s] = Number(data.tick.pip_size);
                bufs[s].push(toDigit(data.tick.quote, dps[s]));
                if (bufs[s].length > MAX_TICKS) bufs[s].shift();
                check();
            });

            // every market's last 1,000 ticks, one after another
            const failed: string[] = [];
            for (let i = 0; i < symbols.length; i++) {
                if (!alive()) break;
                const m = markets.find(x => x.symbol === symbols[i]);
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
                    if (!alive()) break;
                    dps[m.symbol] = res?.pip_size !== undefined ? Number(res.pip_size) : m.dp;
                    bufs[m.symbol] = (res?.history?.prices || []).map((q: number) => toDigit(q, dps[m.symbol])).slice(-MAX_TICKS);
                    publish();
                } catch (e) {
                    failed.push(m.name);
                }
                setStatus(`${localize('Analysing the volatilities…')} ${i + 1}/${symbols.length}`);
            }

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

    return { running, rows, status, error, pl, trades, start, stop };
};
