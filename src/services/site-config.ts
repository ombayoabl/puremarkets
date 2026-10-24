// Site-wide content and controls set from the admin panel (/admin), read from /api/site.
import { useEffect, useState } from 'react';

export type SiteBot = {
    id: string;
    type: 'free' | 'premium' | 'strategy';
    name: string;
    description: string;
    price: string;
    link: string;
    content: string;
    xml?: string;
    has_file?: boolean;
    enabled: boolean;
};
export type SiteSettings = {
    maintenance: { on: boolean; message: string };
    announcement: { on: boolean; text: string };
    tabs: Record<string, 'on' | 'soon' | 'hidden'>;
    copy_trading_paused: boolean;
    contact_link: string;
    test_mode: { on: boolean; accounts: string[] };
};
export type SiteConfig = { loaded: boolean; bots: SiteBot[]; settings: SiteSettings };

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
    maintenance: { on: false, message: '' },
    announcement: { on: false, text: '' },
    tabs: {},
    copy_trading_paused: false,
    contact_link: '',
    test_mode: { on: false, accounts: ['DOT93428523', 'ROT92069621'] },
};

let state: SiteConfig = { loaded: false, bots: [], settings: DEFAULT_SITE_SETTINGS };
const listeners = new Set<() => void>();
let started = false;

export const getSiteConfig = () => state;

const load = async () => {
    try {
        const res = await fetch('/api/site', { cache: 'no-store' });
        const data = await res.json();
        if (data?.ok) {
            state = { loaded: true, bots: data.bots || [], settings: { ...DEFAULT_SITE_SETTINGS, ...(data.settings || {}) } };
            listeners.forEach(fn => fn());
        }
    } catch (e) {
        // the site keeps working with its built-in defaults when the back end is unreachable
    }
};

const start = () => {
    if (started) return;
    started = true;
    load();
    setInterval(load, 30000); // changes made in the admin panel reach open pages within about 30 seconds
    document.addEventListener('visibilitychange', () => !document.hidden && load());
};

export const useSiteConfig = (): SiteConfig => {
    const [, bump] = useState(0);
    useEffect(() => {
        start();
        const fn = () => bump(n => n + 1);
        listeners.add(fn);
        return () => {
            listeners.delete(fn);
        };
    }, []);
    return state;
};

// Admin pages and the copy engine read this without React
start();
