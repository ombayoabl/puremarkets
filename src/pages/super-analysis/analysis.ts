// Deriv's 10 volatility indices (dp = default decimals; the API's pip_size overrides it)
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

export const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export const STRATEGIES = [
    { key: 'over_under', label: 'Over & Under' },
    { key: 'even_odd', label: 'Even & Odd' },
    { key: 'matches_differs', label: 'Matches & Differs' },
];

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Percentage of each digit 0-9 in the list. */
export const digitPercents = (digits: number[]) => {
    const counts = Array(10).fill(0);
    digits.forEach(d => (counts[d] += 1));
    const total = digits.length || 1;
    return { counts, pct: counts.map(c => (c / total) * 100) };
};

/** Current and longest run of identical symbols in a sequence. */
export const streaks = (seq: string[]) => {
    let longest = { key: '', len: 0 };
    let run = { key: '', len: 0 };
    seq.forEach(k => {
        run = k === run.key ? { key: k, len: run.len + 1 } : { key: k, len: 1 };
        if (run.len > longest.len) longest = { ...run };
    });
    return { current: run, longest };
};

export type TSignal = {
    label: string;
    contract_type: string;
    barrier?: number;
    confidence: number;
    reason: string;
};

const WINDOW = 40;
export const MIN_SIGNAL_TICKS = 30;

/**
 * Signal rules. Each one looks at how the last 40 ticks leaned and whether the last three
 * ticks agree with that lean. These describe what the market has just been doing; they cannot
 * know what the next tick will be.
 */
export const getSignal = (strategy: string, digits: number[]): TSignal | null => {
    if (digits.length < MIN_SIGNAL_TICKS) return null;
    const w = digits.slice(-WINDOW);
    const last3 = digits.slice(-3);
    const share = (f: (d: number) => boolean) => (w.filter(f).length / w.length) * 100;
    const pick = (list: TSignal[]) => list.sort((a, b) => b.confidence - a.confidence)[0] || null;

    if (strategy === 'over_under') {
        const over = share(d => d > 2);
        const under = share(d => d < 7);
        const found: TSignal[] = [];
        if (last3.every(d => d > 2) && over >= 72) {
            found.push({
                label: 'Over 2',
                contract_type: 'DIGITOVER',
                barrier: 2,
                confidence: over,
                reason: `last 3 digits above 2, ${over.toFixed(0)}% of the last ${w.length} ticks above 2`,
            });
        }
        if (last3.every(d => d < 7) && under >= 72) {
            found.push({
                label: 'Under 7',
                contract_type: 'DIGITUNDER',
                barrier: 7,
                confidence: under,
                reason: `last 3 digits below 7, ${under.toFixed(0)}% of the last ${w.length} ticks below 7`,
            });
        }
        return pick(found);
    }

    if (strategy === 'even_odd') {
        const even = share(d => d % 2 === 0);
        const odd = 100 - even;
        const found: TSignal[] = [];
        if (last3.every(d => d % 2 === 0) && even >= 58) {
            found.push({
                label: 'Even',
                contract_type: 'DIGITEVEN',
                confidence: even,
                reason: `last 3 digits even, ${even.toFixed(0)}% of the last ${w.length} ticks even`,
            });
        }
        if (last3.every(d => d % 2 === 1) && odd >= 58) {
            found.push({
                label: 'Odd',
                contract_type: 'DIGITODD',
                confidence: odd,
                reason: `last 3 digits odd, ${odd.toFixed(0)}% of the last ${w.length} ticks odd`,
            });
        }
        return pick(found);
    }

    // matches_differs: use the last 100 ticks to find the rarest and the most common digit
    const long = digits.slice(-100);
    const { pct } = digitPercents(long);
    const rare = pct.indexOf(Math.min(...pct));
    const common = pct.indexOf(Math.max(...pct));
    const found: TSignal[] = [];
    if (pct[rare] <= 7 && !last3.includes(rare)) {
        found.push({
            label: `Differs ${rare}`,
            contract_type: 'DIGITDIFF',
            barrier: rare,
            confidence: 100 - pct[rare],
            reason: `${rare} is the rarest digit (${pct[rare].toFixed(0)}% of the last ${long.length}) and has not appeared in the last 3 ticks`,
        });
    }
    if (pct[common] >= 15 && digits[digits.length - 1] === common) {
        found.push({
            label: `Matches ${common}`,
            contract_type: 'DIGITMATCH',
            barrier: common,
            confidence: pct[common],
            reason: `${common} is the most common digit (${pct[common].toFixed(0)}% of the last ${long.length}) and just appeared`,
        });
    }
    // Differs wins ties: it is the far likelier side
    return found.find(s => s.contract_type === 'DIGITDIFF') || found[0] || null;
};
