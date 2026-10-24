// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { batch_lanes } from '@/pages/bulk-trader/batch-sockets';
import LimitPopup, { LimitKind } from '@/components/limit-popup/limit-popup';
import type { MarketScan } from './scanner-engine';

const MAIN_DIGIT = 8; // Under 8
const RECOVERY_DIGIT = 5; // Under 5 after a loss
const round2 = (n: number) => Math.round(n * 100) / 100;
const errMsg = (e: any) => e?.error?.message || e?.message || 'Something went wrong';

type Props = {
    open: boolean;
    market: MarketScan | null;
    onClose: () => void;
    onRunningChange: (running: boolean) => void;
    onFinished: () => void; // a run ended (Stop, take profit or stop loss): the found signal is cleared
};

// The bot lives here for as long as the widget is on the page; closing the window does not stop it.
const ScannerBot = observer(({ open, market, onClose, onRunningChange, onFinished }: Props) => {
    const { client, transactions } = useStore();
    const currency = client?.currency || 'USD';

    const [stake, setStake] = useState('5');
    const [martingale, setMartingale] = useState('2');
    const [tp_on, setTpOn] = useState(true);
    const [take_profit, setTakeProfit] = useState('100');
    const [sl_on, setSlOn] = useState(true);
    const [stop_loss, setStopLoss] = useState('100');
    const [limit, setLimit] = useState<LimitKind>(null);
    const [running, setRunning] = useState(false);
    const [pl, setPl] = useState({ n: 0, wins: 0, total: 0 });
    const [status, setStatus] = useState('Ready. Enter your stake and martingale, then press Run.');
    const [error, setError] = useState('');
    const run_id = useRef(0);
    const bot_market = useRef<MarketScan | null>(null);

    useEffect(() => {
        onRunningChange(running);
    }, [running, onRunningChange]);

    // stop when the page goes away
    useEffect(
        () => () => {
            run_id.current += 1;
        },
        []
    );

    // buy one 1-tick contract and wait until it is sold
    const trade = useCallback(
        (symbol: string, barrier: number, amount: number, my_run: number) =>
            new Promise<number>(async (resolve, reject) => {
                try {
                    const res = await batch_lanes.sendFast(
                        {
                            buy: '1',
                            price: Number(amount),
                            parameters: {
                                amount,
                                basis: 'stake',
                                contract_type: 'DIGITUNDER',
                                barrier: String(barrier),
                                currency,
                                duration: 1,
                                duration_unit: 't',
                                underlying_symbol: symbol,
                            },
                        },
                        r => api_base.api.send(r)
                    );
                    const cid = res.buy.contract_id;
                    let finished = false;
                    let sub_id = '';
                    const handle = (poc: any) => {
                        if (finished || !poc || poc.contract_id !== cid) return;
                        try {
                            transactions?.onBotContractEvent?.(poc);
                        } catch (e) {
                            // the side panel is optional
                        }
                        if (!poc.is_sold) return;
                        finished = true;
                        cleanup();
                        resolve(Number(poc.profit));
                    };
                    const msg = api_base.api.onMessage().subscribe(({ data }: any) => {
                        if (data?.msg_type === 'proposal_open_contract') handle(data.proposal_open_contract);
                    });
                    const poll = setInterval(() => {
                        api_base.api
                            .send({ proposal_open_contract: 1, contract_id: cid })
                            .then((r: any) => handle(r?.proposal_open_contract))
                            .catch(() => {});
                    }, 1000);
                    const timeout = setTimeout(() => {
                        if (finished) return;
                        finished = true;
                        cleanup();
                        reject(new Error('The trade took too long to finish.'));
                    }, 90000);
                    const cleanup = () => {
                        msg.unsubscribe();
                        clearInterval(poll);
                        clearTimeout(timeout);
                        if (sub_id) api_base.api.send({ forget: sub_id }).catch(() => {});
                    };
                    api_base.api
                        .send({ proposal_open_contract: 1, contract_id: cid, subscribe: 1 })
                        .then((r: any) => {
                            sub_id = r?.subscription?.id || '';
                            if (finished && sub_id) api_base.api.send({ forget: sub_id }).catch(() => {});
                            handle(r?.proposal_open_contract);
                        })
                        .catch(() => {});
                } catch (e) {
                    reject(e);
                }
            }),
        [currency, transactions]
    );

    const run = async () => {
        const m = market;
        if (!m) {
            setError('Scan first so the bot knows which market to trade.');
            return;
        }
        if (!client?.is_logged_in) {
            setError('Please log in to trade.');
            return;
        }
        const base = Number(stake);
        const mult = Number(martingale);
        if (!(base >= 0.35)) {
            setError('Minimum stake is 0.35.');
            return;
        }
        if (!(mult >= 1)) {
            setError('Martingale must be 1 or more.');
            return;
        }
        const tp = tp_on ? Number(take_profit) : 0;
        const sl = sl_on ? Number(stop_loss) : 0;
        if ((tp_on && !(tp > 0)) || (sl_on && !(sl > 0))) {
            setError('Take profit and stop loss must be more than 0 (or untick them).');
            return;
        }
        setError('');
        setLimit(null);
        run_id.current += 1;
        const my_run = run_id.current;
        bot_market.current = m;
        setRunning(true);
        setPl({ n: 0, wins: 0, total: 0 });
        batch_lanes.warm(1);
        let losses = 0;
        let n = 0;
        let wins = 0;
        let total = 0;
        try {
            while (run_id.current === my_run) {
                const recovering = losses > 0;
                const barrier = recovering ? RECOVERY_DIGIT : MAIN_DIGIT;
                const amount = recovering ? round2(base * Math.pow(mult, losses)) : base;
                setStatus(
                    `${recovering ? 'Recovery' : 'Trading'}: Under ${barrier} on ${m.name}, stake ${amount.toFixed(2)} ${currency}`
                );
                const profit = await trade(m.symbol, barrier, amount, my_run);
                n += 1;
                total = round2(total + profit);
                if (profit >= 0) {
                    wins += 1;
                    losses = 0;
                } else {
                    losses += 1;
                }
                setPl({ n, wins, total });
                if (tp > 0 && total >= tp) {
                    run_id.current += 1; // ends the loop: the bot stops by itself
                    setLimit('tp');
                    setStatus('Take profit reached. Trading stopped.');
                    return;
                }
                if (sl > 0 && total <= -sl) {
                    run_id.current += 1;
                    setLimit('sl');
                    setStatus('Stop loss reached. Trading stopped.');
                    return;
                }
            }
            setStatus('Stopped.');
        } catch (e) {
            setError(errMsg(e));
            setStatus('Stopped because of an error.');
        } finally {
            if (run_id.current === my_run) run_id.current += 1;
            setRunning(false);
            setPl({ n: 0, wins: 0, total: 0 }); // the box is cleared; the trades stay in Bot Builder > Transactions
            onFinished();
        }
    };

    // closing the take profit / stop loss popup clears the result from the box, ready for the next run
    const clearLimit = () => {
        setLimit(null);
        setPl({ n: 0, wins: 0, total: 0 });
        setStatus('Ready. Scan for a market, then press Run.');
        setError('');
    };

    const stop = () => {
        run_id.current += 1;
        setStatus('Stopping after the current trade…');
    };

    const shown_market = running ? bot_market.current : market;

    return (
        <>
            {createPortal(<LimitPopup kind={limit} onClose={clearLimit} z_index={2147483100} />, document.body)}
            {open && (
                <div className='scanner-panel__backdrop' onClick={onClose}>
                    <div
                        className='scanner-panel'
                        role='dialog'
                        aria-label='Scanner Bot'
                        onClick={e => e.stopPropagation()}
                    >
                        <div className='scanner-panel__header'>
                            <h2>Scanner Bot</h2>
                            <button type='button' className='scanner-panel__close' onClick={onClose} aria-label='Close'>
                                <svg
                                    width='22'
                                    height='22'
                                    viewBox='0 0 24 24'
                                    fill='none'
                                    stroke='currentColor'
                                    strokeWidth='2'
                                    strokeLinecap='round'
                                >
                                    <path d='M4 4l16 16M20 4L4 20' />
                                </svg>
                            </button>
                        </div>
                        <div className='scanner-panel__body'>
                            <div className='scanner-panel__card scanner-panel__row2'>
                                <div>
                                    <label>MARKET</label>
                                    <div className='scanner-panel__box'>{shown_market?.name || 'Scan first'}</div>
                                </div>
                                <div>
                                    <label>TRADE</label>
                                    <div className='scanner-panel__box'>Under 8 · recovery Under 5</div>
                                </div>
                            </div>

                            <div className='scanner-panel__card scanner-panel__row2'>
                                <div>
                                    <label>STAKE ({currency})</label>
                                    <input
                                        className='scanner-panel__input'
                                        inputMode='decimal'
                                        value={stake}
                                        disabled={running}
                                        onChange={e => setStake(e.target.value.replace(/[^\d.]/g, ''))}
                                    />
                                </div>
                                <div>
                                    <label>MARTINGALE</label>
                                    <input
                                        className='scanner-panel__input'
                                        inputMode='decimal'
                                        value={martingale}
                                        disabled={running}
                                        onChange={e => setMartingale(e.target.value.replace(/[^\d.]/g, ''))}
                                    />
                                </div>
                            </div>

                            <div className='scanner-panel__card scanner-panel__row2'>
                                <div>
                                    <label className='scanner-panel__check'>
                                        <input
                                            type='checkbox'
                                            checked={tp_on}
                                            disabled={running}
                                            onChange={e => setTpOn(e.target.checked)}
                                        />
                                        TAKE PROFIT
                                    </label>
                                    <input
                                        className='scanner-panel__input'
                                        inputMode='decimal'
                                        value={take_profit}
                                        disabled={running || !tp_on}
                                        onChange={e => setTakeProfit(e.target.value.replace(/[^\d.]/g, ''))}
                                    />
                                </div>
                                <div>
                                    <label className='scanner-panel__check'>
                                        <input
                                            type='checkbox'
                                            checked={sl_on}
                                            disabled={running}
                                            onChange={e => setSlOn(e.target.checked)}
                                        />
                                        STOP LOSS
                                    </label>
                                    <input
                                        className='scanner-panel__input'
                                        inputMode='decimal'
                                        value={stop_loss}
                                        disabled={running || !sl_on}
                                        onChange={e => setStopLoss(e.target.value.replace(/[^\d.]/g, ''))}
                                    />
                                </div>
                            </div>

                            <div className='scanner-panel__card scanner-panel__row3 scanner-panel__stats'>
                                <div className='scanner-panel__field'>
                                    <label>TRADES</label>
                                    <strong>{pl.n}</strong>
                                </div>
                                <div className='scanner-panel__field'>
                                    <label>WINS</label>
                                    <strong>{pl.wins}</strong>
                                </div>
                                <div className='scanner-panel__field'>
                                    <label>PROFIT / LOSS</label>
                                    <strong className={pl.total < 0 ? 'is-loss' : pl.total > 0 ? 'is-win' : ''}>
                                        {pl.total.toFixed(2)}
                                    </strong>
                                </div>
                            </div>

                            <div className='scanner-panel__card scanner-panel__status'>{status}</div>
                            {error && <div className='scanner-panel__card scanner-panel__error'>{error}</div>}

                            <div className='scanner-panel__actions'>
                                {running ? (
                                    <button
                                        type='button'
                                        className='scanner-panel__btn scanner-panel__btn--stop'
                                        onClick={stop}
                                    >
                                        Stop
                                    </button>
                                ) : (
                                    <button
                                        type='button'
                                        className='scanner-panel__btn scanner-panel__btn--primary'
                                        onClick={run}
                                    >
                                        Run
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
});

export default ScannerBot;
