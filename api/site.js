// Public: what the website needs to show (bots + site controls). No secrets, no premium bot files.
const { getBots, getSettings, storageReady } = require('./_lib');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=30');
    try {
        const [bots, settings] = await Promise.all([getBots(), getSettings()]);
        const visible = bots
            .filter(b => b.enabled !== false)
            .map(b => (b.type === 'premium' ? { ...b, xml: undefined, has_file: Boolean(b.xml) } : b));
        res.status(200).json({ ok: true, storage: storageReady(), bots: visible, settings });
    } catch (e) {
        res.status(200).json({ ok: false, storage: storageReady(), bots: [], settings: null });
    }
};
