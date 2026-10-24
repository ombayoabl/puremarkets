import React from 'react';
import { observer } from 'mobx-react-lite';
import TradingViewComponent from '@/components/trading-view-chart/trading-view';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import './trading-view-modal.scss';

// Full-screen TradingView chart: fills the whole window on laptop and phone.
const TradingViewModal = observer(() => {
    const { dashboard } = useStore();
    const { is_trading_view_modal_visible, setTradingViewModalVisibility } = dashboard;

    React.useEffect(() => {
        if (!is_trading_view_modal_visible) return undefined;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setTradingViewModalVisibility();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [is_trading_view_modal_visible, setTradingViewModalVisibility]);

    if (!is_trading_view_modal_visible) return null;

    return (
        <div className='tv-full' role='dialog' aria-label={localize('TradingView Chart')}>
            <div className='tv-full__bar'>
                <span className='tv-full__title'>{localize('TradingView Chart')}</span>
                <button type='button' className='tv-full__close' onClick={setTradingViewModalVisibility}>
                    {localize('Close')} ✕
                </button>
            </div>
            <div className='tv-full__body'>
                <TradingViewComponent />
            </div>
        </div>
    );
});

export default TradingViewModal;
