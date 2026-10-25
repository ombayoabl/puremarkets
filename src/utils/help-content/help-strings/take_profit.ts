import { localize } from '@deriv-com/translations';

export default {
    text: () => [
        localize(
            'Use this block to set the profit you want to reach in one run. When your total profit reaches this amount, the bot stops by itself and shows a celebration message.'
        ),
        localize(
            'Example: Take profit 20 stops the bot once your total profit in this run reaches 20 (in your account currency).'
        ),
        localize(
            'Drop this block inside a stack that runs, such as Purchase conditions or Restart trading conditions. All the maths is done for you in the background.'
        ),
    ],
};
