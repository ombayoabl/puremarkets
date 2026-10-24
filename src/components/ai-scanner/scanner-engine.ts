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
// Signal "Under 8": digits 8 and 9 are each at or below 10% AND both are decreasing.
// "Decreasing" = the digit's share over the latest window is lower than its share over the same-size
// window that ended LOOKBACK ticks earlier.
export const LOW_LIMIT = 10;
export const LOOKBACK = 100;
export const MAX_DEPTH = 5000;

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
};

const toDigit = (quote: number | string, dp: number) => Number(Number(quote).toFixed(dp).slice(-1));
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
    return { p8, p9, before8, before9, low, falling, signal: low && falling };
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

// best market = the one with the lowest 8 + 9 share among those with a signal
export const pickBest = (list: MarketScan[]) =>
    list.filter(m => m.signal).sort((a, b) => a.p8 + a.p9 - (b.p8 + b.p9))[0] || null;
