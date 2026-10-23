import React from 'react';
import classNames from 'classnames';
import { NAV_ITEMS, TNavItem } from '@/constants/bot-contents';
import { useSiteConfig } from '@/services/site-config';
import { localize } from '@deriv-com/translations';
import NavIcon from './nav-icons';
import './nav-bar.scss';

type TNavBarProps = {
    active_key: string | null;
    onSelect: (item: TNavItem) => void;
};

const NavBar = ({ active_key, onSelect }: TNavBarProps) => {
    const { settings } = useSiteConfig();
    const items = NAV_ITEMS.filter(item => settings.tabs[item.key] !== 'hidden').map(item =>
        settings.tabs[item.key] === 'soon' ? ({ ...item, type: 'soon' } as TNavItem) : item
    );
    return (
    <nav className='main-nav' aria-label='Main navigation'>
        <ul className='main-nav__list'>
            {items.map(item => (
                <li key={item.key} className='main-nav__li'>
                    <button
                        type='button'
                        className={classNames('main-nav__item', {
                            'main-nav__item--active': active_key === item.key,
                        })}
                        aria-current={active_key === item.key ? 'page' : undefined}
                        onClick={() => onSelect(item)}
                    >
                        <NavIcon name={item.key} />
                        <span>{localize(item.label)}</span>
                    </button>
                </li>
            ))}
        </ul>
    </nav>
    );
};

export const ComingSoon = ({ name, icon }: { name: string; icon?: string }) => (
    <div className='coming-soon'>
        {icon && (
            <div className='coming-soon__icon'>
                <NavIcon name={icon} size={96} />
            </div>
        )}
        <h2 className='coming-soon__title'>{name}</h2>
        <p className='coming-soon__text'>{localize('Coming soon')}</p>
    </div>
);

export default NavBar;
