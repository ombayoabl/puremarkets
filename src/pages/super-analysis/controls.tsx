import React, { useEffect, useState } from 'react';
import classNames from 'classnames';
import { clamp } from './analysis';

// Small market badge: candles plus the volatility number and, for 1-second indices, a "1s" tag
export const MarketIcon = ({ name }: { name: string }) => {
    const num = (name.match(/\d+/) || [''])[0];
    const one_sec = /\(1s\)/i.test(name);
    return (
        <svg className='sa__micon' viewBox='0 0 32 32' aria-hidden='true'>
            <g strokeWidth='1.4' strokeLinecap='round'>
                <path d='M7.5 17v11' stroke='#00a79e' />
                <path d='M13.5 15v11' stroke='#00a79e' />
                <path d='M19.5 18v11' stroke='#ec3f3f' />
                <path d='M25.5 14v12' stroke='#00a79e' />
            </g>
            <rect x='5.5' y='20' width='4' height='6' rx='1' fill='#00a79e' />
            <rect x='11.5' y='18' width='4' height='6' rx='1' fill='#00a79e' />
            <rect x='17.5' y='21' width='4' height='6' rx='1' fill='#ec3f3f' />
            <rect x='23.5' y='17' width='4' height='7' rx='1' fill='#00a79e' />
            <rect x='0.5' y='0.5' width='17' height='11' rx='3' fill='#3a424d' />
            <text x='9' y='8.7' textAnchor='middle' fontSize='7.5' fontWeight='700' fill='#fff'>
                {num}
            </text>
            {one_sec && (
                <>
                    <circle cx='25.5' cy='6.5' r='6.5' fill='#e5384f' />
                    <text x='25.5' y='9.1' textAnchor='middle' fontSize='7' fontWeight='700' fill='#fff'>
                        1s
                    </text>
                </>
            )}
        </svg>
    );
};

// Dropdown box with an arrow. The visible text is our own element (always centred);
// the real <select> sits invisibly on top so phones still open their own picker.
export const SelectBox = ({
    value,
    onChange,
    label,
    children,
    variant = 'chevron',
    icon = null,
    accent = false,
}: {
    value: string | number;
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    label: React.ReactNode;
    children: React.ReactNode;
    variant?: 'chevron' | 'triangle';
    icon?: React.ReactNode;
    accent?: boolean;
}) => (
    <div
        className={classNames('sa__selbox', `sa__selbox--${variant}`, {
            'sa__selbox--icon': !!icon,
            'sa__selbox--accent': accent,
        })}
    >
        {icon}
        <div className='sa__sel-text'>
            <span>{label}</span>
        </div>
        <select className='sa__select' value={value} onChange={onChange}>
            {children}
        </select>
    </div>
);

// Number box that lets you clear and retype freely; the value is tidied when you leave the box.
export const NumInput = ({
    value,
    onChange,
    min,
    max,
    integer = false,
    fallback,
}: {
    value: number;
    onChange: (n: number) => void;
    min: number;
    max: number;
    integer?: boolean;
    fallback: number;
}) => {
    const [text, setText] = useState(String(value));

    useEffect(() => {
        if (Number(text) !== value) setText(String(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const pattern = integer ? /^\d*$/ : /^\d*\.?\d*$/;

    return (
        <input
            className='sa__input'
            type='text'
            inputMode={integer ? 'numeric' : 'decimal'}
            value={text}
            onFocus={e => e.target.select()}
            onChange={e => {
                const raw = e.target.value;
                if (!pattern.test(raw)) return;
                setText(raw);
                if (raw !== '' && raw !== '.' && !Number.isNaN(Number(raw))) onChange(Number(raw));
            }}
            onBlur={() => {
                let n = Number(text);
                if (text === '' || text === '.' || Number.isNaN(n)) n = fallback;
                n = clamp(integer ? Math.round(n) : n, min, max);
                setText(String(n));
                onChange(n);
            }}
        />
    );
};

export const Check = ({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) => (
    <button type='button' role='checkbox' aria-checked={checked} className='sa__cbx' onClick={onChange}>
        <span className={classNames('sa__box', { 'sa__box--on': checked })}>{checked ? '✓' : ''}</span>
        <span>{label}</span>
    </button>
);
