import React from 'react';

// On a phone the chart is drawn at laptop size (1280px wide) and scaled down to fit the screen,
// so the full laptop layout (toolbars, side panels, menus) is visible and nothing is hidden.
const DESKTOP_WIDTH = 1280;

const TradingViewComponent = () => {
    const box_ref = React.useRef<HTMLDivElement>(null);
    const [size, setSize] = React.useState({ width: 0, height: 0 });

    React.useLayoutEffect(() => {
        const el = box_ref.current;
        if (!el) return undefined;
        const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
        measure();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        ro?.observe(el);
        window.addEventListener('resize', measure);
        window.addEventListener('orientationchange', measure);
        return () => {
            ro?.disconnect();
            window.removeEventListener('resize', measure);
            window.removeEventListener('orientationchange', measure);
        };
    }, []);

    const needs_scale = size.width > 0 && size.width < DESKTOP_WIDTH;
    const scale = needs_scale ? size.width / DESKTOP_WIDTH : 1;
    const iframe_style: React.CSSProperties = needs_scale
        ? {
              width: `${DESKTOP_WIDTH}px`,
              height: `${size.height / scale}px`,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              border: 0,
              backgroundColor: 'white',
          }
        : { width: '100%', height: '100%', border: 0, backgroundColor: 'white' };

    return (
        <div ref={box_ref} style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
            <iframe
                id='trading-view-iframe'
                title='TradingView Chart'
                style={iframe_style}
                src='https://charts.deriv.com/deriv?hide-signup=true'
            />
        </div>
    );
};

export default TradingViewComponent;
