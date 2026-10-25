import { localize } from '@deriv-com/translations';

export default {
    text: () => [
        localize(
            'Use this block to set the loss you are willing to take in one run. When your total loss reaches this amount, the bot stops by itself and shows a message.'
        ),
        localize(
            'Example: Stop loss 10 stops the bot once your total loss in this run reaches 10 (in your account currency).'
        ),
        localize(
            'All the math is done for you. Just drag and drop this block into a stack that runs, such as Purchase conditions or Restart trading conditions.'
        ),
    ],
};
