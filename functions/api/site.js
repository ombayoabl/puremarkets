// Public: what the website needs to show (bots + site controls). No secrets, no premium bot files.
import { getBots, getSettings, json, storageReady } from '../_shared/store';

export const onRequestGet = async ({ env }) => {
    const cache = { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=30' };
    try {
        const [bots, settings] = await Promise.all([getBots(env), getSettings(env)]);
        const visible = bots
            .filter(b => b.enabled !== false)
            .map(b => (b.type === 'premium' ? { ...b, xml: undefined, has_file: Boolean(b.xml) } : b));
        return json({ ok: true, storage: storageReady(env), bots: visible, settings }, 200, cache);
    } catch (e) {
        return json({ ok: false, storage: storageReady(env), bots: [], settings: null }, 200, cache);
    }
};
