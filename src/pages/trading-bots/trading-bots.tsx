import React from 'react';
import SubTabsPage from '@/components/sub-tabs-page/sub-tabs-page';

const SUB_TABS = [
    { key: 'freebots', label: 'Freebots', ready: true, subtitle: 'Ready_Made Bots.Smarter Trading' },
    { key: 'premium_bots', label: 'Premium Bots' },
    { key: 'strategies', label: 'Strategies' },
];

const TradingBots = () => <SubTabsPage tabs={SUB_TABS} />;

export default TradingBots;
