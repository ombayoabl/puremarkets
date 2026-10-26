import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { isProduction, WS_SERVERS } from '@/components/shared';
import { observer as globalObserver } from '@/external/bot-skeleton';
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
    const selected_symbol = store?.dashboard?.bot_builder_symbol || DEFAULT_SYMBOL;
    // While a bot runs it can move to other markets (Change market on each run, Market symbol changer)
    const [bot_symbol, setBotSymbol] = useState<string | null>(null);
    const symbol = bot_symbol || selected_symbol;

    useEffect(() => {
        const onMarketChanged = (new_symbol: string) => setBotSymbol(new_symbol);
        const onBotStop = () => setBotSymbol(null);
        globalObserver.register('bot.market_changed', onMarketChanged);
        globalObserver.register('bot.stop', onBotStop);
        return () => {
            globalObserver.unregister('bot.market_changed', onMarketChanged);
            globalObserver.unregister('bot.stop', onBotStop);
        };
    }, []);

    // picking another market in the Bot Builder takes over again
    useEffect(() => {
        setBotSymbol(null);
    }, [selected_symbol]);
    const [price, setPrice] = useState<string>('––');
    const [is_live, setIsLive] = useState(false);
    const last_quote = useRef<number | null>(null);

    useEffect(() => {
        let ws: WebSocket | null = null;
        let closed = false;
        let retry = 0;
        let timer: ReturnType<typeof setTimeout>;

        setPrice('––');
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
            <span className='live-tick__price'>
                {price.slice(0, -1)}
                <span className='live-tick__last'>{price.slice(-1)}</span>
            </span>
        </div>
    );
});

export default LiveTick;
