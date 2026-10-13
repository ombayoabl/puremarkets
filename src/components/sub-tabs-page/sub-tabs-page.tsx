import React, { useState } from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import './sub-tabs-page.scss';

/** `subtitle` is optional text shown under the heading; a tab without `ready` shows "Coming soon". */
export type TSubTab = { key: string; label: string; ready?: boolean; subtitle?: string };

/** A row of sub-tabs; each one shows a "Coming soon" message until it is marked ready. */
const SubTabsPage = ({ tabs }: { tabs: TSubTab[] }) => {
    const [tab, setTab] = useState(tabs[0].key);
    const active = tabs.find(t => t.key === tab) || tabs[0];

    return (
        <div className='sub-tabs-page'>
            <div className='sub-tabs-page__tabs' role='tablist'>
                {tabs.map(t => (
                    <button
                        key={t.key}
                        type='button'
                        role='tab'
                        aria-selected={tab === t.key}
                        className={classNames('sub-tabs-page__tab', { 'sub-tabs-page__tab--active': tab === t.key })}
                        onClick={() => setTab(t.key)}
                    >
                        {localize(t.label)}
                    </button>
                ))}
            </div>
            <div className='sub-tabs-page__soon'>
                <h2>{localize(active.label)}</h2>
                <p>{active.ready ? active.subtitle : localize('Coming soon')}</p>
            </div>
        </div>
    );
};

export default SubTabsPage;
