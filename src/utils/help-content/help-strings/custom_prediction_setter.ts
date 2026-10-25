import { localize } from '@deriv-com/translations';

export default {
    text: () => [
        localize(
            'The Custom prediction setter changes the prediction (the digit or tick) your contract uses, from the moment the block runs. You can put it anywhere in your bot logic, for example in Purchase conditions or in Trade again conditions.'
        ),
        localize(
            'Drop a number, a variable or a calculation into the block, so the prediction can follow your conditions. It works with the Purchase block for contract types that use a prediction, and with the Contract type switcher block for any contract type.'
        ),
    ],
};
