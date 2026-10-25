// Fast Mode: the bot does not wait for the previous contract to finish. It places the next trade
// on a share of the incoming ticks while earlier contracts are still open (pipelined trading).
// Share of ticks a trade goes out on (was 0.4, now 30% faster = 0.52; Market Insights fast mode uses 0.525).
export const FAST_BOT_RATE = 0.52;

let is_fast_mode = false;

export const setFastMode = enabled => {
    is_fast_mode = !!enabled;
};

export const isFastMode = () => is_fast_mode;
