// @ts-nocheck — uses the shared copy engine, which is loosely typed upstream
import React, { useEffect, useReducer, useState } from 'react';
import { localize } from '@deriv-com/translations';
import '../bulk-trader/bulk-trader.scss';
import { copyEngine, fetchAccounts, myAccountType } from './copy-engine';

// A big tick box that always shows its state (green for real, black for demo), whatever the theme
const Tick = ({ checked, onChange, label, color }: { checked: boolean; onChange: (v: boolean) => void; label: string; color: string }) => (
    <button
        type='button'
        role='checkbox'
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: 0,
            border: 0,
            background: 'none',
            color: 'inherit',
            font: 'inherit',
            cursor: 'pointer',
            textAlign: 'left',
        }}
    >
        <span
            style={{
                flex: '0 0 auto',
                width: 26,
                height: 26,
                borderRadius: 5,
                border: '2px solid #fff',
                boxShadow: '0 0 0 2px #888',
                background: checked ? color : 'transparent',
                color: '#fff',
                fontSize: 18,
                fontWeight: 700,
                lineHeight: '22px',
                textAlign: 'center',
            }}
        >
            {checked ? '✓' : ''}
        </span>
        <span>
            {label} <b>{checked ? localize('(ON)') : localize('(OFF)')}</b>
        </span>
    </button>
);

