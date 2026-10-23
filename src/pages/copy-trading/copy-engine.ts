// @ts-nocheck — uses the Deriv API classes, which are loosely typed upstream
/**
 * Copy trading: every trade you place in this app is repeated on the accounts whose API token you added.
 *
 * Each copier gets its own WebSocket, opened with that person's token (token -> account list -> one-time
 * OTP URL), so nothing here touches your own connection. Every `buy` that leaves the app (Over One,
 * Under 8, Market Insights, DTrader, Bulk Trader...) is copied with the same contract on their account.
 */
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';
import { isProduction } from '@/components/shared';
import brandConfig from '../../../brand.config.json';

export type CopierAccount = { account_id: string; balance: string; currency: string; account_type: 'demo' | 'real'; status?: string };
export type Copier = {
    id: string; // account id
    token: string;
    account_type: 'demo' | 'real';
    currency: string;
    balance: string;
    enabled: boolean;
    multiplier: number; // stake x multiplier
    max_stake: number; // 0 = no cap
    status: 'connecting' | 'connected' | 'offline';
    copied: number;
    failed: number;
    last_error: string;
};
export type CopyLog = { id: number; time: number; account: string; text: string; ok: boolean };

const STORE_KEY = 'copy_trading_copiers';
const round2 = (n: number) => Math.round(n * 100) / 100;
const base = () => brandConfig.platform.derivws.url[isProduction() ? 'production' : 'staging'];
const dir = () => brandConfig.platform.derivws.directories.options;

/** Accounts that belong to an API token (used to let the user pick which account to copy onto). */
export const fetchAccounts = async (token: string): Promise<CopierAccount[]> => {
    const res = await fetch(`${base()}${dir()}accounts`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'That token was not accepted.' : `Could not read the accounts (${res.status}).`);
    const body = await res.json();
    const list = body?.data || [];
    if (!list.length) throw new Error('No accounts found for that token.');
    return list;
};

