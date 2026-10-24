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

const Chevron = ({ up }: { up: boolean }) => (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' aria-hidden='true' style={{ transform: up ? 'rotate(180deg)' : undefined }}>
        <polyline points='6 9 12 15 18 9' />
    </svg>
);

const BotCard = ({ b, onLoad, onAccess, can_access }: { b: SiteBot; onLoad: (b: SiteBot) => void; onAccess: (b: SiteBot) => void; can_access: boolean }) => {
    const [open, setOpen] = useState(false);
    const long = (b.description || '').length > 110;
    return (
        <div className='tbots__card'>
            <h3>{b.name}</h3>
            {b.type === 'premium' && b.price && <span className='tbots__price'>{b.price}</span>}
            {b.description && <p className={classNames('tbots__desc', { 'tbots__desc--clamp': long && !open })}>{b.description}</p>}
            {long && (
                <button type='button' className='tbots__more' onClick={() => setOpen(o => !o)}>
                    {open ? localize('Show less') : localize('Learn more')} <Chevron up={open} />
                </button>
            )}
            {b.type === 'strategy' && b.content && <p className='tbots__content'>{b.content}</p>}
            {b.type !== 'premium' && b.xml && (
                <button type='button' className='tbots__btn' onClick={() => onLoad(b)}>
                    {localize('Load Bot')}
                </button>
            )}
            {b.type === 'premium' && can_access && (
                <button type='button' className='tbots__btn' onClick={() => onAccess(b)}>
                    {localize('Get access')}
                </button>
            )}
        </div>
    );
};

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
                    <BotCard
                        key={b.id}
                        b={b}
                        onLoad={openBot}
                        onAccess={getAccess}
                        can_access={Boolean(b.link || settings.contact_link)}
                    />
                ))}
            </div>
        </div>
    );
});

export default TradingBots;
