import { localize } from '@deriv-com/translations';

export default {
    text: () => [
        localize(
            'The Market symbol change block switches your bot to another market in one step. From the moment it runs, new contracts are placed on that market, and every analysis block (last digit, tick list, OHLC and other indicators) reads that same market.'
        ),
        localize(
            'You can put it anywhere in your bot logic, for example to move to a different market after a loss or when a condition is met. Contracts that are already running finish on the market they were bought on.'
        ),
    ],
};
