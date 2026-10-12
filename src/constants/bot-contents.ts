type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    CHART: 2,
    TUTORIAL: 3,
    COMING_SOON: 4,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = ['id-dbot-dashboard', 'id-bot-builder', 'id-charts', 'id-tutorials', 'id-coming-soon'];

export const DEBOUNCE_INTERVAL_TIME = 500;

export type TNavItem = {
    key: string;
    label: string;
    /** 'tab' switches to an existing tab, 'trading_view' opens the TradingView modal, 'soon' shows Coming soon */
    type: 'tab' | 'trading_view' | 'soon';
    tab_index?: number;
};

// Header navigation row, in display order. Items without a feature yet are 'soon'.
export const NAV_ITEMS: TNavItem[] = [
    { key: 'dashboard', label: 'Dashboard', type: 'tab', tab_index: DBOT_TABS.DASHBOARD },
    { key: 'bulk_trader', label: 'Bulk Trader', type: 'soon' },
    { key: 'market_insights', label: 'Market Insights', type: 'soon' },
    { key: 'freebots', label: 'Freebots by puremarkets', type: 'soon' },
    { key: 'dtrader_circles', label: 'DTrader/Circles', type: 'soon' },
    { key: 'super_analysis', label: 'Super Analysis', type: 'soon' },
    { key: 'bot_builder', label: 'Bot Builder', type: 'tab', tab_index: DBOT_TABS.BOT_BUILDER },
    { key: 'charts', label: 'Charts', type: 'tab', tab_index: DBOT_TABS.CHART },
    { key: 'trading_view', label: 'Trading View', type: 'trading_view' },
    { key: 'analysis', label: 'Analysis', type: 'soon' },
    { key: 'copy_trading', label: 'Copy Trading', type: 'soon' },
];
