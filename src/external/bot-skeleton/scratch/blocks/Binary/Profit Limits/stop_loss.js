import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.stop_loss = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Stop loss {{ amount }}', { amount: '%1' }),
            args0: [
                {
                    type: 'input_value',
                    name: 'AMOUNT',
                    check: 'Number',
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('The bot stops when your total loss reaches this amount.'),
            category: window.Blockly.Categories.Trade_Definition,
        };
    },
    meta() {
        return {
            display_name: localize('Stop loss'),
            description: localize(
                'Set the target loss. When your total loss in this run reaches this amount, the bot stops by itself and shows a message. Drop this block inside any stack that runs (for example Purchase conditions or Restart trading conditions); all the maths is done for you in the background.'
            ),
            key_words: localize('stop loss'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.stop_loss = block => {
    const amount =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'AMOUNT',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '0';

    return `Bot.setStopLoss(${amount});\n`;
};
