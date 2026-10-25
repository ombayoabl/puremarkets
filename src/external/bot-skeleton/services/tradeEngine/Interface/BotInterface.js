import { observer as globalObserver } from '../../../utils/observer';
import { createDetails } from '../utils/helpers';

const getBotInterface = tradeEngine => {
    const getDetail = i => createDetails(tradeEngine.data.contract)[i];

    return {
        init: (...args) => tradeEngine.init(...args),
        start: (...args) => tradeEngine.start(...args),
        stop: (...args) => tradeEngine.stop(...args),
        purchase: (contract_type, is_universal) => tradeEngine.purchase(contract_type, is_universal),
        setCustomPrediction: value => tradeEngine.setCustomPrediction(value),
        changeMarketSymbol: symbol => tradeEngine.changeMarketSymbol(symbol),
        hedgePurchase: (type_a, type_b) => tradeEngine.hedgePurchase(type_a, type_b),
        setHedgeLegs: (...args) => tradeEngine.setHedgeLegs(...args),
        setStopLoss: amount => tradeEngine.setStopLoss(amount),
        setTakeProfit: amount => tradeEngine.setTakeProfit(amount),
        getMartingaleStake: (mode, initial, size, runs, payout) =>
            tradeEngine.getMartingaleStake(mode, initial, size, runs, payout),
        getAskPrice: contract_type => Number(getProposal(contract_type, tradeEngine).ask_price),
        getPayout: contract_type => Number(getProposal(contract_type, tradeEngine).payout),
        getPurchaseReference: () => tradeEngine.getPurchaseReference(),
        isSellAvailable: () => tradeEngine.isSellAtMarketAvailable(),
        sellAtMarket: () => tradeEngine.sellAtMarket(),
        getSellPrice: () => getSellPrice(tradeEngine),
        isResult: result => getDetail(10) === result,
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        readDetails: i => getDetail(i - 1),
    };
};

const getProposal = (contract_type, tradeEngine) => {
    return tradeEngine.data.proposals.find(
        proposal =>
            proposal.contract_type === contract_type &&
            proposal.purchase_reference === tradeEngine.getPurchaseReference()
    );
};

const getSellPrice = tradeEngine => {
    return tradeEngine.getSellPrice();
};

export default getBotInterface;
