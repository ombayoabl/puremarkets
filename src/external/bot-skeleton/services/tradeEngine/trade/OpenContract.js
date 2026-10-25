import { getRoundedNumber } from '@/components/shared';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { isFastMode } from '../utils/time-scale';
import { openContractReceived, sell } from './state/actions';

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    const contract = data.proposal_open_contract;

                    if (contract && this.hedge_open?.has(contract.contract_id)) {
                        this.handleHedgeContract(contract);
                        return;
                    }

                    if (isFastMode() && contract && this.fast_contracts?.has(contract.contract_id)) {
                        this.handleFastContract(contract);
                        return;
                    }

                    if (!contract || !this.expectedContractId(contract?.contract_id)) {
                        return;
                    }

                    this.setContractFlags(contract);

                    this.data.contract = contract;

                    broadcastContract({ accountID: api_base.account_info.loginid, ...contract });

                    if (this.isSold) {
                        this.contractId = '';
                        clearTimeout(this.transaction_recovery_timeout);
                        this.updateTotals(contract);
                        contractStatus({
                            id: 'contract.sold',
                            data: contract.transaction_ids.sell,
                            contract,
                        });

                        if (this.afterPromise) {
                            this.afterPromise();
                        }

                        this.store.dispatch(sell());
                    } else {
                        this.store.dispatch(openContractReceived());
                    }
                }
            });
            api_base.pushSubscription(subscription);
        }

        // Hedge purchase: the pair counts as ONE trade, finished when both legs are sold. The result handed to the
        // after-purchase blocks, the totals and the Martingale block is the net of the two legs.
        handleHedgeContract(contract) {
            broadcastContract({ accountID: api_base.account_info.loginid, ...contract });
            this.hedge_open.set(contract.contract_id, contract);

            const legs = [...this.hedge_open.values()];
            if (!legs.every(leg => leg && leg.is_sold)) {
                this.store.dispatch(openContractReceived());
                return;
            }

            const [first] = legs;
            const sum = key => getRoundedNumber(legs.reduce((total, leg) => total + Number(leg[key] || 0), 0), first.currency);
            const combined = {
                ...first,
                buy_price: sum('buy_price'),
                sell_price: sum('sell_price'),
                payout: sum('payout'),
                profit: sum('profit'),
                contract_type: legs.map(leg => leg.contract_type).join('+'),
                transaction_ids: { buy: first.transaction_ids.buy, sell: legs[legs.length - 1].transaction_ids.sell },
            };

            this.hedge_open = null;
            this.isSold = true;
            this.isSellAvailable = false;
            this.contractId = '';
            clearTimeout(this.transaction_recovery_timeout);
            this.data.contract = combined;
            this.updateTotals(combined);
            contractStatus({ id: 'contract.sold', data: combined.transaction_ids.sell, contract: combined });

            if (this.afterPromise) {
                this.afterPromise();
            }

            this.store.dispatch(sell());
        }

        // Fast Mode: several contracts are open at once, each one is tracked until it is sold.
        handleFastContract(contract) {
            broadcastContract({ accountID: api_base.account_info.loginid, ...contract });

            if (!contract.is_sold) return;

            this.fast_contracts.delete(contract.contract_id);
            if (this.fast_contracts.size === 0) this.contractId = '';
            this.data.contract = contract;
            this.updateTotals(contract);
            contractStatus({
                id: 'contract.sold',
                data: contract.transaction_ids.sell,
                contract,
            });
        }

        waitForAfter() {
            return new Promise(resolve => {
                this.afterPromise = resolve;
            });
        }

        setContractFlags(contract) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick } = contract;

            this.isSold = Boolean(is_sold);
            this.isSellAvailable = !this.isSold && Boolean(is_valid_to_sell);
            this.isExpired = Boolean(is_expired);
            this.hasEntryTick = Boolean(entry_tick);
        }

        expectedContractId(contractId) {
            return this.contractId && contractId === this.contractId;
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
