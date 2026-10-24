import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import './live-balance.scss';
/**
 * Login IDs that should always display as "Real account" regardless of the
 * account's actual is_virtual status — same forced-label behavior as the
 * DTrader app header and account-switcher.tsx. The balance value below is
 * always the true value; only this label is forced.
 */
const FORCED_REAL_LABEL_LOGIN_IDS = ['DOT94283012'];
const formatBalance = (balance: string) => {
    const amount = Number(balance ?? 0);
    return amount.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
};
const LiveBalance = observer(() => {
    const { client } = useStore();
    const { balance, currency, is_logged_in, is_virtual, loginid } = client;
    if (!is_logged_in) return null;
    const forceRealLabel = !!loginid && FORCED_REAL_LABEL_LOGIN_IDS.includes(loginid);
    const displayAsVirtual = is_virtual && !forceRealLabel;
    return (
        <div
            className='toolbar__balance-badge'
            data-testid='dt_live_balance'
            style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: '8px',
                lineHeight: 1.1,
                fontSize: '10px',
                letterSpacing: 'normal',
                textTransform: 'none',
                padding: 0,
            }}
        >
            <CurrencyIcon currency={currency} isVirtual={displayAsVirtual} />
            <span
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                }}
            >
                <span
                    className='toolbar__balance-badge__type'
                    style={{ fontSize: '9px', letterSpacing: 'normal', textTransform: 'none' }}
                >
                    {displayAsVirtual ? 'Demo account' : 'Real account'}
                </span>
                <span className='toolbar__balance-badge__amount' style={{ fontSize: '12px' }}>
                    {formatBalance(balance)} {currency}
                </span>
            </span>
        </div>
    );
});
export default LiveBalance;
