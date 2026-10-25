import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.trade_definition_fastmode = {
    init() {
        this.jsonInit({
            message0: localize('Fast mode (trade on almost every tick, without waiting for the previous contract to finish): {{ checkbox }}', {
                checkbox: '%1',
            }),
            args0: [
                {
                    type: 'field_checkbox',
                    name: 'FASTMODE',
                    checked: false,
                    class: 'blocklyCheckbox',
                },
            ],
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            previousStatement: null,
            nextStatement: null,
            tooltip: localize('Turn on to place the next trade on almost every tick instead of waiting for the previous contract to finish. Several contracts can be open at the same time.'),
        });

        this.setMovable(false);
        this.setDeletable(false);
    },
    onchange(/* event */) {
        if (!this.workspace || window.Blockly.derivWorkspace.isFlyoutVisible || this.workspace.isDragging()) {
            return;
        }

        const next_block = this.getNextBlock();
        if (next_block && next_block.type !== 'trade_definition_changemarket') {
            next_block.unplug(true);
        }

        this.enforceLimitations();
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    enforceLimitations: window.Blockly.Blocks.trade_definition_market.enforceLimitations,
    required_inputs: ['FASTMODE'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_definition_fastmode = () => {};
