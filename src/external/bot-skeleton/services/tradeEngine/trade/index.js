import { applyMiddleware, createStore } from 'redux';
import { thunk } from 'redux-thunk';
import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { createError } from '../../../utils/error';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { checkBlocksForProposalRequest, doUntilDone } from '../utils/helpers';
import { getFastRate, hasRequestBudget, isFastMode, setFastMode } from '../utils/time-scale';
import { expectInitArg } from '../utils/sanitize';
import { fastRelease, proposalsReady, start } from './state/actions';
import * as constants from './state/constants';
import rootReducer from './state/reducers';
import Balance from './Balance';
import OpenContract from './OpenContract';
import Proposal from './Proposal';
import Purchase from './Purchase';
import Sell from './Sell';
import Ticks from './Ticks';
import Total from './Total';

// The 10 volatility indices that "Change market on each run" goes round.
const MARKET_ROTATION = ['1HZ10V', 'R_10', '1HZ25V', 'R_25', '1HZ50V', 'R_50', '1HZ75V', 'R_75', '1HZ100V', 'R_100'];

// Fast Mode: only let a trade go out on a share of the ticks, and only while there is request budget left.
let fast_credit = 0;
const fastTickGate = () => {
    fast_credit += getFastRate();
    if (fast_credit < 1) return false;
    if (!hasRequestBudget()) {
        fast_credit = 1; // keep waiting for budget, trade as soon as it frees up
        return false;
    }
    fast_credit -= 1;
    return true;
};

const watchBefore = store =>
    watchScope({
        store,
        stopScope: constants.DURING_PURCHASE,
        passScope: constants.BEFORE_PURCHASE,
        passFlag: 'proposalsReady',
        gate: isFastMode() ? fastTickGate : null,
    });

const watchDuring = store => {
    if (isFastMode()) {
        // Do not wait for the contract to finish: hand control straight back so the next trade can follow.
        if (store.getState().scope === constants.DURING_PURCHASE) {
            store.dispatch(fastRelease());
        }
        return Promise.resolve(false);
    }
    return watchDuringScope(store);
};

const watchDuringScope = store =>
    watchScope({
        store,
        stopScope: constants.STOP,
        passScope: constants.DURING_PURCHASE,
        passFlag: 'openContract',
    });

/* The watchScope function is called randomly and resets the prevTick
 * which leads to the same problem we try to solve. So prevTick is isolated
 */
let prevTick;
const watchScope = ({ store, stopScope, passScope, passFlag, gate }) => {
    // in case watch is called after stop is fired
    if (store.getState().scope === stopScope) {
        return Promise.resolve(false);
    }
    return new Promise(resolve => {
        const unsubscribe = store.subscribe(() => {
            const newState = store.getState();

            if (newState.newTick === prevTick) return;
            prevTick = newState.newTick;
            const is_gate_open = gate ? gate() : true;

            if (newState.scope === passScope && newState[passFlag] && is_gate_open) {
                unsubscribe();
                resolve(true);
            }

            if (newState.scope === stopScope) {
                unsubscribe();
                resolve(false);
            }
        });
    });
};

export default class TradeEngine extends Balance(Purchase(Sell(OpenContract(Proposal(Ticks(Total(class {}))))))) {
    constructor($scope) {
        super();
        this.observer = $scope.observer;
        this.$scope = $scope;
        this.observe();
        this.data = {
            contract: {},
            proposals: [],
        };
        this.subscription_id_for_accumulators = null;
        this.is_proposal_requested_for_accumulators = false;
        this.store = createStore(rootReducer, applyMiddleware(thunk));
    }

    init(...args) {
        const [token, options] = expectInitArg(args);
        const { symbol } = options;

        this.initArgs = args;
        this.options = options;
        setFastMode(options.fastMode);
        this.fast_contracts = new Map();
        this.market_rotation = null;
        this.market_rotation_index = 0;
        this.market_run_started = false;
        this.startPromise = this.loginAndGetBalance(token);

        if (!this.checkTicksPromiseExists()) this.watchTicks(symbol);

        if (options.changeMarket) {
            this.market_rotation = [symbol, ...MARKET_ROTATION.filter(s => s !== symbol)];
            this.symbol = symbol;
            this.market_rotation.forEach(s => this.ensureMarketMonitored(s));
        }
    }

