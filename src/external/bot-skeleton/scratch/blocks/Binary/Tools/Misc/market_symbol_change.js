import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../../utils';

// Market symbol change: one block that moves BOTH the market contracts are placed on and the market every analysis
// block (last digit, tick list, OHLC...) reads, from the moment it runs.
export const getMarketSymbolOptions = () => [
    [localize('Volatility 10 (1s) Index'), '1HZ10V'],
    [localize('Volatility 10 Index'), 'R_10'],
    [localize('Volatility 25 (1s) Index'), '1HZ25V'],
    [localize('Volatility 25 Index'), 'R_25'],
    [localize('Volatility 50 (1s) Index'), '1HZ50V'],
    [localize('Volatility 50 Index'), 'R_50'],
    [localize('Volatility 75 (1s) Index'), '1HZ75V'],
    [localize('Volatility 75 Index'), 'R_75'],
    [localize('Volatility 100 (1s) Index'), '1HZ100V'],
    [localize('Volatility 100 Index'), 'R_100'],
];

window.Blockly.Blocks.market_symbol_change = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Change market symbol to {{ symbol }}', { symbol: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'SYMBOL_LIST',
                    options: getMarketSymbolOptions(),
                },
            ],
            colour: window.Blockly.Colours.Special3.colour,
            colourSecondary: window.Blockly.Colours.Special3.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special3.colourTertiary,
            previousStatement: null,
            nextStatement: null,
            tooltip: localize('Changes the market for both placing contracts and all analysis blocks.'),
            category: window.Blockly.Categories.Miscellaneous,
        };
    },
    meta() {
        return {
            display_name: localize('Market symbol change'),
            description: localize(
                'Changes the market symbol globally for both trading and analysis. This single block changes the symbol used for placing contracts and the symbol used by all analysis blocks (last digit, tick list or OHLC indicators). Use this to switch markets comprehensively without needing separate blocks.'
            ),
            key_words: localize('market, symbol, change, switch, volatility'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.market_symbol_change = block => {
    const symbol = block.getFieldValue('SYMBOL_LIST');

    const code = `Bot.changeMarketSymbol('${symbol}');\n`;
    return code;
};
