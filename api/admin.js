// Admin back end: one endpoint, POST { action, ... } with a bearer token (except "login").
const { storageReady, getBots, getSettings, setJson, makeToken, checkToken, checkPassword, DEFAULT_SETTINGS } = require('./_lib');
const crypto = require('crypto');

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

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { action } = body;

    if (action === 'login') {
        if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD is not set on Vercel yet.' });
        if (!checkPassword(body.password)) {
            await new Promise(r => setTimeout(r, 800));
            return res.status(401).json({ error: 'Wrong password.' });
        }
        return res.status(200).json({ token: makeToken(), storage: storageReady() });
    }

    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!checkToken(auth)) return res.status(401).json({ error: 'Please log in again.' });
    if (!storageReady()) return res.status(500).json({ error: 'No storage connected on Vercel yet (add Upstash Redis / KV to the project).' });

    try {
        if (action === 'state') {
            return res.status(200).json({ bots: await getBots(), settings: await getSettings() });
        }
        if (action === 'save_bot') {
            const bots = await getBots();
            const incoming = body.bot || {};
            const idx = bots.findIndex(b => b.id === incoming.id);
            const bot = cleanBot(incoming, idx >= 0 ? bots[idx] : {});
            if (!bot.name) return res.status(400).json({ error: 'Give the bot a name.' });
            if (idx < 0 && bots.length >= 200) return res.status(400).json({ error: 'Too many bots (limit 200).' });
            if (idx >= 0) bots[idx] = bot;
            else bots.unshift(bot);
            await setJson('pm:bots', bots);
            return res.status(200).json({ bots });
        }
        if (action === 'delete_bot') {
            const bots = (await getBots()).filter(b => b.id !== body.id);
            await setJson('pm:bots', bots);
            return res.status(200).json({ bots });
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
            };
            await setJson('pm:settings', settings);
            return res.status(200).json({ settings });
        }
        return res.status(400).json({ error: 'Unknown action.' });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Something went wrong.' });
    }
};
