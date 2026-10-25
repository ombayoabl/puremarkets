import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { isProduction, WS_SERVERS } from '@/components/shared';
import { useStore } from '@/hooks/useStore';
import './live-tick.scss';

// Same public tick server the rest of the app uses (no login needed).
const getWsUrl = () => (isProduction() ? WS_SERVERS.PRODUCTION : WS_SERVERS.STAGING).replace(/^http/, 'ws');
const DEFAULT_SYMBOL = 'R_10';

/**
 * Shows the live price of the market currently selected in the Bot Builder.
 * Follows `dashboard.bot_builder_symbol`, so switching market in Trade parameters
 * (or with the Market symbol change block) switches the number here too.
 */
const LiveTick = observer(() => {
    const store = useStore();
    const symbol = store?.dashboard?.bot_builder_symbol || DEFAULT_SYMBOL;
    const [price, setPrice] = useState<string>('––');
    const [direction, setDirection] = useState<'up' | 'down' | ''>('');
    const [is_live, setIsLive] = useState(false);
    const last_quote = useRef<number | null>(null);

    useEffect(() => {
        let ws: WebSocket | null = null;
        let closed = false;
        let retry = 0;
        let timer: ReturnType<typeof setTimeout>;

        setPrice('––');
        setDirection('');
        last_quote.current = null;

        const connect = () => {
            ws = new WebSocket(getWsUrl());
            ws.onopen = () => {
                retry = 0;
                setIsLive(true);
                ws?.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
            };
            ws.onmessage = event => {
                const msg = JSON.parse(event.data);
                if (msg.msg_type !== 'tick' || msg.tick?.symbol !== symbol) return;
                const quote = Number(msg.tick.quote);
                if (last_quote.current !== null && quote !== last_quote.current) {
                    setDirection(quote > last_quote.current ? 'up' : 'down');
                }
                last_quote.current = quote;
                setPrice(quote.toFixed(msg.tick.pip_size ?? 2));
            };
            ws.onclose = () => {
                setIsLive(false);
                if (closed) return;
                timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
            };
        };
        connect();

        // Cleanup on market change/unmount: closing the socket drops the old subscription.
        return () => {
            closed = true;
            clearTimeout(timer);
            ws?.close();
        };
    }, [symbol]);

    return (
        <div className='live-tick' data-testid='dt_live_tick' title={symbol}>
            <span className={`live-tick__dot${is_live ? ' live-tick__dot--on' : ''}`} />
            <span className={`live-tick__price live-tick__price--${direction || 'flat'}`}>{price}</span>
        </div>
    );
});

export default LiveTick;
