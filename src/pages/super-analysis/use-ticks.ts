// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { localize } from '@deriv-com/translations';

export type TTick = { q: number; d: number; n: number };

export const toDigit = (quote: number | string, dp: number) => Number(Number(quote).toFixed(dp).slice(-1));
export const errMsg = (e: any) => e?.error?.message || e?.message || localize('Something went wrong');

const STALE_AFTER_MS = 12000;

/**
 * Live ticks for one market: the last `count` quotes (with their last digit) from history,
 * then every new tick as it arrives. `n` is a running tick number so callers can react to
 * "a new tick came in" even though the list length stays fixed at `count`.
 */
export const useTicks = (symbol: string, default_dp: number, count: number) => {
    const [ticks, setTicks] = useState<TTick[]>([]);
    const [dp, setDp] = useState<number>(default_dp);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const sub_id = useRef('');
    const last_at = useRef(Date.now());
    const counter = useRef(0);

    useEffect(() => {
        let cancelled = false;
        let msg_sub: { unsubscribe: () => void } | null = null;
        let pip = default_dp;
        setTicks([]);
        setDp(default_dp);
        setError('');
        last_at.current = Date.now();

        const start = async () => {
            if (!api_base.api) {
                setError(localize('Connecting to live markets…'));
                setTimeout(() => !cancelled && setRetry(r => r + 1), 1500);
                return;
            }
            msg_sub = api_base.api.onMessage().subscribe(({ data }: any) => {
                if (data?.msg_type !== 'tick' || data.tick?.symbol !== symbol) return;
                if (data.tick.pip_size !== undefined) {
                    pip = Number(data.tick.pip_size);
                    setDp(pip);
                }
                last_at.current = Date.now();
                const q = Number(data.tick.quote);
                counter.current += 1;
                const n = counter.current;
                setTicks(prev => [...prev, { q, d: toDigit(q, pip), n }].slice(-count));
            });

            const base_request = {
                ticks_history: symbol,
                adjust_start_time: 1,
                count,
                end: 'latest',
                style: 'ticks',
            };
            try {
                let res;
                try {
                    res = await api_base.api.send({ ...base_request, subscribe: 1 });
                    sub_id.current = res?.subscription?.id || '';
                } catch (e) {
                    // Another part of the app (chart, Bulk Trader, a bot) already streams this market:
                    // just read the history, new ticks still reach us through onMessage.
                    if (e?.error?.code !== 'AlreadySubscribed') throw e;
                    res = await api_base.api.send(base_request);
                }
                if (cancelled) return;
                if (res?.pip_size !== undefined) {
                    pip = Number(res.pip_size);
                    setDp(pip);
                }
                const prices = res?.history?.prices || [];
                setTicks(
                    prices
                        .map((p: number) => {
                            counter.current += 1;
                            return { q: Number(p), d: toDigit(p, pip), n: counter.current };
                        })
                        .slice(-count)
                );
                last_at.current = Date.now();
            } catch (e) {
                if (!cancelled) setError(errMsg(e));
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, count, retry]);

    // If another screen that owned the stream stopped it, no ticks arrive any more: subscribe again.
    useEffect(() => {
        const t = setInterval(() => {
            if (api_base.api && Date.now() - last_at.current > STALE_AFTER_MS) {
                last_at.current = Date.now();
                setRetry(r => r + 1);
            }
        }, 5000);
        return () => clearInterval(t);
    }, []);

    return { ticks, dp, error };
};
