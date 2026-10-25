import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.martingale = {
    init() {
        this.jsonInit(this.definition());
        this.setInputsInline(true);
        this.applyMode();
    },
    definition() {
        return {
            message0: `${localize('Martingale')} %1 %2 %3 %4 %5 %6 %7 %8 %9`,
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'MODE',
                    options: [
                        [localize('Normal martingale'), 'normal'],
                        [localize('Compounding'), 'compounding'],
                        [localize('Split martingale'), 'split'],
                    ],
                },
                { type: 'field_label', text: `${localize('Initial stake')}:` },
                { type: 'input_value', name: 'INITIAL', check: 'Number' },
                { type: 'field_label', name: 'SIZE_LABEL', text: `${localize('Martingale size')}:` },
                { type: 'input_value', name: 'SIZE', check: 'Number' },
                { type: 'field_label', text: `${localize('Recovery runs')}:` },
                { type: 'input_value', name: 'RUNS', check: 'Number' },
                { type: 'field_label', text: `${localize('Payout override %')}:` },
                { type: 'input_value', name: 'PAYOUT', check: 'Number' },
            ],
            output: 'Number',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('Returns the martingale stake for the next trade.'),
            category: window.Blockly.Categories.Trade_Definition,
        };
    },
    meta() {
        return {
            display_name: localize('Martingale'),
            description: localize(
                'Returns the martingale stake. On loss (Normal): the stake increases by a multiplier. On win (Compounding): the stake increases by a percentage of profit. Split martingale calculates the stake needed to recover the total loss over a set number of runs using the contract profit percentage. Resets to the initial stake on the opposite result. All the math is done for you. Just drag it into the Stake of your trade options.'
            ),
            key_words: localize('martingale stake'),
        };
    },
    // Show Recovery runs / Payout override only in Split martingale, and relabel the size for Compounding.
    applyMode() {
        const mode = this.getFieldValue('MODE') || 'normal';
        if (this.applied_mode === mode) return;
        this.applied_mode = mode;

        const is_split = mode === 'split';
        this.getInput('RUNS')?.setVisible(is_split);
        this.getInput('PAYOUT')?.setVisible(is_split);
        this.getInput('SIZE')?.setVisible(!is_split);
        this.getField('SIZE_LABEL')?.setVisible(!is_split);
        this.getField('SIZE_LABEL')?.setValue(
            `${mode === 'compounding' ? localize('Profit % added') : localize('Martingale size')}:`
        );
        if (this.rendered) this.render();
    },
    onchange() {
        if (!this.workspace || this.workspace.isDragging?.()) return;
        this.applyMode();
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.martingale = block => {
    const { javascriptGenerator } = window.Blockly.JavaScript;
    const value = (name, fallback) =>
        javascriptGenerator.valueToCode(block, name, javascriptGenerator.ORDER_ATOMIC) || fallback;

    const mode = block.getFieldValue('MODE');
    const code = `Bot.getMartingaleStake('${mode}', ${value('INITIAL', '1')}, ${value('SIZE', '2')}, ${value(
        'RUNS',
        '3'
    )}, ${value('PAYOUT', '0')})`;

    return [code, javascriptGenerator.ORDER_NONE];
};
