import { ComponentProps, ReactNode, useMemo } from 'react';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import RootStore from '@/stores/root-store';
import { DBOT_TABS } from '@/constants/bot-contents';
import { navigateToTransfer } from '@/utils/transfer-utils';
import {
    LegacyGuide1pxIcon,
    LegacyHomeOldIcon,
    LegacyLogout1pxIcon,
    LegacyReportsIcon,
    LegacyTheme1pxIcon,
} from '@deriv/quill-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
import { ToggleSwitch } from '@deriv-com/ui';

export type TSubmenuSection = 'accountSettings' | 'cashier' | 'reports';

const TransferIcon = ({ className }: { className?: string }) => (
    <svg
        className={className}
        width='16'
        height='16'
        viewBox='0 0 24 24'
        fill='none'
        stroke='var(--text-general)'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
    >
        <path d='M4 8h16m0 0-4-4m4 4-4 4M20 16H4m0 0 4-4m-4 4 4 4' />
    </svg>
);

//IconTypes
type TMenuConfig = {
    LeftComponent: React.ElementType;
    RightComponent?: ReactNode;
    as: 'a' | 'button';
    href?: string;
    label: ReactNode;
    onClick?: () => void;
    removeBorderBottom?: boolean;
    submenu?: TSubmenuSection;
    target?: ComponentProps<'a'>['target'];
    isActive?: boolean;
}[];

const useMobileMenuConfig = (
    client?: RootStore['client'],
    onLogout?: () => void,
    enableThemeToggle: boolean = true,
    dashboard?: RootStore['dashboard'],
    onNavigate?: () => void
) => {
    const { localize } = useTranslations();
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();

    const menuConfig = useMemo((): TMenuConfig[] => {
        return [
            [
                // ========================================
                // CUSTOM MENU ITEMS PLACEHOLDER
                // ========================================
                //
                // Add your custom menu items here.
                //
                // EXAMPLE:
                // {
                //     as: 'a',
                //     label: localize('Your Page'),
                //     LeftComponent: YourIcon,
                //     href: '/your-page',
                // },
                //
                // For desktop menu items, see:
                // src/components/layout/header/header-config.tsx

                client?.is_logged_in && {
                    as: 'button',
                    label: localize('Reports'),
                    LeftComponent: LegacyReportsIcon,
                    submenu: 'reports',
                },
                // Conditionally include theme toggle based on brand config
                enableThemeToggle && {
                    as: 'button',
                    label: localize('Dark theme'),
                    LeftComponent: LegacyTheme1pxIcon,
                    RightComponent: <ToggleSwitch value={is_dark_mode_on} onChange={toggleTheme} />,
                },
                client?.is_logged_in && {
                    as: 'button',
                    label: (
                        <span className='mobile-menu__transfer-label'>
                            {localize('Transfer to Options / USD wallet')}
                        </span>
                    ),
                    LeftComponent: TransferIcon,
                    onClick: () => {
                        if (client?.currency) navigateToTransfer(client.currency);
                    },
                },
            ].filter(Boolean) as TMenuConfig,
            [
                client?.is_logged_in &&
                    onLogout && {
                        as: 'button',
                        label: localize('Log out'),
                        LeftComponent: LegacyLogout1pxIcon,
                        onClick: onLogout,
                        removeBorderBottom: true,
                    },
            ].filter(Boolean) as TMenuConfig,
            [
                {
                    as: 'button',
                    label: localize('Home'),
                    LeftComponent: LegacyHomeOldIcon,
                    isActive: dashboard?.active_tab === DBOT_TABS.DASHBOARD,
                    onClick: () => {
                        dashboard?.setActiveTab(DBOT_TABS.DASHBOARD);
                        onNavigate?.();
                    },
                },
                {
                    as: 'button',
                    label: localize('Tutorials'),
                    LeftComponent: LegacyGuide1pxIcon,
                    isActive: dashboard?.active_tab === DBOT_TABS.TUTORIAL,
                    onClick: () => {
                        dashboard?.setActiveTab(DBOT_TABS.TUTORIAL);
                        onNavigate?.();
                    },
                    removeBorderBottom: true,
                },
            ] as TMenuConfig,
        ].filter(section => section.length > 0);
    }, [
        client,
        onLogout,
        is_dark_mode_on,
        toggleTheme,
        localize,
        enableThemeToggle, // [AI] Added to recalculate menu when theme toggle config changes
        dashboard?.active_tab,
        dashboard,
        onNavigate,
    ]);

    // [AI] Check if menu has any items to determine if mobile menu should be shown
    const hasMenuItems = menuConfig.some(section => section.length > 0);
    // [/AI]

    return {
        config: menuConfig,
        // [AI] Return flag indicating if menu has any items
        hasMenuItems,
        // [/AI]
    };
};

export default useMobileMenuConfig;
