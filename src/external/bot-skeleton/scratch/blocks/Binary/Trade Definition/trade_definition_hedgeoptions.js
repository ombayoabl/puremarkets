import { getCurrencyDisplayCode, getDecimalPlaces } from '@/components/shared';
import { localize } from '@deriv-com/translations';
import { config } from '../../../../constants/config';
import DBotStore from '../../../dbot-store';
import { excludeOptionFromContextMenu, modifyContextMenu, setCurrency } from '../../../utils';

// Trade option for a hedge pair: duration and stake are shared by both legs, every leg has its own
// prediction and its own barrier(s).
window.Blockly.Blocks.trade_definition_hedgeoptions = {
    init() {
        this.jsonInit(this.definition());
        this.setInputsInline(true);

        // Ensure one of this type per statement-stack
        this.setNextStatement(false);

        // In the blocks menu show the compact row only (Hedge Duration + Stake); the leg rows
        // (prediction / barriers) appear on the block once it is dragged onto the workspace.
        if (this.workspace?.isFlyout) {
            ['PREDICTION_A', 'BARRIER_A', 'BARRIER2_A', 'PREDICTION_B', 'BARRIER_B', 'BARRIER2_B'].forEach(name =>
                this.getInput(name)?.setVisible(false)
            );
        }
    },
    definition() {
        const leg = (n, prediction_name, barrier_name, second_barrier_name) => [
            { type: 'field_label', text: localize('Leg {{ n }} prediction', { n }) },
            { type: 'input_value', name: prediction_name, check: 'Number' },
            { type: 'field_label', text: localize('barrier') },
            { type: 'input_value', name: barrier_name, check: 'Number' },
            { type: 'field_label', text: localize('barrier 2') },
            { type: 'input_value', name: second_barrier_name, check: 'Number' },
        ];

        return {
            message0: localize('Hedge Duration: {{ duration_unit }} {{ duration_value }}', {
                duration_unit: '%1',
                duration_value: '%2',
            }),
            message1: `${localize('Stake')}: %1 %2`,
            message2: '%1 %2 %3 %4 %5 %6',
            message3: '%1 %2 %3 %4 %5 %6',
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'DURATIONTYPE_LIST',
                    options: [
                        [localize('Ticks'), 't'],
                        [localize('Seconds'), 's'],
                        [localize('Minutes'), 'm'],
                        [localize('Hours'), 'h'],
                        [localize('Days'), 'd'],
                    ],
                },
                { type: 'input_value', name: 'DURATION', check: 'Number' },
            ],
            args1: [
                {
                    type: 'field_label',
                    name: 'CURRENCY_LIST',
                    text: getCurrencyDisplayCode(config().lists.CURRENCY[0]),
                },
                { type: 'input_value', name: 'AMOUNT', check: 'Number' },
            ],
            args2: leg(1, 'PREDICTION_A', 'BARRIER_A', 'BARRIER2_A'),
            args3: leg(2, 'PREDICTION_B', 'BARRIER_B', 'BARRIER2_B'),
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            previousStatement: null,
            nextStatement: null,
            tooltip: localize('Define the trade options of a hedge pair.'),
            category: window.Blockly.Categories.Trade_Definition,
        };
    },
    meta() {
        return {
            display_name: localize('Trade options (Hedge)'),
            description: localize(
                'Define the trade option for a hedge pair. Duration and stake are shared by both legs, but each leg gets its own prediction and its own barrier(s). For example, Over 5 + Under 4, or a barrier hedge of +0.06 Higher with -0.06 Lower. When the contract type needs two barriers (Ends in/out, Stays in/out), each leg has two barrier rows.'
            ),
            key_words: localize('hedge, pair, duration, stake, barrier, prediction'),
        };
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    onchange(event) {
        if (!this.workspace || this.workspace.isDragging() || window.Blockly.derivWorkspace.isFlyoutVisible) {
            return;
        }
        if (
            (event.type === window.Blockly.Events.BLOCK_CREATE && event.ids.includes(this.id)) ||
            (event.type === window.Blockly.Events.BLOCK_DRAG && !event.isStart)
        ) {
            setCurrency(this);
        }
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_definition_hedgeoptions = block => {
    const { javascriptGenerator } = window.Blockly.JavaScript;
    const value = (name, fallback) =>
        javascriptGenerator.valueToCode(block, name, javascriptGenerator.ORDER_ATOMIC) || fallback;

    const { currency } = DBotStore.instance.client;
    const decimal_places = getDecimalPlaces(currency);
    const stake_amount = `+(Number(${value('AMOUNT', '0')}).toFixed(${decimal_places}))`;
    const duration_type = block.getFieldValue('DURATIONTYPE_LIST') || 't';

    const code = `
        Bot.setHedgeLegs(
            ${value('PREDICTION_A', "''")}, ${value('BARRIER_A', "''")}, ${value('BARRIER2_A', "''")},
            ${value('PREDICTION_B', "''")}, ${value('BARRIER_B', "''")}, ${value('BARRIER2_B', "''")}
        );
        Bot.start({
            limitations        : BinaryBotPrivateLimitations,
            duration           : ${value('DURATION', '0')},
            duration_unit      : '${duration_type}',
            currency           : '${currency}',
            amount             : ${stake_amount},
            prediction         : undefined,
            barrierOffset      : undefined,
            secondBarrierOffset: undefined,
            basis              : 'stake',
        });
        BinaryBotPrivateHasCalledTradeOptions = true;
    `;

    return code;
};
