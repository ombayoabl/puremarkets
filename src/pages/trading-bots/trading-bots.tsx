import React, { useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { SiteBot, useSiteConfig } from '@/services/site-config';
import { localize } from '@deriv-com/translations';
import '@/components/sub-tabs-page/sub-tabs-page.scss';
import './trading-bots.scss';

const SUB_TABS = [
    { key: 'free', label: 'Freebots', subtitle: 'Access ready made bots to enjoy smarter trading' },
    { key: 'premium', label: 'Premium Bots', subtitle: '' },
    { key: 'strategy', label: 'Strategies', subtitle: '' },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const TradingBots = observer(() => {
    const { dashboard, load_modal } = useStore();
    const { bots, settings } = useSiteConfig();
    const [tab, setTab] = useState('free');
    const [message, setMessage] = useState('');
    const active = SUB_TABS.find(t => t.key === tab) || SUB_TABS[0];
    const list = bots.filter(b => b.type === tab);

    const openBot = async (b: SiteBot) => {
        if (!b.xml) return;
        setMessage('');
        try {
            dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            for (let i = 0; i < 60 && !(window as any).Blockly?.derivWorkspace; i++) await sleep(100);
            await load_modal.loadStrategyToBuilder({ id: `${b.id}-${Date.now()}`, name: b.name, xml: b.xml, save_type: 'local' } as any);
        } catch (e) {
            setMessage(localize('Could not load that bot. Please try again.'));
        }
    };

    const getAccess = (b: SiteBot) => {
        const link = b.link || settings.contact_link;
        if (link) window.open(link, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className='sub-tabs-page'>
            <div className='sub-tabs-page__tabs' role='tablist'>
                {SUB_TABS.map(t => (
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
            <div className='tbots__head'>
                <h2>{localize(active.label)}</h2>
                {active.subtitle && <p>{localize(active.subtitle)}</p>}
                {!active.subtitle && list.length === 0 && <p>{localize('Coming soon')}</p>}
            </div>
            {message && <p className='tbots__error'>{message}</p>}
            <div className='tbots__grid'>
                {list.map(b => (
                    <div key={b.id} className='tbots__card'>
                        <h3>{b.name}</h3>
                        {b.type === 'premium' && b.price && <span className='tbots__price'>{b.price}</span>}
                        {b.description && <p className='tbots__desc'>{b.description}</p>}
                        {b.type === 'strategy' && b.content && <p className='tbots__content'>{b.content}</p>}
                        {b.type !== 'premium' && b.xml && (
                            <button type='button' className='tbots__btn' onClick={() => openBot(b)}>
                                {localize('Load in Bot Builder')}
                            </button>
                        )}
                        {b.type === 'premium' && (b.link || settings.contact_link) && (
                            <button type='button' className='tbots__btn' onClick={() => getAccess(b)}>
                                {localize('Get access')}
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
});

export default TradingBots;
