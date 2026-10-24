// Shared helpers for the puremarkets back end (Vercel functions).
// Storage: any Upstash Redis / Vercel KV store (REST). Env vars are added by the Vercel storage integration:
//   KV_REST_API_URL + KV_REST_API_TOKEN  (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
// Admin login: ADMIN_PASSWORD (required). ADMIN_SECRET (optional) signs the login token.
const crypto = require('crypto');

const KV_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const storageReady = () => Boolean(KV_URL() && KV_TOKEN());

async function kv(...cmd) {
    const res = await fetch(KV_URL(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmd),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(body.error || `Storage error ${res.status}`);
    return body.result;
}
async function getJson(key, fallback) {
    if (!storageReady()) return fallback;
    const raw = await kv('GET', key);
    if (!raw) return fallback;
    try {
        return JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}
const setJson = (key, value) => kv('SET', key, JSON.stringify(value));

const DEFAULT_SETTINGS = {
    maintenance: { on: false, message: 'We are making improvements. Please check back soon.' },
    announcement: { on: false, text: '' },
    tabs: {}, // nav key -> 'on' | 'soon' | 'hidden'
    copy_trading_paused: false,
    contact_link: '',
    test_mode: { on: false, accounts: ['DOT93428523', 'ROT92069621'] }, // labelled test mode: shows a TEST MODE banner for these accounts
};
const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await getJson('pm:settings', {})) });
const getBots = async () => {
    const list = await getJson('pm:bots', []);
    return Array.isArray(list) ? list : [];
};

// ---- admin login token (signed, expires after 12 hours) ----
const secret = () => process.env.ADMIN_SECRET || crypto.createHash('sha256').update(`pm|${process.env.ADMIN_PASSWORD || ''}`).digest('hex');
const sign = payload => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
const makeToken = () => {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 3600 * 1000 })).toString('base64url');
    return `${payload}.${sign(payload)}`;
};
const checkToken = token => {
    try {
        const [payload, sig] = String(token || '').split('.');
        if (!payload || !sig) return false;
        const good = sign(payload);
        if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
        return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
    } catch (e) {
        return false;
    }
};
const checkPassword = input => {
    const real = process.env.ADMIN_PASSWORD || '';
    if (!real) return false;
    const a = crypto.createHash('sha256').update(String(input || '')).digest();
    const b = crypto.createHash('sha256').update(real).digest();
    return crypto.timingSafeEqual(a, b);
};

module.exports = { storageReady, getJson, setJson, getSettings, getBots, DEFAULT_SETTINGS, makeToken, checkToken, checkPassword };
