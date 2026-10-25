// @ts-nocheck — uses the shared Deriv API connection (api_base), which is loosely typed upstream
import { api_base } from '@/external/bot-skeleton';

export const MARKETS = [
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

// ---- Over1 / Under8 strategy ----
// Signal "Under 8": digits 8 and 9 are each at or below 10%. Among the markets that qualify, the best entry
// is the one with the lowest 8 + 9 total. (The ↑/↓ arrows compare the latest window with the same-size window
// that ended LOOKBACK ticks earlier; they are shown for information only.)
export const LOW_LIMIT = 10;
export const LOOKBACK = 100;
export const MAX_DEPTH = 5000;

// ---- Over 1 strategy ----
// Signal "Over 1": the highest (green) bar is on digit 5-9 and is 10.5% or more, and the lowest (red) bar is 9% or less.
// The bot then waits for the last digit to be 0 or 1 before each Over 1.
export const O1_GREEN_MIN = 10.5;
export const O1_RED_MAX = 9;

export type Kind = 'under8' | 'over1';

export type MarketScan = {
    symbol: string;
    name: string;
    p8: number;
    p9: number;
    before8: number;
    before9: number;
    low: boolean; // 8 and 9 at or below the limit
    falling: boolean; // both decreasing
    signal: boolean;
    o1: boolean; // Over 1 signal
    o1_hi: number; // digit of the green bar
    o1_lo: number; // digit of the red bar
    o1_hi_pct: number;
    o1_lo_pct: number;
    kind?: Kind; // which strategy this market was picked for
};

export const toDigit = (quote: number | string, dp: number) => Number(Number(quote).toFixed(dp).slice(-1));
const share = (digits: number[], d: number) => {
    if (!digits.length) return 0;
    let n = 0;
    for (const x of digits) if (x === d) n += 1;
    return (n / digits.length) * 100;
};
const shown = (v: number) => Number(v.toFixed(1));

export const analyse = (digits: number[], depth: number) => {
    const now = digits.slice(-depth);
    const earlier = digits.slice(0, Math.max(0, digits.length - LOOKBACK)).slice(-depth);
    const p8 = shown(share(now, 8));
    const p9 = shown(share(now, 9));
    const before8 = shown(share(earlier, 8));
    const before9 = shown(share(earlier, 9));
    const low = p8 <= LOW_LIMIT && p9 <= LOW_LIMIT;
    const falling = earlier.length >= depth && p8 < before8 && p9 < before9;
    // a market is a candidate whenever 8 and 9 are both at or below the limit; the best entry is picked later
    const pct = Array.from({ length: 10 }, (_, d) => shown(share(now, d)));
    let hi = 0;
    let lo = 0;
    pct.forEach((v, d) => {
        if (v > pct[hi]) hi = d;
        if (v < pct[lo]) lo = d;
    });
    const o1 = now.length > 0 && hi >= 5 && pct[hi] >= O1_GREEN_MIN && pct[lo] <= O1_RED_MAX;
    return {
        p8,
        p9,
        before8,
        before9,
        low,
        falling,
        signal: low,
        o1,
        o1_hi: hi,
        o1_lo: lo,
        o1_hi_pct: pct[hi],
        o1_lo_pct: pct[lo],
    };
};

// Scan all 10 volatilities at once (one history request each, all sent together).
export const scanAllMarkets = async (depth: number, onProgress?: (done: number) => void): Promise<MarketScan[]> => {
    if (!api_base.api) throw new Error('Connecting to live markets… try again in a moment.');
    const count = Math.min(MAX_DEPTH, depth + LOOKBACK);
    let done = 0;
    const out = await Promise.all(
        MARKETS.map(async m => {
            try {
                const res = await api_base.api.send({
                    ticks_history: m.symbol,
                    adjust_start_time: 1,
                    count,
                    end: 'latest',
                    style: 'ticks',
                });
                const dp = res?.pip_size !== undefined ? Number(res.pip_size) : m.dp;
                const digits = (res?.history?.prices || []).map((q: number) => toDigit(q, dp));
                return { symbol: m.symbol, name: m.name, ...analyse(digits, depth) } as MarketScan;
            } catch (e) {
                return null;
            } finally {
                done += 1;
                onProgress?.(done);
            }
        })
    );
    return out.filter(Boolean) as MarketScan[];
};

// How many percentage points a market clears each strategy's own limit (negative or no signal = not a candidate).
export const over1Margin = (m: MarketScan) => Math.min(m.o1_hi_pct - O1_GREEN_MIN, O1_RED_MAX - m.o1_lo_pct);
export const under8Margin = (m: MarketScan) => Math.min(LOW_LIMIT - m.p8, LOW_LIMIT - m.p9);

// One scan analyses every market for both strategies at the same time. This gives the strongest market of each
// strategy and the favoured one, ranked on the same scale (margin over the strategy's own limit), so neither
// strategy is favoured by default.
export const analyseSignals = (list: MarketScan[]) => {
    const o1 = list.filter(m => m.o1).sort((a, b) => over1Margin(b) - over1Margin(a))[0] || null;
    const u8 = list.filter(m => m.signal).sort((a, b) => under8Margin(b) - under8Margin(a))[0] || null;
    let best: MarketScan | null = null;
    if (o1 && (!u8 || over1Margin(o1) >= under8Margin(u8))) best = { ...o1, kind: 'over1' };
    else if (u8) best = { ...u8, kind: 'under8' };
    return { o1, u8, best };
};

export const pickBest = (list: MarketScan[]): MarketScan | null => analyseSignals(list).best;

// Resolves true once the last digit on `symbol` has been 0 or 1 `hits` times in a row; false when cancelled.
export const waitForLowDigit = (symbol: string, hits: number, dp0: number, isCancelled: () => boolean) =>
    new Promise<boolean>(resolve => {
        let done = false;
        let streak = 0;
        let dp = dp0;
        let sub_id = '';
        const finish = (v: boolean) => {
            if (done) return;
            done = true;
            clearInterval(poll);
            msg.unsubscribe();
            if (sub_id) api_base.api.send({ forget: sub_id }).catch(() => {});
            resolve(v);
        };
        const msg = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data?.msg_type !== 'tick' || data.tick?.symbol !== symbol) return;
            if (data.tick.pip_size !== undefined) dp = Number(data.tick.pip_size);
            const d = toDigit(data.tick.quote, dp);
            streak = d === 0 || d === 1 ? streak + 1 : 0;
            if (streak >= hits) finish(true);
        });
        const poll = setInterval(() => {
            if (isCancelled()) finish(false);
        }, 300);
        api_base.api
            .send({ ticks: symbol, subscribe: 1 })
            .then((r: any) => {
                sub_id = r?.subscription?.id || '';
                if (done && sub_id) api_base.api.send({ forget: sub_id }).catch(() => {});
            })
            .catch(() => {
                // already streamed by another page: the ticks still reach us
            });
    });