const fetchSocketUrl = async (token: string, account_id: string): Promise<string> => {
    const res = await fetch(`${base()}${dir()}accounts/${account_id}/otp`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Could not open a trading connection (${res.status}).`);
    const body = await res.json();
    const url = body?.data?.url;
    if (!url) throw new Error('No connection address came back for that account.');
    return url;
};

class CopyEngine {
    copiers: Copier[] = [];
    log: CopyLog[] = [];
    on = true; // master switch
    private sockets = new Map<string, WebSocket>();
    private pending = new Map<string, Map<number, { resolve: (v: any) => void; timer: any }>>();
    private seq = 0;
    private log_id = 0;
    private listeners = new Set<() => void>();
    private handled = new WeakSet<object>();
    private retries = new Map<string, number>();
    private pings = new Map<string, any>();

    constructor() {
        try {
            const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]');
            saved.forEach((c: Copier) => {
                this.copiers.push({ ...c, status: 'connecting', copied: c.copied || 0, failed: c.failed || 0, last_error: '' });
            });
            this.copiers.forEach(c => this.connect(c));
        } catch (e) {
            // nothing saved
        }
    }

    subscribe(fn: () => void) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    private emit() {
        try {
            sessionStorage.setItem(STORE_KEY, JSON.stringify(this.copiers));
        } catch (e) {
            // storage is optional
        }
        this.listeners.forEach(fn => fn());
    }

    async add(token: string, account: CopierAccount, multiplier = 1, max_stake = 0) {
        if (this.copiers.some(c => c.id === account.account_id)) throw new Error('That account is already added.');
        const c: Copier = {
            id: account.account_id,
            token,
            account_type: account.account_type,
            currency: account.currency,
            balance: account.balance,
            enabled: true,
            multiplier,
            max_stake,
            status: 'connecting',
            copied: 0,
            failed: 0,
            last_error: '',
        };
        this.copiers.push(c);
        this.emit();
        this.connect(c);
    }

    remove(id: string) {
        this.copiers = this.copiers.filter(c => c.id !== id);
        this.close(id);
        this.emit();
    }

    update(id: string, patch: Partial<Copier>) {
        const c = this.copiers.find(x => x.id === id);
        if (!c) return;
        Object.assign(c, patch);
        this.emit();
    }

    setOn(on: boolean) {
        this.on = on;
        this.emit();
    }

    clearLog() {
        this.log = [];
        this.emit();
    }

    private close(id: string) {
        clearInterval(this.pings.get(id));
        this.pings.delete(id);
        const ws = this.sockets.get(id);
        this.sockets.delete(id);
        if (ws) {
            ws.onclose = null;
            try {
                ws.close();
            } catch (e) {
                // already closed
            }
        }
        this.pending.delete(id);
    }

    async connect(c: Copier) {
        this.close(c.id);
        c.status = 'connecting';
        this.emit();
        try {
            const url = await fetchSocketUrl(c.token, c.id);
            if (!this.copiers.includes(c)) return;
            const ws = new WebSocket(url);
            this.sockets.set(c.id, ws);
            this.pending.set(c.id, new Map());
            ws.onopen = () => {
                c.status = 'connected';
                c.last_error = '';
                this.retries.set(c.id, 0);
                this.pings.set(c.id, setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ ping: 1 })), 25000));
                this.emit();
            };
            ws.onmessage = ev => {
                let data: any;
                try {
                    data = JSON.parse(ev.data);
                } catch (e) {
                    return;
                }
                const w = this.pending.get(c.id)?.get(data.req_id);
                if (w) {
                    clearTimeout(w.timer);
                    this.pending.get(c.id)?.delete(data.req_id);
                    w.resolve(data);
                }
            };
            ws.onclose = () => {
                if (!this.copiers.includes(c)) return;
                c.status = 'offline';
                this.emit();
                const n = (this.retries.get(c.id) || 0) + 1;
                this.retries.set(c.id, n);
                if (n <= 5) setTimeout(() => this.copiers.includes(c) && c.status === 'offline' && this.connect(c), 2000 * n);
            };
            ws.onerror = () => {};
        } catch (e) {
            c.status = 'offline';
            c.last_error = e?.message || 'Could not connect.';
            this.emit();
        }
    }

    private request(c: Copier, req: any): Promise<any> {
        return new Promise(resolve => {
            const ws = this.sockets.get(c.id);
            if (!ws || ws.readyState !== 1) return resolve({ error: { message: 'Connection is offline.' } });
            const req_id = ++this.seq;
            const timer = setTimeout(() => {
                this.pending.get(c.id)?.delete(req_id);
                resolve({ error: { message: 'No answer from Deriv.' } });
            }, 15000);
            this.pending.get(c.id)?.set(req_id, { resolve, timer });
            ws.send(JSON.stringify({ ...req, req_id }));
        });
    }

    private addLog(account: string, text: string, ok: boolean) {
        this.log.unshift({ id: ++this.log_id, time: Date.now(), account, text, ok });
        if (this.log.length > 60) this.log.length = 60;
    }

    /** Copy one `buy` request (called for every trade the app places). */
    mirror(req: any) {
        if (!this.on || !req || req.buy !== '1' || !req.parameters || typeof req.parameters !== 'object') return;
        if (this.handled.has(req)) return; // already copied (shared connection fallback)
        this.handled.add(req);
        const p = req.parameters;
        this.copiers.forEach(c => {
            if (!c.enabled || c.status !== 'connected') return;
            let amount = round2(Number(p.amount) * (c.multiplier || 1));
            if (c.max_stake > 0) amount = Math.min(amount, c.max_stake);
            if (!(amount > 0)) return;
            const label = `${String(p.contract_type || '').replace('DIGIT', '')} ${p.barrier ?? ''} ${p.underlying_symbol || p.symbol || ''}`.trim();
            this.request(c, {
                buy: '1',
                price: amount,
                parameters: { ...p, amount, currency: c.currency },
            }).then(res => {
                if (res?.buy?.contract_id) {
                    c.copied += 1;
                    this.addLog(c.id, `${label} · stake ${amount} ${c.currency}`, true);
                } else {
                    c.failed += 1;
                    c.last_error = res?.error?.message || 'The trade was not accepted.';
                    this.addLog(c.id, `${label} · ${c.last_error}`, false);
                }
                this.emit();
            });
        });
    }
}

export const copyEngine = new CopyEngine();

let installed = false;
/** Every `buy` the app sends through the Deriv API is copied; the app's own trade is sent first, unchanged. */
export const installCopyHook = () => {
    if (installed || !DerivAPIBasic?.prototype?.send) return;
    installed = true;
    const original = DerivAPIBasic.prototype.send;
    DerivAPIBasic.prototype.send = function (...args: any[]) {
        try {
            copyEngine.mirror(args[0]);
        } catch (e) {
            // copying must never break your own trade
        }
        return original.apply(this, args);
    };
};
installCopyHook();
