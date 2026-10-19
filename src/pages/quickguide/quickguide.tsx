import React from 'react';
import { localize } from '@deriv-com/translations';
import './quickguide.scss';

// Where the two buttons go. Leave a link empty until the page exists: an empty
// link makes the button do nothing. Use '#something' or '/path' for a page on
// this site (opens in the same tab) or a full https:// address (opens in a new tab).
export const QUICKGUIDE_LINKS = {
    start_here: '',
    book_mentorship: '',
};

const openLink = (link: string) => {
    if (!link) return;
    if (link.startsWith('#') || link.startsWith('/')) {
        window.location.assign(link);
    } else {
        window.open(link, '_blank', 'noopener,noreferrer');
    }
};

const QuickGuide = () => (
    <div className='quickguide'>
        <div className='quickguide__card'>
            <div className='quickguide__visual'>
                <div className='quickguide__visual-text'>
                    <h1 className='quickguide__welcome'>{localize('WELCOME TO')}</h1>
                    <h1 className='quickguide__brand'>{localize('PUREMARKETS')}</h1>
                </div>
                <div className='quickguide__tag'>
                    <span className='quickguide__tag-text'>{localize('TRADE STRATEGICALLY')}</span>
                    <span className='quickguide__arrow' aria-hidden='true'>
                        <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.6' strokeLinecap='round' strokeLinejoin='round'>
                            <path d='M12 19V5' />
                            <path d='m5 12 7-7 7 7' />
                        </svg>
                    </span>
                </div>
            </div>
            <div className='quickguide__content'>
                <span className='quickguide__badge'>{localize('OFFICIAL GUIDE')}</span>
                <h2 className='quickguide__title'>{localize('Start With Guidance. Trade With Structure.')}</h2>
                <p className='quickguide__text'>
                    {localize(
                        'Access the right, pure, innovative and powerful trading tools through the puremarkets ecosystem.'
                    )}
                </p>
                <div className='quickguide__actions'>
                    <button
                        type='button'
                        className='quickguide__btn quickguide__btn--primary'
                        onClick={() => openLink(QUICKGUIDE_LINKS.start_here)}
                    >
                        {localize('START HERE')}
                    </button>
                    <button
                        type='button'
                        className='quickguide__btn quickguide__btn--secondary'
                        onClick={() => openLink(QUICKGUIDE_LINKS.book_mentorship)}
                    >
                        {localize('BOOK MENTORSHIP')}
                    </button>
                </div>
            </div>
        </div>
    </div>
);

export default QuickGuide;
