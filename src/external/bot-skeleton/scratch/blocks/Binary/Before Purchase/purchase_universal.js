import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

// Contract type switcher: buys ANY contract type, not only the ones allowed by the Trade parameters block.
// [contract_type, label] pairs; the label is what the dropdown shows.
export const getUniversalContractTypeOptions = () => [
    [localize('Rise / Higher'), 'CALL'],
    [localize('Fall / Lower'), 'PUT'],
    [localize('Rise (equal allowed)'), 'CALLE'],
    [localize('Fall (equal allowed)'), 'PUTE'],
    [localize('Touch'), 'ONETOUCH'],
    [localize('No touch'), 'NOTOUCH'],
    [localize('Matches'), 'DIGITMATCH'],
    [localize('Differs'), 'DIGITDIFF'],
    [localize('Even'), 'DIGITEVEN'],
    [localize('Odd'), 'DIGITODD'],
    [localize('Over'), 'DIGITOVER'],
    [localize('Under'), 'DIGITUNDER'],
    [localize('Asian up'), 'ASIANU'],
    [localize('Asian down'), 'ASIAND'],
    [localize('Stays between'), 'RANGE'],
    [localize('Goes outside'), 'UPORDOWN'],
    [localize('Ends between'), 'EXPIRYRANGE'],
    [localize('Ends outside'), 'EXPIRYMISS'],
    [localize('High tick'), 'TICKHIGH'],
    [localize('Low tick'), 'TICKLOW'],
    [localize('Reset call'), 'RESETCALL'],
    [localize('Reset put'), 'RESETPUT'],
    [localize('Only ups'), 'RUNHIGH'],
    [localize('Only downs'), 'RUNLOW'],
];

window.Blockly.Blocks.purchase_universal = {
    init() {
        this.jsonInit(this.definition());

        // Ensure one of this type per statement-stack
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Purchase any (universal) {{ contract_type }}', { contract_type: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'UNIVERSAL_LIST',
                    options: getUniversalContractTypeOptions(),
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize(
                'Purchases any contract type you pick, even if it is not the contract type set in the Trade parameters block.'
            ),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Contract type switcher'),
            description: localize(
                'Use this block to purchase any contract type without being limited by the Trade parameters block settings. You can select any contract type from the drop down without any limitations. This block can only be used within the Purchase conditions block.'
            ),
            key_words: localize('buy, purchase, universal, switcher, contract type, any'),
        };
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    restricted_parents: ['before_purchase'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.purchase_universal = block => {
    const contract_type = block.getFieldValue('UNIVERSAL_LIST');

    // the second argument tells the trade engine to build the buy request for this exact contract type
    const code = `Bot.purchase('${contract_type}', true);\n`;
    return code;
};