    // Change market on each run: the first run uses the selected market, every run after that moves to the
    // next of the 10 volatilities, and after the last it starts again from the first (merry-go-round).
    rotateMarket() {
        const rotation = this.market_rotation;
        if (!rotation?.length) return;

        if (this.market_run_started) {
            this.market_rotation_index = (this.market_rotation_index + 1) % rotation.length;
        }
        this.market_run_started = true;

        const symbol = rotation[this.market_rotation_index];
        this.options.symbol = symbol;
        this.symbol = symbol;
        this.ensureMarketMonitored(symbol);
    }

    start(tradeOptions) {
        if (!this.options) {
            throw createError('NotInitialized', getLocalizedErrorMessage('NotInitialized'));
        }

        globalObserver.emit('bot.running');

        if (this.options.changeMarket) this.rotateMarket();

        const validated_trade_options = this.validateTradeOptions(tradeOptions);

        this.tradeOptions = { ...validated_trade_options, symbol: this.options.symbol };
        this.store.dispatch(start());
        this.checkLimits(validated_trade_options);

        this.makeDirectPurchaseDecision();
    }

    loginAndGetBalance(token) {
        if (this.token === token) {
            return Promise.resolve();
        }
        // for strategies using total runs, GetTotalRuns function is trying to get loginid and it gets called before Proposals calls.
        // the below required loginid to be set in Proposal calls where loginAndGetBalance gets resolved.
        // Earlier this used to happen as soon as we get ticks_history response and by the time GetTotalRuns gets called we have required info.
        this.accountInfo = api_base.account_info;
        this.token = api_base.token;
        return new Promise(resolve => {
            // Try to recover from a situation where API doesn't give us a correct response on
            // "proposal_open_contract" which would make the bot run forever. When there's a "sell"
            // event, wait a couple seconds for the API to give us the correct "proposal_open_contract"
            // response, if there's none after x seconds. Send an explicit request, which _should_
            // solve the issue. This is a backup!
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'transaction' && data.transaction.action === 'sell') {
                    this.transaction_recovery_timeout = setTimeout(() => {
                        const { contract } = this.data;
                        const is_same_contract = contract.contract_id === data.transaction.contract_id;
                        const is_open_contract = contract.status === 'open';
                        if (is_same_contract && is_open_contract) {
                            doUntilDone(() => {
                                api_base.api.send({ proposal_open_contract: 1, contract_id: contract.contract_id });
                            }, ['PriceMoved']);
                        }
                    }, 1500);
                }
                resolve();
            });
            api_base.pushSubscription(subscription);
        });
    }

    observe() {
        this.observeOpenContract();
        this.observeBalance();
        this.observeProposals();
    }

    watch(watchName) {
        if (watchName === 'before') {
            return watchBefore(this.store);
        }
        if (isFastMode()) this.prepareFastResult();
        return watchDuring(this.store);
    }

    // Fast Mode: after-purchase blocks read the last finished contract. Before any contract has finished
    // there is none yet, so use a neutral placeholder (counts as a win, same stake) instead of failing.
    prepareFastResult() {
        if (this.data.contract?.transaction_ids || !this.fast_last_buy) return;
        this.data.contract = this.fast_last_buy;
    }

    makeDirectPurchaseDecision() {
        const { has_payout_block, is_basis_payout } = checkBlocksForProposalRequest();
        this.is_proposal_subscription_required = has_payout_block || is_basis_payout;

        if (this.is_proposal_subscription_required) {
            this.makeProposals({ ...this.options, ...this.tradeOptions });
            this.checkProposalReady();
        } else {
            this.store.dispatch(proposalsReady());
        }
    }
}
