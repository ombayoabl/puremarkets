import { localize } from '@deriv-com/translations';

export default {
    text: () => [
        localize('Returns the martingale stake.'),
        localize('On loss (Normal): the stake increases by a multiplier.'),
        localize('On win (Compounding): the stake increases by a percentage of profit.'),
        localize(
            'Split martingale calculates the stake needed to recover the total loss over a set number of runs using the contract profit percentage.'
        ),
        localize(
            'In split mode, \u201cPayout override %\u201d lets you set a custom profit percentage (e.g. 20 for 20%); leave it at 0 to use the derived contract payout automatically. The value is locked on the first trade, same as the derived payout.'
        ),
        localize(
            'Recovery continues until all set runs are completed. Setting a lower override raises the stake, so each win (settled at the real derived payout) can put you in profit before the run finishes; the bot rides every run and keeps the surplus.'
        ),
        localize('Resets to the initial stake on the opposite result.'),
    ],
};
