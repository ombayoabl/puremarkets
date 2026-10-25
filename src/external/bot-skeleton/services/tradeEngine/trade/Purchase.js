import { localize } from '@deriv-com/translations';
import { LogTypes } from '../../../constants/messages';
import { createError } from '../../../utils/error';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy, universalTradeOptionToBuy } from '../utils/helpers';
import { isFastMode, recordRequests } from '../utils/time-scale';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        // is_universal: the Contract type switcher block, which buys any contract type straight away
        purchase(contract_type, is_universal = false) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            if (isFastMode()) recordRequests(this.is_proposal_subscription_required ? 3 : 1);

            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
                const { buy } = response;

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this.contractId = buy.contract_id;
                if (isFastMode()) {
                    if (!this.fast_contracts) this.fast_contracts = new Map();
                    this.fast_contracts.set(buy.contract_id, true);
                    this.fast_last_buy = {
                        transaction_ids: { buy: buy.transaction_id },
                        buy_price: buy.buy_price,
                        sell_price: buy.buy_price,
                        currency: this.tradeOptions?.currency,
                        contract_type,
                    };
                }
                this.store.dispatch(purchaseSuccessful());

                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });
            };

            if (this.is_proposal_subscription_required && !is_universal) {
                const { id, askPrice } = this.selectProposal(contract_type);

                const action = () => api_base.api.send({ buy: id, price: askPrice });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        // if disconnected no need to resubscription (handled by live-api)
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess);
            }
            let trade_option;
            try {
                if (is_universal && this.tradeOptions.basis === 'payout') {
                    throw createError(
                        'InvalidtoBuy',
                        localize(
                            'The Contract type switcher works with a stake, not a payout, in the Trade options block.'
                        )
                    );
                }
                // a prediction from the Custom prediction setter block is used by the Contract type switcher too
                const universal_options =
                    this.custom_prediction !== undefined
                        ? { ...this.tradeOptions, prediction: this.custom_prediction }
                        : this.tradeOptions;
                trade_option = is_universal
                    ? universalTradeOptionToBuy(contract_type, universal_options)
                    : tradeOptionToBuy(contract_type, this.tradeOptions);
            } catch (e) {
                return Promise.reject(e);
            }
            const action = () => api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess);
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess);
        }
        // Hedge options block: every leg of the pair has its own prediction and barrier(s).
        setHedgeLegs(prediction_a, barrier_a, barrier2_a, prediction_b, barrier_b, barrier2_b) {
            const toNumber = v => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v));
            // barriers are offsets from the spot: +0.06 / -0.06
            const toBarrier = v => {
                const n = toNumber(v);
                if (n === undefined) return undefined;
                return n >= 0 ? `+${n}` : `${n}`;
            };
            this.hedge_legs = {
                a: { prediction: toNumber(prediction_a), barrierOffset: toBarrier(barrier_a), secondBarrierOffset: toBarrier(barrier2_a) },
                b: { prediction: toNumber(prediction_b), barrierOffset: toBarrier(barrier_b), secondBarrierOffset: toBarrier(barrier2_b) },
            };
        }

        // Hedge purchase block: buys both contracts of the pair at the same time (two buy requests sent together).
        hedgePurchase(type_a, type_b) {
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            let buys;
            try {
                if (this.tradeOptions.basis === 'payout') {
                    throw createError(
                        'InvalidtoBuy',
                        localize('The Hedge purchase works with a stake, not a payout.')
                    );
                }
                const legs = this.hedge_legs || {};
                buys = [
                    [type_a, legs.a],
                    [type_b, legs.b],
                ].map(([contract_type, leg]) =>
                    universalTradeOptionToBuy(contract_type, {
                        ...this.tradeOptions,
                        prediction: leg?.prediction,
                        barrierOffset: leg?.barrierOffset,
                        secondBarrierOffset: leg?.secondBarrierOffset,
                    })
                );
            } catch (e) {
                return Promise.reject(e);
            }

            if (isFastMode()) recordRequests(2);
            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: Number(this.tradeOptions.amount) * 2,
            });

            return Promise.allSettled(buys.map(buy => doUntilDone(() => api_base.api.send(buy)))).then(results => {
                const bought = results.filter(r => r.status === 'fulfilled').map(r => r.value.buy);
                if (!bought.length) throw results[0].reason;
                if (bought.length < results.length) {
                    globalObserver.emit(
                        'ui.log.warn',
                        localize('Only one leg of the hedge pair was bought, the other one was rejected.')
                    );
                }

                bought.forEach(buy => {
                    contractStatus({ id: 'contract.purchase_received', data: buy.transaction_id, buy });
                    log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                });

                this.contractId = bought[0].contract_id;
                if (isFastMode()) {
                    // Fast Mode tracks every contract on its own
                    if (!this.fast_contracts) this.fast_contracts = new Map();
                    bought.forEach(buy => this.fast_contracts.set(buy.contract_id, true));
                    this.fast_last_buy = {
                        transaction_ids: { buy: bought[0].transaction_id },
                        buy_price: bought.reduce((sum, buy) => sum + Number(buy.buy_price), 0),
                        sell_price: bought.reduce((sum, buy) => sum + Number(buy.buy_price), 0),
                        currency: this.tradeOptions?.currency,
                        contract_type: `${type_a}+${type_b}`,
                    };
                } else {
                    // the pair is finished when every leg is sold
                    this.hedge_open = new Map(bought.map(buy => [buy.contract_id, null]));
                }
                this.store.dispatch(purchaseSuccessful());

                delayIndex = 0;
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: bought[0].transaction_id },
                    contract_type: `${type_a}+${type_b}`,
                    buy_price: bought.reduce((sum, buy) => sum + Number(buy.buy_price), 0),
                });
            });
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
