import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../../utils';

// Custom prediction setter: sets (or changes) the prediction anywhere in the bot logic, so it can follow conditions or
// calculations instead of staying fixed in the Trade options block.
window.Blockly.Blocks.custom_prediction_setter = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Set custom prediction {{ prediction }}', { prediction: '%1' }),
            args0: [
                {
                    type: 'input_value',
                    name: 'PREDICTION',
                    check: 'Number',
                },
            ],
            colour: window.Blockly.Colours.Special3.colour,
            colourSecondary: window.Blockly.Colours.Special3.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special3.colourTertiary,
            previousStatement: null,
            nextStatement: null,
            tooltip: localize('Sets the prediction your contract type uses from now on.'),
            category: window.Blockly.Categories.Miscellaneous,
        };
    },
    meta() {
        return {
            display_name: localize('Custom prediction setter'),
            description: localize(
                'Use this block to set or modify custom prediction for your contract type anywhere in your bot logic. This allows you to dynamically change prediction value based on condition or calculations without being restricted to the Trade options block.'
            ),
            key_words: localize('prediction, digit, barrier, custom, set, change'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.custom_prediction_setter = block => {
    const prediction =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'PREDICTION',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '1';

    const code = `Bot.setCustomPrediction(${prediction});\n`;
    return code;
};
