// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { localize } from '@deriv-com/translations';
import { run_panel as RUN_PANEL } from '@/constants/run-panel';

// ---- Even / Odd strategies ----
// Even signal: at least 3 of the even digits (0, 2, 4, 6, 8) are at 10.5% or more of the last ticks -> Even.
//   Entry: wait for the last digit to be ODD 3 (to 4) times in a row, then Even starts by itself.
// Odd signal: at least 3 of the odd digits (1, 3, 5, 7, 9) are at 10.5% or more -> Odd.
//   Entry: wait for the last digit to be EVEN 3 (to 4) times in a row, then Odd starts by itself.
// Every volatility is analysed at once. Once in, the trades follow one after another with no more waiting.
export const EO_MIN_SHARE = 10.5;
export const EO_MIN_DIGITS = 3;
export const EO_TICKS = 1000;
const MIN_TICKS = 100; // fewest ticks needed before a market is judged
const SETTLE_TIMEOUT_MS = 60000;
// Fast mode trades on this share of the ticks, so Deriv's rate limit is not hit
const FAST_RATE = 0.525;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const toDigit = (quote: number | string, dp: number) => Number(Number(quote).toFixed(dp).slice(-1));
const errMsg = (e: any) => e?.error?.message || e?.message || localize('Something went wrong');

export type Side = 'even' | 'odd';

export type EvenOddRow = {
    symbol: string;
    pct: number[]; // share of each digit 0-9 (empty while there are not enough ticks)
    even_n: number; // how many even digits are at 10.5% or more
    odd_n: number; // how many odd digits are at 10.5% or more
    side: Side | null; // the signal this market has right now
    score: number; // how far the signal clears 10.5% (the 3rd best digit of its group); negative when no signal
    signal: boolean;
    wait: number; // live opposite digits in a row so far (odd digits for Even, even digits for Odd)
};

const analyse = (symbol: string, digits: number[]): Omit<EvenOddRow, 'wait'> => {
    const empty = { symbol, pct: [], even_n: 0, odd_n: 0, side: null, score: -Infinity, signal: false };
    if (digits.length < MIN_TICKS) return empty;
    const counts = Array(10).fill(0);
    digits.forEach(d => (counts[d] += 1));
    // compared the way they are shown (1 decimal)
    const pct = counts.map(c => Number(((c / digits.length) * 100).toFixed(1)));
    // the 3rd best digit of a group decides: three digits must be at 10.5% or more
    const margin = (list: number[]) => [...list].sort((a, b) => b - a)[EO_MIN_DIGITS - 1] - EO_MIN_SHARE;
    const evens = [0, 2, 4, 6, 8].map(d => pct[d]);
    const odds = [1, 3, 5, 7, 9].map(d => pct[d]);
    const even_m = margin(evens);
    const odd_m = margin(odds);
    const even_ok = even_m >= 0;
    const odd_ok = odd_m >= 0;
    let side: Side | null = null;
    if (even_ok && (!odd_ok || even_m >= odd_m)) side = 'even';
    else if (odd_ok) side = 'odd';
    return {
        symbol,
        pct,
        even_n: evens.filter(p => p >= EO_MIN_SHARE).length,
        odd_n: odds.filter(p => p >= EO_MIN_SHARE).length,
        side,
        score: side === 'even' ? even_m : side === 'odd' ? odd_m : Math.max(even_m, odd_m),
        signal: side !== null,
    };
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
    entry_hits: number; // opposite digits in a row to wait for (3 or 4)
    currency: string;
    is_logged_in: boolean;
    transactions?: any;
    run_panel?: any;
    summary_card?: any;
};

