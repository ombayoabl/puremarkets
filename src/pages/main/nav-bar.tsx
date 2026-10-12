import React from 'react';
import classNames from 'classnames';
import { NAV_ITEMS, TNavItem } from '@/constants/bot-contents';
import { localize } from '@deriv-com/translations';
import './nav-bar.scss';

type TNavBarProps = {
    active_key: string | null;
    onSelect: (item: TNavItem) => void;
};

const NavBar = ({ active_key, onSelect }: TNavBarProps) => (
    <nav className='main-nav' aria-label='Main navigation'>
        <ul className='main-nav__list'>
            {NAV_ITEMS.map(item => (
                <li key={item.key} className='main-nav__li'>
                    <button
                        type='button'
                        className={classNames('main-nav__item', {
                            'main-nav__item--active': active_key === item.key,
                        })}
                        aria-current={active_key === item.key ? 'page' : undefined}
                        onClick={() => onSelect(item)}
                    >
                        {localize(item.label)}
                    </button>
                </li>
            ))}
        </ul>
    </nav>
);

export const ComingSoon = ({ name }: { name: string }) => (
    <div className='coming-soon'>
        <h2 className='coming-soon__title'>{name}</h2>
        <p className='coming-soon__text'>{localize('Coming soon')}</p>
    </div>
);

export default NavBar;
