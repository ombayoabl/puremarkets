import { localize } from '@deriv-com/translations';

export default {
    text: () => [
        localize(
            'Use this block to purchase two contracts at the exact same time (a hedge pair), for example Over and Under, or Differs and Over.'
        ),
        localize('Each drop down can select any contract type.'),
        localize(
            'This block can only be used within the Purchase conditions block and replaces the normal Purchase block.'
        ),
    ],
};