const CopyTrading = () => {
    const [, refresh] = useReducer((n: number) => n + 1, 0);
    const [token, setToken] = useState('');
    const [accounts, setAccounts] = useState<any[]>([]);
    const [pick, setPick] = useState('');
    const [app_id, setAppId] = useState('');
    const [mult, setMult] = useState('1');
    const [cap, setCap] = useState('0');
    const [agree, setAgree] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => copyEngine.subscribe(refresh), []);

    const find = async () => {
        setError('');
        setAccounts([]);
        setPick('');
        if (!token.trim()) return setError(localize('Paste the API token first.'));
        setBusy(true);
        try {
            const list = await fetchAccounts(token.trim(), app_id);
            setAccounts(list);
            const mine = myAccountType();
            const match = list.find((a: any) => (!mine || a.account_type === mine) && copyEngine.allow[a.account_type]);
            if (mine && !list.some((a: any) => a.account_type === mine)) {
                setError(
                    `${localize('You are trading on a')} ${mine.toUpperCase()} ${localize('account, and that token has no')} ${mine.toUpperCase()} ${localize('account to copy onto.')}`
                );
            }
            setPick(match ? match.account_id : '');
        } catch (e) {
            setError(e?.message || localize('Could not read that token.'));
        } finally {
            setBusy(false);
        }
    };

    const add = async () => {
        setError('');
        const account = accounts.find(a => a.account_id === pick);
        if (!account) return setError(localize('Choose the account to copy onto first. Greyed accounts are not allowed: tick real to real or demo to demo, and use the same type as the account you trade on.'));
        if (!agree) return setError(localize('Tick the box saying this person agreed, then press Start copying.'));
        try {
            await copyEngine.add(token.trim(), account, Math.max(0.01, Number(mult) || 1), Math.max(0, Number(cap) || 0), app_id);
            setToken('');
            setAccounts([]);
            setPick('');
            setAgree(false);
        } catch (e) {
            setError(e?.message || localize('Could not add that account.'));
        }
    };

    const mine = myAccountType();
    const dot = (s: string) => (s === 'connected' ? '#14b86e' : s === 'connecting' ? '#e0a800' : '#c0283c');

    return (
        <div className='bulk'>
            <h3 className='bulk__title' style={{ margin: '0 0 8px', fontWeight: 700 }}>
                {localize('Copy Trading')}
            </h3>
            <p className='bulk__hint'>
                {localize(
                    'Add another person’s Deriv API token and every trade you place in this app (Over One, Under 8, Market Insights, DTrader, Bulk Trader) is placed on their account too. Their trades are real trades on their account.'
                )}
            </p>

            <div className='bulk__modes' style={{ flexWrap: 'wrap', rowGap: 12 }}>
                <Tick
                    color='#14b86e'
                    checked={copyEngine.allow.real}
                    onChange={v => copyEngine.setAllow('real', v)}
                    label={localize('Enable real account to real account')}
                />
                <Tick
                    color='#000'
                    checked={copyEngine.allow.demo}
                    onChange={v => copyEngine.setAllow('demo', v)}
                    label={localize('Enable demo account to demo account')}
                />
            </div>
            <p className='bulk__muted'>
                {mine
                    ? `${localize('You are trading on a')} ${mine.toUpperCase()} ${localize('account: trades are copied onto')} ${mine.toUpperCase()} ${localize('accounts only (real to real, demo to demo).')}`
                    : localize('Real is copied onto real and demo onto demo. Log in so the app knows which one you are on.')}
            </p>
            <p className='bulk__muted'>{localize('A demo token only works with demo to demo, and a real token only works with real to real.')}</p>
            {!copyEngine.on && <p className='bulk__bad'>{localize('Tick real to real or demo to demo first, then paste the token.')}</p>}

            <div className='bulk__field' style={{ marginTop: 12 }}>
                <label className='bulk__label'>{localize('Their API token')}</label>
                <input
                    className='bulk__input'
                    type='password'
                    autoComplete='off'
                    placeholder={localize('Paste the token they gave you')}
                    disabled={!copyEngine.on}
                    value={token}
                    onChange={e => setToken(e.target.value)}
                />
            </div>
            <div className='bulk__field' style={{ marginTop: 8 }}>
                <label className='bulk__label'>{localize('App ID (leave empty unless Deriv rejects the token)')}</label>
                <input className='bulk__input' type='text' autoComplete='off' disabled={!copyEngine.on} value={app_id} onChange={e => setAppId(e.target.value)} />
            </div>
            <button type='button' className='bulk__run' disabled={busy || !copyEngine.on} onClick={find} style={{ marginTop: 8 }}>
                {busy ? localize('Checking…') : localize('Find their accounts')}
            </button>
            {error && <p className='bulk__bad'>{error}</p>}
            {token.trim() && !token.trim().startsWith('pat_') && (
                <p className='bulk__muted'>{localize('Deriv tokens start with pat_. Check that you copied the whole token.')}</p>
            )}

            {accounts.length > 0 && (
                <div style={{ marginTop: 12 }}>
                    <label className='bulk__label'>{localize('Copy onto which account?')}</label>
                    {accounts.map(a => {
                        const ok = (!mine || a.account_type === mine) && copyEngine.allow[a.account_type];
                        return (
                            <label key={a.account_id} className='bulk__check' style={{ display: 'flex', gap: 8, margin: '6px 0', opacity: ok ? 1 : 0.5 }}>
                                <input type='radio' name='copy_account' disabled={!ok} checked={pick === a.account_id} onChange={() => setPick(a.account_id)} />
                                <span>
                                    {a.account_id} · <b>{a.account_type === 'real' ? localize('REAL') : localize('DEMO')}</b> · {a.balance} {a.currency}
                                    {!ok &&
                                        ` · ${
                                            copyEngine.allow[a.account_type]
                                                ? `${localize('not allowed: you are on a')} ${mine.toUpperCase()} ${localize('account')}`
                                                : `${localize('tick')} ${a.account_type === 'real' ? localize('real to real') : localize('demo to demo')} ${localize('first')}`
                                        }`}
                                </span>
                            </label>
                        );
                    })}
                    <div className='bulk__grid'>
                        <div className='bulk__field'>
                            <label className='bulk__label'>{localize('Stake multiplier (1 = same stake as yours)')}</label>
                            <input className='bulk__input' type='number' min='0.01' step='0.1' value={mult} onChange={e => setMult(e.target.value)} />
                        </div>
                        <div className='bulk__field'>
                            <label className='bulk__label'>{localize('Highest stake per trade (0 = no limit)')}</label>
                            <input className='bulk__input' type='number' min='0' step='0.5' value={cap} onChange={e => setCap(e.target.value)} />
                        </div>
                    </div>
                    <label className='bulk__check' style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
                        <input type='checkbox' checked={agree} onChange={e => setAgree(e.target.checked)} />
                        <span>{localize('This person gave me their token and agreed to have my trades placed on their account.')}</span>
                    </label>
                    <button type='button' className='bulk__run' onClick={add}>
                        {localize('Start copying onto this account')}
                    </button>
                    {error && <p className='bulk__bad'>{error}</p>}
                </div>
            )}

            <div style={{ marginTop: 20 }}>
                <label className='bulk__label'>{localize('Copying onto')}</label>
                {copyEngine.copiers.length === 0 && <p className='bulk__muted'>{localize('No account added yet.')}</p>}
                {copyEngine.copiers.map(c => (
                    <div key={c.id} className='bulk__box' style={{ margin: '8px 0', padding: 12, border: '1px solid var(--border-normal, #8884)', borderRadius: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: dot(c.status) }} />
                            <b>{c.id}</b>
                            <span>{c.account_type === 'real' ? localize('REAL') : localize('DEMO')}</span>
                            <span>
                                {c.balance} {c.currency}
                            </span>
                            <span className='bulk__muted'>
                                {c.status === 'connected' ? localize('connected') : c.status === 'connecting' ? localize('connecting…') : localize('offline')}
                            </span>
                        </div>
                        <p className='bulk__muted' style={{ margin: '6px 0' }}>
                            {localize('Copied')}: <span className='bulk__good'>{c.copied}</span> · {localize('Failed')}: <span className='bulk__bad'>{c.failed}</span>
                            {c.last_error ? ` · ${c.last_error}` : ''}
                        </p>
                        {mine && c.account_type !== mine && (
                            <p className='bulk__bad'>
                                {localize('Paused: you are on a')} {mine.toUpperCase()} {localize('account and this one is')} {c.account_type.toUpperCase()}.
                            </p>
                        )}
                        <div className='bulk__grid'>
                            <div className='bulk__field'>
                                <label className='bulk__label'>{localize('Stake multiplier')}</label>
                                <input
                                    className='bulk__input'
                                    type='number'
                                    min='0.01'
                                    step='0.1'
                                    value={c.multiplier}
                                    onChange={e => copyEngine.update(c.id, { multiplier: Math.max(0.01, Number(e.target.value) || 1) })}
                                />
                            </div>
                            <div className='bulk__field'>
                                <label className='bulk__label'>{localize('Highest stake (0 = no limit)')}</label>
                                <input
                                    className='bulk__input'
                                    type='number'
                                    min='0'
                                    step='0.5'
                                    value={c.max_stake}
                                    onChange={e => copyEngine.update(c.id, { max_stake: Math.max(0, Number(e.target.value) || 0) })}
                                />
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                            <label className='bulk__check'>
                                <input type='checkbox' checked={c.enabled} onChange={e => copyEngine.update(c.id, { enabled: e.target.checked })} />
                                <span>{localize('Copy to this account')}</span>
                            </label>
                            {c.status === 'offline' && (
                                <button type='button' className='bulk__run' onClick={() => copyEngine.connect(c)}>
                                    {localize('Reconnect')}
                                </button>
                            )}
                            <button type='button' className='bulk__stop' onClick={() => copyEngine.remove(c.id)}>
                                {localize('Remove')}
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className='bulk__log' style={{ marginTop: 16 }}>
                <div className='bulk__log-head'>
                    <span>{localize('Copied trades')}</span>
                    {copyEngine.log.length > 0 && (
                        <button type='button' className='bulk__stop' onClick={() => copyEngine.clearLog()}>
                            {localize('Clear')}
                        </button>
                    )}
                </div>
                {copyEngine.log.length === 0 && <p className='bulk__muted'>{localize('Trades you place will show here as they are copied.')}</p>}
                {copyEngine.log.map(l => (
                    <p key={l.id} className={l.ok ? 'bulk__good' : 'bulk__bad'} style={{ margin: '2px 0' }}>
                        {new Date(l.time).toLocaleTimeString()} · {l.account} · {l.text}
                    </p>
                ))}
            </div>
        </div>
    );
};

export default CopyTrading;
