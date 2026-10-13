import React from 'react';
import SubTabsPage from '@/components/sub-tabs-page/sub-tabs-page';

const SUB_TABS = [
    { key: 'signal', label: 'Signal' },
    { key: 'patterns', label: 'Tick Patterns' },
    { key: 'analyser', label: 'Tick Analyser' },
];

const SuperAnalysis = () => <SubTabsPage tabs={SUB_TABS} />;

export default SuperAnalysis;
