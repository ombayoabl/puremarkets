// Drawer header: "Menu" title with the Install App button
import { ComponentProps } from 'react';
import { LabelPairedGlobeSmRegularIcon } from '@deriv/quill-icons';
import { useTranslations } from '@deriv-com/translations';
import { Text, useDevice } from '@deriv-com/ui';
import InstallAppButton from './install-app-button';

type TMenuHeader = {
    hideLanguageSetting: boolean;
    // Using ComponentProps<'button'>['onClick'] for better type safety and consistency
    // with button onClick event handlers
    openLanguageSetting: ComponentProps<'button'>['onClick'];
};

const MenuHeader = ({ hideLanguageSetting, openLanguageSetting }: TMenuHeader) => {
    const { currentLang, localize } = useTranslations();
    const { isDesktop } = useDevice();

    return (
        <div className='mobile-menu__header'>
            <Text size={isDesktop ? 'sm' : 'md'} weight='bold'>
                {localize('Menu')}
            </Text>
            <InstallAppButton />

            {!hideLanguageSetting && (
                <button
                    className='mobile-menu__header__language items-center'
                    onClick={openLanguageSetting}
                    aria-label={`${localize('Change language')} - ${localize('Current language')}: ${currentLang}`}
                    aria-expanded='false'
                    aria-haspopup='menu'
                >
                    <LabelPairedGlobeSmRegularIcon />
                    <Text className='ml-[0.4rem]' size={isDesktop ? 'xs' : 'sm'} weight='bold'>
                        {currentLang}
                    </Text>
                </button>
            )}
        </div>
    );
};

export default MenuHeader;
