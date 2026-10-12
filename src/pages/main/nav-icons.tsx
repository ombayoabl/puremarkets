import React from 'react';

type TIconProps = { name: string; size?: number };

const RED = '#ec3f3f';
const GREEN = '#00a79e';
const BLUE = '#3b82f6';
const INDIGO = '#6366f1';
const ORANGE = '#f97316';
const AMBER = '#f5b301';
const PURPLE = '#a855f7';
const GRAY = '#8a94a6';

// Each icon is drawn with its own colours (a soft fill plus a solid outline).
const ICONS: Record<string, React.ReactNode> = {
    dashboard: (
        <>
            <rect x='3' y='3' width='8' height='8' rx='2' fill={`${BLUE}33`} stroke={BLUE} />
            <rect x='13' y='3' width='8' height='8' rx='2' fill={`${GREEN}33`} stroke={GREEN} />
            <rect x='3' y='13' width='8' height='8' rx='2' fill={`${ORANGE}33`} stroke={ORANGE} />
            <rect x='13' y='13' width='8' height='8' rx='2' fill={`${PURPLE}33`} stroke={PURPLE} />
        </>
    ),
    bulk_trader: (
        <>
            <path d='m2.5 16.5 9.5 5 9.5-5' stroke={ORANGE} />
            <path d='m2.5 12.5 9.5 5 9.5-5' stroke={AMBER} />
            <path d='M12 3 2.5 8 12 13 21.5 8z' fill={`${BLUE}33`} stroke={BLUE} />
        </>
    ),
    market_insights: (
        <>
            <path d='M4 20v-7M10 20V9M16 20v-6' stroke={BLUE} strokeWidth={2.6} />
            <path d='M2 20.5h20' stroke={GRAY} />
            <path d='m4 8 5-4 4 3 6-5' stroke={GREEN} />
            <path d='M15 2h4v4' stroke={GREEN} />
        </>
    ),
    freebots: (
        <>
            <rect x='4' y='8' width='16' height='12' rx='3.5' fill={`${GREEN}33`} stroke={GREEN} />
            <path d='M12 8V4' stroke={ORANGE} />
            <circle cx='12' cy='3.5' r='1.4' fill={ORANGE} stroke={ORANGE} />
            <circle cx='9' cy='14' r='1.6' fill={AMBER} stroke={AMBER} />
            <circle cx='15' cy='14' r='1.6' fill={AMBER} stroke={AMBER} />
            <path d='M2 13v3M22 13v3' stroke={BLUE} />
        </>
    ),
    // one side red, one side green
    dtrader_circles: (
        <>
            <circle cx='8.5' cy='12' r='6' fill={`${RED}40`} stroke={RED} />
            <circle cx='15.5' cy='12' r='6' fill={`${GREEN}40`} stroke={GREEN} />
        </>
    ),
    super_analysis: <path d='M13 2 4 14h7l-1 8 9-12h-7z' fill={AMBER} stroke={ORANGE} />,
    bot_builder: (
        <>
            <path d='M12 2.5 3.5 7 12 11.5 20.5 7z' fill={`${BLUE}55`} stroke={BLUE} />
            <path d='M3.5 7v10L12 21.5v-10z' fill={`${INDIGO}55`} stroke={INDIGO} />
            <path d='M20.5 7v10L12 21.5v-10z' fill={`${PURPLE}55`} stroke={PURPLE} />
        </>
    ),
    charts: (
        <>
            <path d='M3 3v18h18' stroke={GRAY} />
            <path d='m7 15 4-5 3 3 5-7' stroke={GREEN} strokeWidth={2.4} />
            <circle cx='19' cy='6' r='1.6' fill={GREEN} stroke={GREEN} />
        </>
    ),
    trading_view: (
        <>
            <path d='M7 3v18' stroke={GREEN} />
            <rect x='4.5' y='7' width='5' height='8' rx='1' fill={GREEN} stroke={GREEN} />
            <path d='M17 3v18' stroke={RED} />
            <rect x='14.5' y='5' width='5' height='10' rx='1' fill={RED} stroke={RED} />
        </>
    ),
    analysis: (
        <>
            <path d='M12 3v9h9a9 9 0 0 0-9-9z' fill={`${ORANGE}66`} stroke={ORANGE} />
            <path d='M20.5 15A9 9 0 1 1 9 3.5V12z' fill={`${BLUE}44`} stroke={BLUE} />
        </>
    ),
    over_one: (
        <>
            <path d='M8 20V5M3.5 9.5 8 5l4.5 4.5' stroke={GREEN} strokeWidth={2.4} />
            <path d='M17 9.5 19 8v12' stroke={GREEN} strokeWidth={2.4} />
        </>
    ),
    under_eight: (
        <>
            <path d='M8 4v15M3.5 14.5 8 19l4.5-4.5' stroke={RED} strokeWidth={2.4} />
            <circle cx='18' cy='8' r='2.3' stroke={RED} />
            <circle cx='18' cy='15.5' r='2.7' stroke={RED} />
        </>
    ),
    copy_trading: (
        <>
            <rect x='9' y='9' width='12' height='12' rx='2.5' fill={`${GREEN}44`} stroke={GREEN} />
            <path d='M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' stroke={BLUE} />
        </>
    ),
};

const NavIcon = ({ name, size = 28 }: TIconProps) => (
    <svg
        className='main-nav__icon'
        width={size}
        height={size}
        viewBox='0 0 24 24'
        fill='none'
        strokeWidth={1.8}
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden='true'
        focusable='false'
    >
        {ICONS[name] ?? null}
    </svg>
);

export default NavIcon;
