import { getRoundedNumber } from '@/components/shared';
import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { LogTypes } from '../../../constants/messages';
import { createError } from '../../../utils/error';
import { observer as globalObserver } from '../../../utils/observer';
import { info, log } from '../utils/broadcast';

const skeleton = {
    totalProfit: 0,
    totalWins: 0,
    totalLosses: 0,
    totalStake: 0,
    totalPayout: 0,
    totalRuns: 0,
};

const globalStat = {};

export default Engine =>
    class Total extends Engine {
        constructor() {
            super();
            this.sessionRuns = 0;
            this.sessionProfit = 0;
            this.stop_loss = undefined;
            this.take_profit = undefined;
            this.profit_limit_hit = false;
            this.settled_queue = [];
            this.martingale_state = null;

            globalObserver.register('statistics.clear', this.clearStatistics.bind(this));
        }

        clearStatistics() {
            this.sessionRuns = 0;
            this.sessionProfit = 0;
            if (!this.accountInfo) return;
            const { loginid: accountID } = this.accountInfo;
            globalStat[accountID] = { ...skeleton };
        }

        updateTotals(contract) {
            const { sell_price: sellPrice, buy_price: buyPrice, currency } = contract;

            const profit = getRoundedNumber(Number(sellPrice) - Number(buyPrice), currency);

            const win = profit > 0;

            const accountStat = this.getAccountStat();

            accountStat.totalWins += win ? 1 : 0;

            accountStat.totalLosses += !win ? 1 : 0;

            this.sessionProfit = getRoundedNumber(Number(this.sessionProfit) + Number(profit), currency);

            accountStat.totalProfit = getRoundedNumber(Number(accountStat.totalProfit) + Number(profit), currency);

            accountStat.totalStake = getRoundedNumber(Number(accountStat.totalStake) + Number(buyPrice), currency);

            accountStat.totalPayout = getRoundedNumber(Number(accountStat.totalPayout) + Number(sellPrice), currency);

            info({
                profit,
                contract,
                accountID: this.accountInfo.loginid,
                totalProfit: accountStat.totalProfit,
                totalWins: accountStat.totalWins,
                totalLosses: accountStat.totalLosses,
                totalStake: accountStat.totalStake,
                totalPayout: accountStat.totalPayout,
            });

            log(win ? LogTypes.PROFIT : LogTypes.LOST, { currency, profit });

            // Finished contracts wait here until the Martingale block reads them (oldest first).
            this.settled_queue.push({
                buy_price: Number(buyPrice),
                sell_price: Number(sellPrice),
                payout: Number(contract.payout),
                currency,
            });
            if (this.settled_queue.length > 1000) this.settled_queue.shift();

            this.checkProfitLimits();
        }

        // Martingale block: returns the stake for the next trade. All three modes reset to the
        // initial stake on the opposite result.
        getMartingaleStake(mode, initial, size, runs, payout_override) {
            const initial_stake = Number(initial) > 0 ? Number(initial) : 1;
            const multiplier = Number(size);
            const recovery_runs = Math.max(1, Math.floor(Number(runs)) || 1);
            const override_pct = Number(payout_override) > 0 ? Number(payout_override) / 100 : 0;

            if (!this.martingale_state || this.martingale_state.mode !== mode) {
                this.martingale_state = {
                    mode,
                    n_losses: 0, // normal: losses in a row
                    next_stake: null, // compounding: stake after the last win
                    in_recovery: false, // split
                    outstanding: 0,
                    runs_left: 0,
                    pct: override_pct || null, // split: profit percentage, locked on the first trade
                    last_stake: null,
                    currency: undefined,
                };
            }
            const state = this.martingale_state;
            if (mode === 'split' && !state.pct && override_pct) state.pct = override_pct;

            while (this.settled_queue.length) {
                const contract = this.settled_queue.shift();
                const profit = contract.sell_price - contract.buy_price;
                const win = profit > 0;
                state.currency = contract.currency;

                if (mode === 'normal') {
                    state.n_losses = win ? 0 : state.n_losses + 1;
                } else if (mode === 'compounding') {
                    state.next_stake = win ? contract.buy_price + (profit * (multiplier || 0)) / 100 : null;
                } else {
                    if (!state.pct) {
                        // derived contract payout (locked on the first trade)
                        if (contract.payout > contract.buy_price) {
                            state.pct = (contract.payout - contract.buy_price) / contract.buy_price;
                        } else if (win) {
                            state.pct = profit / contract.buy_price;
                        }
                    }
                    if (!win) {
                        if (!state.in_recovery) {
                            state.in_recovery = true;
                            state.outstanding = -profit;
                            state.runs_left = recovery_runs;
                        } else {
                            state.outstanding += -profit;
                        }
                    } else if (state.in_recovery) {
                        state.outstanding -= profit;
                        state.runs_left -= 1;
                        if (state.runs_left <= 0) {
                            state.in_recovery = false;
                            state.outstanding = 0;
                            state.last_stake = null;
                        }
                    }
                }
            }

            let stake = initial_stake;
            if (mode === 'normal') {
                stake = initial_stake * (multiplier > 0 ? multiplier : 1) ** state.n_losses;
            } else if (mode === 'compounding') {
                stake = state.next_stake || initial_stake;
            } else if (state.in_recovery && state.pct && state.runs_left > 0) {
                if (state.outstanding > 0) {
                    stake = Math.max(initial_stake, state.outstanding / state.runs_left / state.pct);
                    state.last_stake = stake;
                } else {
                    // already recovered: ride the remaining runs and keep the surplus
                    stake = state.last_stake || initial_stake;
                }
            }

            if (!Number.isFinite(stake) || stake <= 0) stake = initial_stake;
            return getRoundedNumber(stake, state.currency);
        }

        // Stop loss / Take profit blocks: the amounts are kept here and checked after every finished contract.
        setStopLoss(amount) {
            const value = Math.abs(Number(amount));
            this.stop_loss = value > 0 ? value : undefined;
            this.checkProfitLimits();
        }

        setTakeProfit(amount) {
            const value = Math.abs(Number(amount));
            this.take_profit = value > 0 ? value : undefined;
            this.checkProfitLimits();
        }

        checkProfitLimits() {
            if (this.profit_limit_hit) return;

            const profit = Number(this.sessionProfit);
            let kind = null;
            if (this.stop_loss && profit <= -this.stop_loss) kind = 'sl';
            else if (this.take_profit && profit >= this.take_profit) kind = 'tp';
            if (!kind) return;

            this.profit_limit_hit = true;
            globalObserver.emit('bot.profit_limit', { kind });
            globalObserver.emit('bot.click_stop'); // same as pressing the Stop button
        }

        updateAndReturnTotalRuns() {
            this.sessionRuns++;
            const accountStat = this.getAccountStat();

            return ++accountStat.totalRuns;
        }

        /* eslint-disable class-methods-use-this */
        getTotalRuns() {
            const accountStat = this.getAccountStat();
            return accountStat.totalRuns;
        }

        getTotalProfit(toString, currency) {
            const accountStat = this.getAccountStat();

            return toString && accountStat.totalProfit !== 0
                ? getRoundedNumber(+accountStat.totalProfit, currency)
                : +accountStat.totalProfit;
        }

        /* eslint-enable */
        checkLimits(tradeOption) {
            if (!tradeOption.limitations) {
                return;
            }

            const {
                limitations: { maxLoss, maxTrades },
            } = tradeOption;

            if (maxLoss && maxTrades) {
                if (this.sessionRuns >= maxTrades) {
                    throw createError('CustomLimitsReached', getLocalizedErrorMessage('MaxTradesReached'));
                }
                if (this.sessionProfit <= -maxLoss) {
                    throw createError('CustomLimitsReached', getLocalizedErrorMessage('MaxLossReached'));
                }
            }
        }

        /* eslint-disable class-methods-use-this */
        validateTradeOptions(tradeOptions) {
            const take_profit = tradeOptions.take_profit;
            const stop_loss = tradeOptions.stop_loss;

            if (take_profit) {
                tradeOptions.limit_order.take_profit = take_profit;
            }
            if (stop_loss) {
                tradeOptions.limit_order.stop_loss = stop_loss;
            }

            return tradeOptions;
        }

        getAccountStat() {
            const { loginid: accountID } = this.accountInfo;

            if (!(accountID in globalStat)) {
                globalStat[accountID] = { ...skeleton };
            }

            return globalStat[accountID];
        }
    };
