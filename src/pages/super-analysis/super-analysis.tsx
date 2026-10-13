import React, { useState } from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import './super-analysis.scss';

const SUB_TABS = [
    { key: 'signal', label: 'Signal' },
    { key: 'patterns', label: 'Tick Patterns' },
    { key: 'analyser', label: 'Tick Analyser' },
];

const SuperAnalysis = () => {
    const [tab, setTab] = useState('signal');
    const active = SUB_TABS.find(t => t.key === tab) || SUB_TABS[0];

    return (
        <div className='sa'>
            <div className='sa__tabs' role='tablist'>
                {SUB_TABS.map(t => (
                    <button
                        key={t.key}
                        type='button'
                        role='tab'
                        aria-selected={tab === t.key}
                        className={classNames('sa__tab', { 'sa__tab--active': tab === t.key })}
                        onClick={() => setTab(t.key)}
                    >
                        {localize(t.label)}
                    </button>
                ))}
            </div>
            <div className='sa__soon'>
                <h2>{localize(active.label)}</h2>
                <p>{localize('Coming soon')}</p>
            </div>
        </div>
    );
};

export default SuperAnalysis;
