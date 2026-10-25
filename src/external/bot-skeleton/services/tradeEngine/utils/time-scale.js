// Fast Mode: the bot does not wait for the previous contract to finish. It places the next trade
// on a share of the incoming ticks while earlier contracts are still open (pipelined trading).
// Market Insights fast mode trades on 52.5% of ticks; the bot's Fast Mode is slightly slower (40%)
// so Deriv's rate limit is not hit.
export const FAST_BOT_RATE = 0.4;

let is_fast_mode = false;

export const setFastMode = enabled => {
    is_fast_mode = !!enabled;
};

export const isFastMode = () => is_fast_mode;
