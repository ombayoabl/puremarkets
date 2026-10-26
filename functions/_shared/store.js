// Shared helpers for the puremarkets back end on Cloudflare Pages Functions.
// (The same logic as api/_lib.js for Vercel, written with web-standard APIs only, so it runs on Cloudflare.)
// Storage: any Upstash Redis REST store. Set these in Cloudflare Pages -> Settings -> Variables and secrets:
//   KV_REST_API_URL + KV_REST_API_TOKEN  (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
//   ADMIN_PASSWORD (required), ADMIN_SECRET (optional, signs the login token)

const enc = new TextEncoder();
const dec = new TextDecoder();

export const json = (data, status = 200, headers = {}) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    });

const kvUrl = env => env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '';
const kvToken = env => env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '';
export const storageReady = env => Boolean(kvUrl(env) && kvToken(env));

async function kv(env, ...cmd) {
    const res = await fetch(kvUrl(env), {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken(env)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmd),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(body.error || `Storage error ${res.status}`);
    return body.result;
}

export async function getJson(env, key, fallback) {
    if (!storageReady(env)) return fallback;
    const raw = await kv(env, 'GET', key);
    if (!raw) return fallback;
    try {
        return JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}
export const setJson = (env, key, value) => kv(env, 'SET', key, JSON.stringify(value));

export const DEFAULT_SETTINGS = {
    maintenance: { on: false, message: 'We are making improvements. Please check back soon.' },
    announcement: { on: false, text: '' },
    tabs: {}, // nav key -> 'on' | 'soon' | 'hidden'
    copy_trading_paused: false,
    contact_link: '',
    test_mode: { on: false, accounts: ['DOT93428523', 'ROT92069621'] }, // labelled test mode: shows a TEST MODE banner for these accounts
};
export const getSettings = async env => ({ ...DEFAULT_SETTINGS, ...(await getJson(env, 'pm:settings', {})) });
export const getBots = async env => {
    const list = await getJson(env, 'pm:bots', []);
    return Array.isArray(list) ? list : [];
};

// ---- small crypto helpers (Web Crypto) ----
const toB64Url = bytes => {
    let s = '';
    new Uint8Array(bytes).forEach(b => (s += String.fromCharCode(b)));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = str => {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
    const bin = atob(b64);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
};
const toHex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async text => crypto.subtle.digest('SHA-256', enc.encode(text));
const sameBytes = (a, b) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
    return diff === 0;
};

// ---- admin login token (signed, expires after 12 hours) ----
const secret = async env => env.ADMIN_SECRET || toHex(await sha256(`pm|${env.ADMIN_PASSWORD || ''}`));
const sign = async (env, payload) => {
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(await secret(env)),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    return toB64Url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
};
export const makeToken = async env => {
    const payload = toB64Url(enc.encode(JSON.stringify({ exp: Date.now() + 12 * 3600 * 1000 })));
    return `${payload}.${await sign(env, payload)}`;
};
export const checkToken = async (env, token) => {
    try {
        const [payload, sig] = String(token || '').split('.');
        if (!payload || !sig) return false;
        const good = await sign(env, payload);
        if (!sameBytes(enc.encode(sig), enc.encode(good))) return false;
        return JSON.parse(dec.decode(fromB64Url(payload))).exp > Date.now();
    } catch (e) {
        return false;
    }
};
export const checkPassword = async (env, input) => {
    const real = env.ADMIN_PASSWORD || '';
    if (!real) return false;
    const a = new Uint8Array(await sha256(String(input || '')));
    const b = new Uint8Array(await sha256(real));
    return sameBytes(a, b);
};
