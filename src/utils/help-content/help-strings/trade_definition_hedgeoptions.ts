import { localize } from '@deriv-com/translations';

export default {
    text: () => [
        localize('Define the trade option for a hedge pair.'),
        localize(
            'Duration and stake are shared by both legs, but each leg gets its own prediction and its own barrier(s). For example, Over 5 + Under 4, or a barrier hedge of +0.06 Higher with -0.06 Lower.'
        ),
        localize(
            'When the contract type needs two barriers (Ends in/out, Stays in/out), each leg has two barrier rows.'
        ),
    ],
};
