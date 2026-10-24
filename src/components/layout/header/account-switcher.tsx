import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { addComma, getCurrencyDisplayCode, getDecimalPlaces, standalone_routes } from '@/components/shared';
import Text from '@/components/shared_ui/text';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { Localize } from '@deriv-com/translations';
import { TAccountSwitcher } from './common/types';
import AccountInfoWrapper from './account-info-wrapper';
import './account-switcher.scss';

/**
 * Login IDs that should always display as "Real account" regardless of
 * whether the underlying active account is demo or real — matches the
 * same forced-label behavior added to the DTrader app's header. The
 * balance value shown is always the true value for whichever account is
 * active; only the label text is forced. Matched by loginid rather than
 * email since this codebase (like DTrader's) has no email field available
 * on the account object. Applied consistently to every account in the
 * dropdown list too, not just the active one, so a forced-real account
 * sorts into the Real tab and shows the Real label wherever it appears.
 */
const FORCED_REAL_LABEL_LOGIN_IDS = ['DOT94283012'];

const isForcedReal = (loginid: string | undefined) => !!loginid && FORCED_REAL_LABEL_LOGIN_IDS.includes(loginid);

const AccountSwitcher = observer(({ activeAccount }: TAccountSwitcher) => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeCategory, setActiveCategory] = useState<'real' | 'demo'>('real');
    const [isResetting, setIsResetting] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const { accountList, activeLoginid } = useApiBase();
    const { client, run_panel } = useStore() ?? {};

    const is_bot_running = run_panel?.is_running || api_base.is_running;
    const isSingleAccount = !accountList || accountList.length <= 1;

    // Computed before any hook below reads them, but activeAccount can be
    // undefined on some renders (loading state) — every hook must still run
    // unconditionally on every render, so the `if (!activeAccount)` bail-out
    // stays below, after all hooks, not before.
    const displayAsVirtual = activeAccount ? activeAccount.isVirtual && !isForcedReal(activeAccount.loginid) : false;

    useEffect(() => {
        setActiveCategory(displayAsVirtual ? 'demo' : 'real');
    }, [displayAsVirtual, isOpen]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const toggleDropdown = useCallback(() => {
        if (is_bot_running || isSingleAccount) return;
        setIsOpen(prev => !prev);
    }, [is_bot_running, isSingleAccount]);

    const handleAccountSelect = useCallback(
        (selected_loginid: string) => {
            if (selected_loginid === activeLoginid) return;
            localStorage.setItem('active_loginid', selected_loginid);
            client?.checkAndRegenerateWebSocket();
            setIsOpen(false);
        },
        [activeLoginid, client]
    );

    const handleResetBalance = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsResetting(true);
        try {
            await api_base.api?.send({ topup_virtual: 1 });
            // The existing 'balance' subscription (set up in api-base.ts) pushes
            // the updated amount automatically — no manual refetch needed.
        } catch (err) {
            console.error('Failed to reset demo balance:', err);
        } finally {
            setIsResetting(false);
        }
    }, []);

    const formatBalance = (bal: number | string | undefined, curr: string | undefined) =>
        curr ? `${addComma(Number(bal ?? 0).toFixed(getDecimalPlaces(curr)))} ${getCurrencyDisplayCode(curr)}` : null;

    const categoryAccounts = useMemo(() => {
        if (!accountList) return [];
        return accountList
            .filter(account => {
                const accountDisplayAsVirtual = isDemoAccount(account.loginid) && !isForcedReal(account.loginid);
                return accountDisplayAsVirtual === (activeCategory === 'demo');
            })
            .sort((a, b) => (a.loginid === activeLoginid ? -1 : b.loginid === activeLoginid ? 1 : 0));
    }, [accountList, activeCategory, activeLoginid]);

    // All hooks above run on every render regardless of activeAccount, per
    // the Rules of Hooks — only now, after every hook has been called, is it
    // safe to bail out for the "no active account yet" (loading) state.
    if (!activeAccount) return null;

    const { currency, balance } = activeAccount;
    const showChevron = !isSingleAccount && !is_bot_running;

    return (
        <div className='acc-info__wrapper' ref={wrapperRef}>
            <AccountInfoWrapper>
                <div
                    data-testid='dt_acc_info'
                    id='dt_core_account-info_acc-info'
                    role={showChevron ? 'button' : undefined}
                    tabIndex={showChevron ? 0 : -1}
                    aria-expanded={showChevron ? isOpen : undefined}
                    aria-haspopup={showChevron ? 'listbox' : undefined}
                    className={classNames('acc-info', {
                        'acc-info--is-virtual': displayAsVirtual,
                        'acc-info--interactive': showChevron,
                    })}
                    onClick={toggleDropdown}
                    onKeyDown={e => {
                        if (showChevron && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            toggleDropdown();
                        }
                    }}
                >
                    <span className='acc-info__id' aria-hidden='true'>
                        <CurrencyIcon currency={currency} isVirtual={displayAsVirtual} />
                    </span>
                    <div className='acc-info__content'>
                        <div className='acc-info__account-type-header'>
                            <Text as='p' size='xs' className='acc-info__account-type'>
                                {displayAsVirtual ? (
                                    <Localize i18n_default_text='Demo account' />
                                ) : (
                                    <Localize i18n_default_text='Real account' />
                                )}
                            </Text>
                            {showChevron && (
                                <span
                                    className={classNames('acc-info__select-arrow', {
                                        'acc-info__select-arrow--invert': isOpen,
                                    })}
                                >
                                    <svg width='12' height='12' viewBox='0 0 12 12' fill='none'>
                                        <path
                                            d='M2 4L6 8L10 4'
                                            stroke='currentColor'
                                            strokeWidth='1.5'
                                            strokeLinecap='round'
                                            strokeLinejoin='round'
                                        />
                                    </svg>
                                </span>
                            )}
                        </div>
                        {(typeof balance !== 'undefined' || !currency) && (
                            <div className='acc-info__balance-section'>
                                <p
                                    data-testid='dt_balance'
                                    className={classNames('acc-info__balance', {
                                        'acc-info__balance--no-currency': !currency && !displayAsVirtual,
                                    })}
                                >
                                    {!currency ? (
                                        <Localize i18n_default_text='No currency assigned' />
                                    ) : (
                                        // `balance` here comes from useActiveAccount, which already
                                        // returns a fully formatted string (comma'd, fixed to the
                                        // right decimal places for the currency) — NOT a raw number.
                                        // Re-parsing it with Number()/toFixed() (as formatBalance
                                        // does for the raw numeric values below) breaks on the comma
                                        // and produces "NaN". Use it as-is, same as before the merge.
                                        `${balance} ${getCurrencyDisplayCode(currency)}`
                                    )}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </AccountInfoWrapper>
            {isOpen && (
                <div className='acc-dropdown acc-dropdown--panel' role='listbox'>
                    <div className='acc-dropdown__tabs'>
                        <button
                            type='button'
                            className={classNames('acc-dropdown__tab', {
                                'acc-dropdown__tab--active': activeCategory === 'real',
                            })}
                            onClick={() => setActiveCategory('real')}
                        >
                            <Localize i18n_default_text='Real' />
                        </button>
                        <button
                            type='button'
                            className={classNames('acc-dropdown__tab', {
                                'acc-dropdown__tab--active': activeCategory === 'demo',
                            })}
                            onClick={() => setActiveCategory('demo')}
                        >
                            <Localize i18n_default_text='Demo' />
                        </button>
                    </div>

                    <div className='acc-dropdown__section-header'>
                        <Localize i18n_default_text='Deriv account' />
                    </div>

                    <div className='acc-dropdown__list'>
                        {categoryAccounts.length === 0 && (
                            <div className='acc-dropdown__empty'>
                                {activeCategory === 'demo' ? (
                                    <Localize i18n_default_text='No demo account found.' />
                                ) : (
                                    <Localize i18n_default_text='No real account found.' />
                                )}
                            </div>
                        )}
                        {categoryAccounts.map(account => {
                            const accountForceReal = isForcedReal(account.loginid);
                            const accountDisplayAsVirtual = isDemoAccount(account.loginid) && !accountForceReal;
                            const accountIsActive = account.loginid === activeLoginid;
                            return (
                                <div
                                    key={account.loginid}
                                    role='option'
                                    aria-selected={accountIsActive}
                                    tabIndex={0}
                                    className={classNames('acc-dropdown__account', {
                                        'acc-dropdown__account--selected': accountIsActive,
                                        'acc-dropdown__account--virtual': accountDisplayAsVirtual,
                                    })}
                                    onClick={() => handleAccountSelect(account.loginid)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            handleAccountSelect(account.loginid);
                                        }
                                    }}
                                >
                                    <div className='acc-dropdown__account-left'>
                                        <CurrencyIcon currency={account.currency} isVirtual={accountDisplayAsVirtual} />
                                        <div>
                                            <Text
                                                size='xxxs'
                                                className={classNames('acc-dropdown__account-type', {
                                                    'acc-dropdown__account-type--virtual': accountDisplayAsVirtual,
                                                })}
                                            >
                                                {accountDisplayAsVirtual ? (
                                                    <Localize i18n_default_text='Demo account' />
                                                ) : (
                                                    <Localize i18n_default_text='Real account' />
                                                )}
                                            </Text>
                                            <div className='acc-dropdown__account-id'>{account.loginid}</div>
                                        </div>
                                    </div>
                                    {activeCategory === 'demo' && accountIsActive ? (
                                        <button
                                            type='button'
                                            className='acc-dropdown__reset-btn'
                                            disabled={isResetting}
                                            onClick={handleResetBalance}
                                        >
                                            {isResetting ? (
                                                <Localize i18n_default_text='Resetting...' />
                                            ) : (
                                                <Localize i18n_default_text='Reset balance' />
                                            )}
                                        </button>
                                    ) : (
                                        <Text size='xs' weight='bold' className='acc-dropdown__balance'>
                                            {account.currency ? (
                                                formatBalance(account.balance, account.currency)
                                            ) : (
                                                <Localize i18n_default_text='No currency assigned' />
                                            )}
                                        </Text>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <a
                        href={standalone_routes.traders_hub}
                        className='acc-dropdown__cfd-link'
                        onClick={() => setIsOpen(false)}
                    >
                        <Localize i18n_default_text="Looking for CFD accounts? Go to Trader's Hub" />
                    </a>

                    <div className='acc-dropdown__footer'>
                        <a href={standalone_routes.traders_hub} className='acc-dropdown__manage-btn'>
                            <Localize i18n_default_text='Manage accounts' />
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
});

export default AccountSwitcher;
