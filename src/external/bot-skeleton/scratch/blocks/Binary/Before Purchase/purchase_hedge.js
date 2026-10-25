import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';
import { getUniversalContractTypeOptions } from './purchase_universal';

// Hedge purchase: buys two contracts (a hedge pair) at the exact same time. Each leg can be any contract type.
window.Blockly.Blocks.purchase_hedge = {
    init() {
        this.jsonInit(this.definition());
        this.setInputsInline(true);

        // Ensure one of this type per statement-stack
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Hedge Purchase {{ first }} and {{ second }}', { first: '%1', second: '%2' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'HEDGE_FIRST',
                    options: getUniversalContractTypeOptions(),
                },
                {
                    type: 'field_dropdown',
                    name: 'HEDGE_SECOND',
                    options: getUniversalContractTypeOptions().map(option => [...option]),
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('Purchases two contracts (a hedge pair) at the exact same time.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Hedge Purchase'),
            description: localize(
                'Use this block to purchase two contracts at the exact same time (a hedge pair), for example Over and Under, or Differs and Over. Each drop down can select any contract type. This block can only be used within the Purchase conditions block and replaces the normal Purchase block.'
            ),
            key_words: localize('buy, purchase, hedge, pair, two contracts'),
        };
    },
    onchange(event) {
        if (!this.workspace || window.Blockly.derivWorkspace.isFlyoutVisible || this.workspace.isDragging()) {
            return;
        }
        // first time on the workspace: start with Over and Under
        if (event.type === window.Blockly.Events.BLOCK_CREATE && event.ids.includes(this.id)) {
            if (this.getFieldValue('HEDGE_FIRST') === this.getFieldValue('HEDGE_SECOND')) {
                this.setFieldValue('DIGITUNDER', 'HEDGE_SECOND');
            }
        }
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    restricted_parents: ['before_purchase'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.purchase_hedge = block => {
    const first = block.getFieldValue('HEDGE_FIRST');
    const second = block.getFieldValue('HEDGE_SECOND');

    return `Bot.hedgePurchase('${first}', '${second}');\n`;
};
