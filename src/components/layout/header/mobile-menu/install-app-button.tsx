import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from '@deriv-com/translations';
import './menu-popups.scss';

type TInstallPromptEvent = Event & { prompt: () => Promise<void> };

// Chrome / Android fire this once, possibly before the menu is opened, so it is kept here.
let deferred_prompt: TInstallPromptEvent | null = null;
if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferred_prompt = e as TInstallPromptEvent;
    });
    window.addEventListener('appinstalled', () => {
        deferred_prompt = null;
    });
}

const isInstalled = () =>
    Boolean(window.matchMedia?.('(display-mode: standalone)').matches) || (navigator as any).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

const InstallAppButton = () => {
    const { localize } = useTranslations();
    const [show_help, setShowHelp] = useState(false);

    if (typeof window === 'undefined' || isInstalled()) return null;

    const handleClick = async () => {
        if (deferred_prompt) {
            const prompt_event = deferred_prompt;
            deferred_prompt = null;
            await prompt_event.prompt();
            return;
        }
        // iPhone / other browsers have no install prompt: show the steps instead
        setShowHelp(true);
    };

    return (
        <>
            <button type='button' className='mobile-menu__install' onClick={handleClick}>
                {localize('Install App')}
            </button>
            {show_help &&
                createPortal(
                    <div className='em-popup' onClick={() => setShowHelp(false)} role='dialog'>
                        <div className='em-popup__box' onClick={e => e.stopPropagation()}>
                            <div className='em-popup__card'>
                                <div className='em-popup__title'>{localize('Install App')}</div>
                                <div className='em-popup__text'>
                                    {isIos()
                                        ? localize('Tap the Share button in Safari, then choose "Add to Home Screen".')
                                        : localize(
                                              'Open your browser menu and choose "Install app" or "Add to Home screen".'
                                          )}
                                </div>
                                <button type='button' className='em-popup__close' onClick={() => setShowHelp(false)}>
                                    {localize('Close')}
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
        </>
    );
};

export default InstallAppButton;
