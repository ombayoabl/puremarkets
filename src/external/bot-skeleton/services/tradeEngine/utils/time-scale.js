// Fast Mode: the bot does not wait for the previous contract to finish. It places the next trade
// on a share of the incoming ticks while earlier contracts are still open (pipelined trading).
//
// Share of ticks a trade goes out on (Market Insights fast mode uses 0.525).
export const FAST_BOT_RATE = 0.52;

// Deriv shares one request budget between proposal, proposal_open_contract, buy and sell:
// 360 per minute and 14,400 per hour. Fast Mode stays at 75% of it, leaving room for the
// bot's other requests and for other tabs/bots on the same account.
const BUDGET_WINDOWS = [
    { ms: 60 * 1000, limit: 360 },
    { ms: 60 * 60 * 1000, limit: 14400 },
];
const BUDGET_SAFETY = 0.75;

// Requests one fast trade can cost: 1 buy + up to 2 proposals (when proposals are subscribed).
export const FAST_TRADE_COST = 3;

let is_fast_mode = false;
let request_log = []; // { t, cost } for requests counted against the shared budget

// Adaptive slow-down: a RateLimit error from Deriv halves the speed, then it creeps back up.
let rate_factor = 1;
let last_factor_change = 0;
const RECOVER_EVERY_MS = 20 * 1000;
const MIN_RATE_FACTOR = 0.2;

export const setFastMode = enabled => {
    is_fast_mode = !!enabled;
    request_log = [];
    rate_factor = 1;
};

export const isFastMode = () => is_fast_mode;

const prune = now => {
    const oldest = now - BUDGET_WINDOWS[BUDGET_WINDOWS.length - 1].ms;
    request_log = request_log.filter(r => r.t >= oldest);
};

// Count requests that draw on Deriv's shared budget (buy, proposal ...).
export const recordRequests = (cost = 1) => {
    const now = Date.now();
    prune(now);
    request_log.push({ t: now, cost });
};

// True when `cost` more requests still fit inside the safe part of every window.
export const hasRequestBudget = (cost = FAST_TRADE_COST) => {
    const now = Date.now();
    prune(now);
    return BUDGET_WINDOWS.every(({ ms, limit }) => {
        const used = request_log.reduce((sum, r) => (r.t >= now - ms ? sum + r.cost : sum), 0);
        return used + cost <= limit * BUDGET_SAFETY;
    });
};

// Called whenever Deriv answers with a RateLimit error.
export const reportRateLimit = () => {
    rate_factor = Math.max(MIN_RATE_FACTOR, rate_factor * 0.5);
    last_factor_change = Date.now();
};

// Share of ticks to trade on right now (slower right after a rate-limit error, then recovering).
export const getFastRate = () => {
    const now = Date.now();
    if (rate_factor < 1 && now - last_factor_change >= RECOVER_EVERY_MS) {
        rate_factor = Math.min(1, rate_factor * 1.25);
        last_factor_change = now;
    }
    return FAST_BOT_RATE * rate_factor;
};
