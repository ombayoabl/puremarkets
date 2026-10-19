export const getActiveTabUrl = () => {
    const current_tab_number = localStorage.getItem('active_tab');
    const TAB_NAMES = ['dashboard', 'bot_builder', 'chart', 'tutorial', 'coming_soon', 'bulk_trader', 'super_analysis', 'trading_bots', 'over_one', 'under_eight', 'quickguide', 'dtrader'] as const;
    const getTabName = (index: number) => TAB_NAMES[index];
    const current_tab_name = getTabName(Number(current_tab_number));

    const current_url = window.location.href.split('#')[0];
    const active_tab_url = `${current_url}#${current_tab_name}`;
    return active_tab_url;
};
