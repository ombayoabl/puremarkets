import './menu-popups.scss';

const OWNER_NUMBER = '0705491022';
const WHATSAPP_URL = 'https://wa.me/254705491022';

// "Build & Designed by Every Man": a box with green / yellow / gold / white lines moving round it.
// Tapping it opens a WhatsApp chat with the owner's number.
const CreditContact = () => (
    <a className='mobile-menu__credit' href={WHATSAPP_URL} target='_blank' rel='noopener noreferrer'>
        <span className='mobile-menu__credit-inner'>
            <span className='mobile-menu__credit-text'>
                Build &amp; Designed by <u>Every Man</u>
            </span>
            <span className='mobile-menu__credit-number'>{OWNER_NUMBER}</span>
        </span>
    </a>
);

export default CreditContact;
