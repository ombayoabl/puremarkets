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

// Candles for the chart on the photo: [open, close, high, low] on a 0-100 scale.
const CANDLES: [number, number, number, number][] = [
    [30, 42, 48, 26],
    [42, 36, 46, 32],
    [36, 50, 56, 34],
    [50, 46, 54, 42],
    [46, 60, 66, 44],
    [60, 55, 64, 50],
    [55, 68, 74, 52],
    [68, 62, 72, 58],
    [62, 76, 82, 60],
    [76, 70, 80, 66],
    [70, 84, 90, 68],
    [84, 80, 88, 74],
];

const toY = (value: number) => 150 - value * 1.5;

const Candlesticks = () => (
    <svg className='quickguide__candles' viewBox='0 0 360 150' preserveAspectRatio='none' aria-hidden='true'>
        {CANDLES.map(([open, close, high, low], i) => {
            const x = i * 30 + 15;
            const up = close >= open;
            const top = toY(Math.max(open, close));
            const height = Math.max(Math.abs(toY(open) - toY(close)), 2);
            return (
                <g key={i} className={up ? 'quickguide__candle quickguide__candle--up' : 'quickguide__candle quickguide__candle--down'}>
                    <line x1={x} x2={x} y1={toY(high)} y2={toY(low)} />
                    <rect x={x - 7} y={top} width={14} height={height} rx={2} />
                </g>
            );
        })}
    </svg>
);

const QuickGuide = () => (
    <div className='quickguide'>
        <div className='quickguide__card'>
            <div className='quickguide__visual'>
                <div className='quickguide__indicator' aria-hidden='true'>
                    <span className='quickguide__dot quickguide__dot--up' />
                    <span className='quickguide__dot quickguide__dot--down' />
                </div>
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
                <Candlesticks />
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
