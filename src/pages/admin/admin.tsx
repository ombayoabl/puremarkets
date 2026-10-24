// @ts-nocheck — standalone admin page, talks to /api/admin
import React, { useCallback, useEffect, useState } from 'react';
import { NAV_ITEMS } from '@/constants/bot-contents';
import { DEFAULT_SITE_SETTINGS } from '@/services/site-config';
import './admin.scss';

const TOKEN_KEY = 'pm_admin_token';
const TYPE_LABEL = { free: 'Freebots', premium: 'Premium Bots', strategy: 'Strategies' };
const EMPTY = { id: '', type: 'free', name: '', description: '', price: '', link: '', content: '', xml: '', enabled: true };

const api = async (action: string, payload: any = {}) => {
    const token = sessionStorage.getItem(TOKEN_KEY) || '';
    const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err: any = new Error(data.error || `Error ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
};

const Login = ({ onDone }: { onDone: () => void }) => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const data = await api('login', { password });
            sessionStorage.setItem(TOKEN_KEY, data.token);
            onDone();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <form className='adm-login' onSubmit={submit}>
            <h1>puremarkets admin</h1>
            <input type='password' autoFocus placeholder='Admin password' value={password} onChange={e => setPassword(e.target.value)} />
            <button className='adm-btn adm-btn--main' disabled={busy || !password}>
                {busy ? 'Checking…' : 'Log in'}
            </button>
            {error && <p className='adm-bad'>{error}</p>}
        </form>
    );
};

const BotForm = ({ bot, onSave, onCancel }) => {
    const [b, setB] = useState(bot);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const set = (k: string, v: any) => setB(p => ({ ...p, [k]: v }));
    const readFile = (f?: File) => {
        if (!f) return;
        const r = new FileReader();
        r.onload = () => set('xml', String(r.result || ''));
        r.readAsText(f);
        if (!b.name) set('name', f.name.replace(/\.xml$/i, ''));
    };
    const save = async () => {
        setBusy(true);
        setError('');
        try {
            await onSave(b);
        } catch (e) {
            setError(e.message);
            setBusy(false);
        }
    };
    return (
        <div className='adm-card'>
            <h3>{b.id ? 'Edit' : 'Add'} {TYPE_LABEL[b.type]}</h3>
            <label>Where should it show?</label>
            <select value={b.type} onChange={e => set('type', e.target.value)}>
                {Object.keys(TYPE_LABEL).map(k => (
                    <option key={k} value={k}>{TYPE_LABEL[k]}</option>
                ))}
            </select>
            <label>Name</label>
            <input value={b.name} onChange={e => set('name', e.target.value)} />
            <label>Short description</label>
            <textarea rows={2} value={b.description} onChange={e => set('description', e.target.value)} />
            {b.type === 'premium' && (
                <>
                    <label>Price (shown on the card, e.g. $20)</label>
                    <input value={b.price} onChange={e => set('price', e.target.value)} />
                    <label>Buy / contact link (empty = your contact link in Site controls)</label>
                    <input value={b.link} onChange={e => set('link', e.target.value)} placeholder='https://wa.me/…' />
                </>
            )}
            {b.type === 'strategy' && (
                <>
                    <label>Strategy text (shown in full on the site)</label>
                    <textarea rows={8} value={b.content} onChange={e => set('content', e.target.value)} />
                </>
            )}
            {b.type !== 'premium' && (
                <>
                    <label>Bot file (.xml){b.type === 'strategy' ? ' — optional' : ''}</label>
                    <input type='file' accept='.xml,text/xml' onChange={e => readFile(e.target.files?.[0])} />
                    <textarea rows={4} placeholder='…or paste the bot XML here' value={b.xml} onChange={e => set('xml', e.target.value)} />
                </>
            )}
            {b.type === 'premium' && (
                <p className='adm-muted'>Premium bot files are never shown on the public site. Visitors see the card and a “Get access” button.</p>
            )}
            <label className='adm-check'>
                <input type='checkbox' checked={b.enabled} onChange={e => set('enabled', e.target.checked)} /> Visible on the site
            </label>
            {error && <p className='adm-bad'>{error}</p>}
            <div className='adm-row'>
                <button className='adm-btn adm-btn--main' disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
                <button className='adm-btn' onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
};

const Bots = ({ bots, reload, fail }) => {
    const [filter, setFilter] = useState('all');
    const [editing, setEditing] = useState(null);
    const list = bots.filter(b => filter === 'all' || b.type === filter);
    const save = async (bot: any) => {
        await api('save_bot', { bot });
        setEditing(null);
        await reload();
    };
    const remove = async (b: any) => {
        if (!window.confirm(`Delete “${b.name}”? This removes it from the site.`)) return;
        try {
            await api('delete_bot', { id: b.id });
            await reload();
        } catch (e) {
            fail(e);
        }
    };
    const toggle = async (b: any) => {
        try {
            await api('save_bot', { bot: { ...b, enabled: !b.enabled, xml: undefined } });
            await reload();
        } catch (e) {
            fail(e);
        }
    };
    if (editing) return <BotForm bot={editing} onSave={save} onCancel={() => setEditing(null)} />;
    return (
        <div>
            <div className='adm-row'>
                {['all', 'free', 'premium', 'strategy'].map(k => (
                    <button key={k} className={`adm-chip ${filter === k ? 'adm-chip--on' : ''}`} onClick={() => setFilter(k)}>
                        {k === 'all' ? 'All' : TYPE_LABEL[k]}
                    </button>
                ))}
                <button className='adm-btn adm-btn--main adm-right' onClick={() => setEditing({ ...EMPTY, type: filter === 'all' ? 'free' : filter })}>
                    + Add
                </button>
            </div>
            {list.length === 0 && <p className='adm-muted'>Nothing here yet. Press “+ Add”.</p>}
            {list.map(b => (
                <div key={b.id} className='adm-card adm-item'>
                    <div className='adm-grow'>
                        <b>{b.name}</b> <span className='adm-tag'>{TYPE_LABEL[b.type]}</span>
                        {b.type === 'premium' && b.price && <span className='adm-tag'>{b.price}</span>}
                        {!b.enabled && <span className='adm-tag adm-tag--off'>hidden</span>}
                        <p className='adm-muted'>{b.description}</p>
                    </div>
                    <div className='adm-row'>
                        <button className='adm-btn' onClick={() => toggle(b)}>{b.enabled ? 'Hide' : 'Show'}</button>
                        <button className='adm-btn' onClick={() => setEditing(b)}>Edit</button>
                        <button className='adm-btn adm-btn--danger' onClick={() => remove(b)}>Delete</button>
                    </div>
                </div>
            ))}
        </div>
    );
};

const Controls = ({ settings, reload, fail }) => {
    const [s, setS] = useState(settings);
    const [saved, setSaved] = useState(false);
    const [busy, setBusy] = useState(false);
    useEffect(() => setS(settings), [settings]);
    const set = (k: string, v: any) => {
        setSaved(false);
        setS(p => ({ ...p, [k]: v }));
    };
    const save = async () => {
        setBusy(true);
        try {
            await api('save_settings', { settings: s });
            await reload();
            setSaved(true);
        } catch (e) {
            fail(e);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div>
            <div className='adm-card'>
                <h3>Maintenance mode</h3>
                <label className='adm-check'>
                    <input type='checkbox' checked={s.maintenance.on} onChange={e => set('maintenance', { ...s.maintenance, on: e.target.checked })} />
                    Close the site for visitors (this admin page keeps working)
                </label>
                <textarea rows={2} value={s.maintenance.message} onChange={e => set('maintenance', { ...s.maintenance, message: e.target.value })} />
            </div>
            <div className='adm-card'>
                <h3>Announcement banner</h3>
                <label className='adm-check'>
                    <input type='checkbox' checked={s.announcement.on} onChange={e => set('announcement', { ...s.announcement, on: e.target.checked })} />
                    Show a message bar at the top of every page
                </label>
                <input value={s.announcement.text} onChange={e => set('announcement', { ...s.announcement, text: e.target.value })} />
            </div>
            <div className='adm-card'>
                <h3>Tabs</h3>
                <p className='adm-muted'>On = normal, Coming soon = tab shows the Coming soon page, Hidden = removed from the menu.</p>
                {NAV_ITEMS.map(i => (
                    <div key={i.key} className='adm-item'>
                        <span className='adm-grow'>{i.label}</span>
                        <select value={s.tabs[i.key] || 'on'} onChange={e => set('tabs', { ...s.tabs, [i.key]: e.target.value })}>
                            <option value='on'>On</option>
                            <option value='soon'>Coming soon</option>
                            <option value='hidden'>Hidden</option>
                        </select>
                    </div>
                ))}
            </div>
            <div className='adm-card'>
                <h3>Trading controls</h3>
                <label className='adm-check'>
                    <input type='checkbox' checked={s.copy_trading_paused} onChange={e => set('copy_trading_paused', e.target.checked)} />
                    Pause copy trading for everyone (no trade is copied while this is on)
                </label>
            </div>
            <div className='adm-card'>
                <h3>Test mode</h3>
                <p className='adm-muted'>Tick the box to turn test mode on, untick it to turn it off. While on, a TEST MODE banner shows whenever the logged-in account starts with D or R, or is listed below. The banner always says whether the account is demo or real; nothing about the account is changed.</p>
                <label className='adm-check'>
                    <input type='checkbox' checked={s.test_mode?.on || false} onChange={e => set('test_mode', { ...(s.test_mode || DEFAULT_SITE_SETTINGS.test_mode), on: e.target.checked })} />
                    Turn test mode on
                </label>
                <input
                    value={(s.test_mode?.accounts || DEFAULT_SITE_SETTINGS.test_mode.accounts).join(', ')}
                    onChange={e => set('test_mode', { ...(s.test_mode || DEFAULT_SITE_SETTINGS.test_mode), accounts: e.target.value.split(',').map(a => a.trim()) })}
                    placeholder='DOT93428523, ROT92069621'
                />
            </div>
            <div className='adm-card'>
                <h3>Contact link</h3>
                <p className='adm-muted'>Used by the “Get access” button on Premium Bots that have no link of their own.</p>
                <input value={s.contact_link} onChange={e => set('contact_link', e.target.value)} placeholder='https://wa.me/254…' />
            </div>
            <button className='adm-btn adm-btn--main' disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save controls'}</button>
            {saved && <span className='adm-good'> Saved. Open pages update within about 30 seconds.</span>}
        </div>
    );
};

const AdminPage = () => {
    const [authed, setAuthed] = useState(Boolean(sessionStorage.getItem(TOKEN_KEY)));
    const [data, setData] = useState({ bots: [], settings: DEFAULT_SITE_SETTINGS });
    const [tab, setTab] = useState('bots');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    const fail = useCallback((e: any) => {
        if (e.status === 401) {
            sessionStorage.removeItem(TOKEN_KEY);
            setAuthed(false);
        }
        setError(e.message);
    }, []);
    const reload = useCallback(async () => {
        try {
            const d = await api('state');
            setData({ bots: d.bots, settings: { ...DEFAULT_SITE_SETTINGS, ...d.settings } });
            setError('');
        } catch (e) {
            fail(e);
        } finally {
            setLoading(false);
        }
    }, [fail]);
    useEffect(() => {
        if (authed) reload();
    }, [authed, reload]);

    if (!authed) return <div className='adm'><Login onDone={() => setAuthed(true)} /></div>;
    return (
        <div className='adm'>
            <header className='adm-head'>
                <h1>puremarkets admin</h1>
                <div className='adm-row'>
                    <a className='adm-btn' href='/'>View site</a>
                    <button className='adm-btn' onClick={() => { sessionStorage.removeItem(TOKEN_KEY); setAuthed(false); }}>Log out</button>
                </div>
            </header>
            <div className='adm-row'>
                <button className={`adm-chip ${tab === 'bots' ? 'adm-chip--on' : ''}`} onClick={() => setTab('bots')}>Bots &amp; strategies</button>
                <button className={`adm-chip ${tab === 'controls' ? 'adm-chip--on' : ''}`} onClick={() => setTab('controls')}>Site controls</button>
            </div>
            {error && <p className='adm-bad'>{error}</p>}
            {loading ? <p className='adm-muted'>Loading…</p> : tab === 'bots' ? <Bots bots={data.bots} reload={reload} fail={fail} /> : <Controls settings={data.settings} reload={reload} fail={fail} />}
        </div>
    );
};

export default AdminPage;
