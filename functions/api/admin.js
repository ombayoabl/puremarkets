// Admin back end: one endpoint, POST { action, ... } with a bearer token (except "login").
import {
    DEFAULT_SETTINGS,
    checkPassword,
    checkToken,
    getBots,
    getSettings,
    json,
    makeToken,
    setJson,
    storageReady,
} from '../_shared/store';

const TYPES = ['free', 'premium', 'strategy'];
const NAV_STATES = ['on', 'soon', 'hidden'];
const str = (v, max) => String(v ?? '').slice(0, max);
const cleanBot = (b, old = {}) => ({
    id: old.id || crypto.randomUUID(),
    type: TYPES.includes(b.type) ? b.type : old.type || 'free',
    name: str(b.name, 120).trim(),
    description: str(b.description, 600),
    price: str(b.price, 40),
    link: str(b.link, 500),
    content: str(b.content, 20000),
    xml: b.xml === undefined ? old.xml || '' : str(b.xml, 400000),
    enabled: b.enabled === undefined ? old.enabled !== false : Boolean(b.enabled),
    created: old.created || Date.now(),
    updated: Date.now(),
});

const NO_STORE = { 'Cache-Control': 'no-store' };
const reply = (data, status = 200) => json(data, status, NO_STORE);

export const onRequest = async ({ request, env }) => {
    if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
    const body = await request.json().catch(() => ({}));
    const { action } = body || {};

    if (action === 'login') {
        if (!env.ADMIN_PASSWORD) return reply({ error: 'ADMIN_PASSWORD is not set on Cloudflare yet.' }, 500);
        if (!(await checkPassword(env, body.password))) {
            await new Promise(r => setTimeout(r, 800));
            return reply({ error: 'Wrong password.' }, 401);
        }
        return reply({ token: await makeToken(env), storage: storageReady(env) });
    }

    const auth = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!(await checkToken(env, auth))) return reply({ error: 'Please log in again.' }, 401);
    if (!storageReady(env)) {
        return reply(
            { error: 'No storage connected on Cloudflare yet (add the Upstash Redis variables to the project).' },
            500
        );
    }

    try {
        if (action === 'state') {
            return reply({ bots: await getBots(env), settings: await getSettings(env) });
        }
        if (action === 'save_bot') {
            const bots = await getBots(env);
            const incoming = body.bot || {};
            const idx = bots.findIndex(b => b.id === incoming.id);
            const bot = cleanBot(incoming, idx >= 0 ? bots[idx] : {});
            if (!bot.name) return reply({ error: 'Give the bot a name.' }, 400);
            if (idx < 0 && bots.length >= 200) return reply({ error: 'Too many bots (limit 200).' }, 400);
            if (idx >= 0) bots[idx] = bot;
            else bots.unshift(bot);
            await setJson(env, 'pm:bots', bots);
            return reply({ bots });
        }
        if (action === 'delete_bot') {
            const bots = (await getBots(env)).filter(b => b.id !== body.id);
            await setJson(env, 'pm:bots', bots);
            return reply({ bots });
        }
        if (action === 'save_settings') {
            const s = body.settings || {};
            const tabs = {};
            Object.keys(s.tabs || {}).forEach(k => {
                if (NAV_STATES.includes(s.tabs[k]) && s.tabs[k] !== 'on') tabs[str(k, 40)] = s.tabs[k];
            });
            const settings = {
                ...DEFAULT_SETTINGS,
                maintenance: { on: Boolean(s.maintenance?.on), message: str(s.maintenance?.message, 400) },
                announcement: { on: Boolean(s.announcement?.on), text: str(s.announcement?.text, 300) },
                tabs,
                copy_trading_paused: Boolean(s.copy_trading_paused),
                contact_link: str(s.contact_link, 500),
                test_mode: {
                    on: Boolean(s.test_mode?.on),
                    accounts: (Array.isArray(s.test_mode?.accounts)
                        ? s.test_mode.accounts
                        : DEFAULT_SETTINGS.test_mode.accounts
                    )
                        .map(a => str(a, 30).trim().toUpperCase())
                        .filter(a => /^[A-Z0-9]{4,20}$/.test(a))
                        .slice(0, 10),
                },
            };
            await setJson(env, 'pm:settings', settings);
            return reply({ settings });
        }
        return reply({ error: 'Unknown action.' }, 400);
    } catch (e) {
        return reply({ error: e.message || 'Something went wrong.' }, 500);
    }
};
