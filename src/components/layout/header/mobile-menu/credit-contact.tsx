import { useState } from 'react';
import { createPortal } from 'react-dom';
import './menu-popups.scss';

const OWNER_NUMBER = '0705491022';

// "Build & Designed by Every Man": colour lines above and below; tap it to see the number in a box with moving lines.
const CreditContact = () => {
    const [is_open, setIsOpen] = useState(false);

    return (
        <>
            <button type='button' className='mobile-menu__credit' onClick={() => setIsOpen(true)}>
                <span className='em-lines' />
                <span className='mobile-menu__credit-text'>
                    Build &amp; Designed by <u>Every Man</u>
                </span>
                <span className='em-lines' />
            </button>
            {is_open &&
                createPortal(
                    <div className='em-popup' onClick={() => setIsOpen(false)} role='dialog' aria-label='Contact'>
                        <div className='em-popup__box' onClick={e => e.stopPropagation()}>
                            <div className='em-popup__card'>
                                <div className='em-popup__title'>Build &amp; Designed by Every Man</div>
                                <a className='em-popup__number' href={`tel:${OWNER_NUMBER}`}>
                                    {OWNER_NUMBER}
                                </a>
                                <button type='button' className='em-popup__close' onClick={() => setIsOpen(false)}>
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
        </>
    );
};

export default CreditContact;
