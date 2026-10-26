import './menu-popups.scss';

const WHATSAPP_URL = 'https://wa.me/254705491022';

// "Build & Designed by Everyman": a box with green / yellow / gold / white lines moving round it.
// Tapping it opens a WhatsApp chat with the owner's number.
const CreditContact = () => (
    <a className='mobile-menu__credit' href={WHATSAPP_URL} target='_blank' rel='noopener noreferrer'>
        <span className='mobile-menu__credit-inner'>
            <span className='mobile-menu__credit-text'>
                Build &amp; Designed by <u>Everyman</u>
            </span>
        </span>
    </a>
);

export default CreditContact;
