import { localize } from '@deriv-com/translations';

export default {
    text: () => [
        localize(
            'The Contract type switcher lets your bot buy any contract type, not only the one set in the Trade parameters block. Pick the contract type from the dropdown and the bot buys exactly that contract.'
        ),
        localize(
            'Stake, duration and market still come from the Trade options block. For Over, Under, Matches, Differs and tick types, the prediction from the Trade options block is used; for Touch, No touch and range types, the barriers are used. This block can only be used within the Purchase conditions block.'
        ),
    ],
};