export const useEvenOddStrategy = (markets: { symbol: string; name: string; dp: number }[], cfg_in: Cfg) => {
    const [running, setRunning] = useState(false);
    const [rows, setRows] = useState<Record<string, EvenOddRow>>({});
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [limit, setLimit] = useState<'tp' | 'sl' | null>(null);
    const [traded, setTraded] = useState(''); // the market the strategy is trading right now

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

    useEffect(
        () => () => {
            run_id.current += 1;
            cancel_wait.current?.();
        },
        []
    );

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
            setLimit(null);
            setTraded('');
            setRows({});
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
            // live runs of the same kind of digit, counted from the ticks that arrive after Analyse
            const odd_run: Record<string, number> = {};
            const even_run: Record<string, number> = {};
            const sig_n: Record<string, number> = {}; // trades placed on each market during its current signal
            let loaded = false;
            let locked = ''; // the market being traded: stays on it while its signal holds
            let lock_side: Side | '' = '';
            let open = 0; // trades bought and not settled yet
            let buying = false;
            let tick_n = 0; // fast mode: ticks seen
            let pause_until = 0; // after Deriv's rate limit, wait before buying again
            let total = 0;
            let mg_stake = 0; // martingale: the stake of the next trade after a loss (0 = base stake)

            // Trades are also read from the ticks themselves: a trade ends on its `dur`-th tick after the start time
            // Deriv confirmed, so a loss is known on that tick, before the contract stream reports it. That lets
            // the very next trade (even in fast mode) carry the martingale stake.
            const live = new Map<number, any>();
            const recent: Record<string, { epoch: number; digit: number }[]> = {};
            const applyTick = (t: any, epoch: number, digit: number) => {
                if (t.done || !t.start || epoch <= t.start) return;
                t.seen += 1;
                if (t.seen === t.dur) {
                    t.done = true;
                    const win = t.side === 'even' ? digit % 2 === 0 : digit % 2 === 1;
                    if (!win) mg_stake = Math.max(mg_stake, round2(t.amount * Math.max(1, cfg.current.multiplier)));
                }
            };

            const runOf = (sym: string, side: Side) => (side === 'even' ? odd_run[sym] || 0 : even_run[sym] || 0);

            const publish = () => {
                const next: Record<string, EvenOddRow> = {};
                symbols.forEach(s => {
                    if (!bufs[s]) return;
                    const r = analyse(s, bufs[s]);
                    next[s] = { ...r, wait: r.side ? runOf(s, r.side) : 0 };
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
            const settle = async (cid: number, symbol: string, amount: number) => {
                const profit = await waitForResult(cid, my_run);
                live.delete(cid);
                open = Math.max(0, open - 1);
                if (!alive()) return;
                if (profit === null) {
                    setError(localize('Could not confirm the result of the last trade, so trading stopped.'));
                    stop();
                    return;
                }
                total = round2(total + profit);
                // martingale: every loss raises the next stake from the stake that lost; a win at the raised stake
                // (or above) goes back to the base stake
                if (profit < 0) mg_stake = Math.max(mg_stake, round2(amount * Math.max(1, cfg.current.multiplier)));
                else if (amount >= mg_stake) mg_stake = 0;
                const c = cfg.current;
                if (c.take_profit > 0 && total >= c.take_profit) {
                    stop();
                    setLimit('tp');
                    setStatus(localize('Take profit reached. Trading stopped.'));
                    return;
                }
                if (c.stop_loss > 0 && total <= -c.stop_loss) {
                    stop();
                    setLimit('sl');
                    setStatus(localize('Stop loss reached. Trading stopped.'));
                    return;
                }
                check(false); // normal mode: the next trade goes straight out when this one settles
            };

            // buy right now on `symbol`
            const placeTrade = async (symbol: string, side: Side) => {
                const c = cfg.current;
                const type = side === 'even' ? 'DIGITEVEN' : 'DIGITODD';
                const amount = c.martingale && mg_stake > 0 ? mg_stake : c.stake;
                buying = true;
                sig_n[symbol] = (sig_n[symbol] || 0) + 1;
                setStatus(
                    `${side === 'even' ? localize('Even') : localize('Odd')} ${localize('on')} ${nameOf(symbol)}, ${localize('stake')} ${amount} ${c.currency}…`
                );
                try {
                    const dur = clamp(Math.round(c.duration) || 1, 1, 10);
                    const res = await api_base.api.send({
                        buy: '1',
                        price: Number(amount),
                        parameters: {
                            amount,
                            basis: 'stake',
                            contract_type: type,
                            currency: c.currency,
                            duration: dur,
                            duration_unit: 't',
                            underlying_symbol: symbol,
                        },
                    });
                    open += 1;
                    showTransactions();
                    const tr = {
                        symbol,
                        amount,
                        side,
                        dur,
                        start: Number(res.buy.start_time || res.buy.purchase_time || 0),
                        seen: 0,
                        done: false,
                    };
                    live.set(res.buy.contract_id, tr);
                    // ticks that arrived before the buy confirmation did
                    (recent[symbol] || []).forEach(r => applyTick(tr, r.epoch, r.digit));
                    settle(res.buy.contract_id, symbol, amount);
                } catch (e) {
                    sig_n[symbol] = Math.max(0, (sig_n[symbol] || 1) - 1);
                    if (e?.error?.code === 'RateLimit') {
                        // Deriv's request limit: back off for a moment instead of stopping
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
                const hits = clamp(Math.round(c.entry_hits) || 3, 3, 4);
                const atMax = (sym: string) => c.max_trades > 0 && (sig_n[sym] || 0) >= c.max_trades;
                // a market's count starts again once its signal is gone
                Object.keys(sig_n).forEach(k => {
                    if (!all[k]?.signal) delete sig_n[k];
                });

                // already in: keep trading while the signal holds, no more waiting
                if (locked) {
                    const r = all[locked];
                    const valid = r && r.signal && r.side === lock_side && !atMax(locked);
                    if (!valid) {
                        // signal gone (or max trades reached): let the open trades settle, then look for the next one
                        if (open === 0 && !buying) {
                            const was = locked;
                            odd_run[was] = 0;
                            even_run[was] = 0; // the next entry on it waits again from zero
                            locked = '';
                            lock_side = '';
                            setTraded('');
                            setStatus(
                                r && r.signal && atMax(was)
                                    ? localize('Max trades for this signal reached. Watching for the next signal…')
                                    : localize('Signal gone. Watching live ticks for the next one…')
                            );
                        }
                        return;
                    }
                } else {
                    const list = Object.values(all)
                        .filter(r => r.signal && !atMax(r.symbol))
                        .sort((a, b) => b.score - a.score);
                    if (!list.length) return;
                    if (!c.auto_trade) {
                        setStatus(
                            `${localize('Signal:')} ${list.map(r => `${r.side === 'even' ? localize('Even') : localize('Odd')} ${localize('on')} ${nameOf(r.symbol)}`).join(', ')}`
                        );
                        return;
                    }
                    if (!c.is_logged_in) {
                        setError(localize('Log in to place trades.'));
                        return;
                    }
                    // entry: the first signalled market where the opposite digit has just come up 3 (to 4) times in a row
                    const entry = list.find(r => runOf(r.symbol, r.side) >= hits);
                    if (!entry) {
                        const top = list[0];
                        setStatus(
                            `${localize('Signal:')} ${top.side === 'even' ? localize('Even') : localize('Odd')} ${localize('on')} ${nameOf(top.symbol)}. ${localize('Waiting for')} ${hits} ${top.side === 'even' ? localize('odd') : localize('even')} ${localize('digits in a row…')}`
                        );
                        return;
                    }
                    locked = entry.symbol;
                    lock_side = entry.side;
                    setTraded(locked);
                }

                if (!c.auto_trade || buying || Date.now() < pause_until) return;
                // normal mode: one trade at a time, the next goes out the moment this one settles. Fast mode: a new
                // trade on the ticks of the market (about every other tick), never in between
                if (c.fast_mode) {
                    if (!from_tick) return;
                    tick_n += 1;
                    if (Math.floor(tick_n * FAST_RATE) === Math.floor((tick_n - 1) * FAST_RATE)) return;
                } else if (open > 0) return;
                if (open >= 30) return;
                placeTrade(locked, lock_side as Side);
            };

            const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
                if (data?.msg_type !== 'tick') return;
                const s = data.tick?.symbol;
                if (!symbols.includes(s) || !bufs[s]) return;
                if (data.tick.pip_size !== undefined) dps[s] = Number(data.tick.pip_size);
                bufs[s].push(toDigit(data.tick.quote, dps[s]));
                if (bufs[s].length > EO_TICKS) bufs[s].shift();
                const epoch = Number(data.tick.epoch || 0);
                const digit = bufs[s][bufs[s].length - 1];
                // runs of odd / even digits, counted from the live ticks
                if (digit % 2 === 1) {
                    odd_run[s] = (odd_run[s] || 0) + 1;
                    even_run[s] = 0;
                } else {
                    even_run[s] = (even_run[s] || 0) + 1;
                    odd_run[s] = 0;
                }
                (recent[s] = recent[s] || []).push({ epoch, digit });
                if (recent[s].length > 20) recent[s].shift();
                live.forEach(t => {
                    if (t.symbol === s) applyTick(t, epoch, digit);
                });
                check(s === locked || !locked);
            });

            // every market's last 1,000 ticks, all at the same time
            const failed: string[] = [];
            let loaded_count = 0;
            await Promise.all(
                symbols.map(async symbol => {
                    const m = markets.find(x => x.symbol === symbol);
                    const base = {
                        ticks_history: m.symbol,
                        adjust_start_time: 1,
                        count: EO_TICKS,
                        end: 'latest',
                        style: 'ticks',
                    };
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
                        bufs[m.symbol] = (res?.history?.prices || [])
                            .map((q: number) => toDigit(q, dps[m.symbol]))
                            .slice(-EO_TICKS);
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

    return { running, rows, status, error, traded, start, stop, limit, clearLimit: () => setLimit(null) };
};
