import React from 'react';

type TIconProps = { name: string; size?: number };

const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
};

const ICONS: Record<string, React.ReactNode> = {
    // four tiles
    dashboard: (
        <>
            <rect x='3' y='3' width='7' height='7' rx='1.5' />
            <rect x='14' y='3' width='7' height='7' rx='1.5' />
            <rect x='3' y='14' width='7' height='7' rx='1.5' />
            <rect x='14' y='14' width='7' height='7' rx='1.5' />
        </>
    ),
    // stacked layers
    bulk_trader: (
        <>
            <path d='M12 3 2.5 8 12 13 21.5 8z' />
            <path d='m2.5 12.5 9.5 5 9.5-5' />
            <path d='m2.5 16.5 9.5 5 9.5-5' />
        </>
    ),
    // bars with rising arrow
    market_insights: (
        <>
            <path d='M4 20V13M10 20V9M16 20v-6M22 20H2' />
            <path d='m4 8 5-4 4 3 6-5' />
            <path d='M15 2h4v4' />
        </>
    ),
    // robot head
    freebots: (
        <>
            <rect x='4' y='8' width='16' height='12' rx='3' />
            <path d='M12 8V4M10 4h4' />
            <circle cx='9' cy='14' r='1.4' />
            <circle cx='15' cy='14' r='1.4' />
            <path d='M2 13v3M22 13v3' />
        </>
    ),
    // two linked circles
    dtrader_circles: (
        <>
            <circle cx='9' cy='12' r='6' />
            <circle cx='15' cy='12' r='6' />
        </>
    ),
    // lightning bolt
    super_analysis: <path d='M13 2 4 14h7l-1 8 9-12h-7z' />,
    // cube made of blocks
    bot_builder: (
        <>
            <path d='M12 2.5 3.5 7v10L12 21.5 20.5 17V7z' />
            <path d='M3.5 7 12 11.5 20.5 7M12 11.5v10' />
        </>
    ),
    // line chart
    charts: (
        <>
            <path d='M3 3v18h18' />
            <path d='m7 15 4-5 3 3 5-7' />
        </>
    ),
    // candlesticks
    trading_view: (
        <>
            <path d='M7 3v18M17 3v18' />
            <rect x='4.5' y='7' width='5' height='8' rx='1' />
            <rect x='14.5' y='5' width='5' height='10' rx='1' />
        </>
    ),
    // pie chart
    analysis: (
        <>
            <path d='M12 3v9h9' />
            <path d='M20.5 15A9 9 0 1 1 9 3.5' />
        </>
    ),
    // up arrow + 1
    over_one: (
        <>
            <path d='M8 20V5M3.5 9.5 8 5l4.5 4.5' />
            <path d='M17 9.5 19 8v12' />
        </>
    ),
    // down arrow + 8
    under_eight: (
        <>
            <path d='M8 4v15M3.5 14.5 8 19l4.5-4.5' />
            <circle cx='18' cy='8' r='2.3' />
            <circle cx='18' cy='15.5' r='2.7' />
        </>
    ),
    // two overlapping sheets
    copy_trading: (
        <>
            <rect x='9' y='9' width='12' height='12' rx='2' />
            <path d='M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' />
        </>
    ),
};

const NavIcon = ({ name, size = 20 }: TIconProps) => (
    <svg
        className='main-nav__icon'
        width={size}
        height={size}
        viewBox='0 0 24 24'
        aria-hidden='true'
        focusable='false'
        {...common}
    >
        {ICONS[name] ?? null}
    </svg>
);

export default NavIcon;
