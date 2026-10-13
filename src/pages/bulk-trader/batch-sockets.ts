/**
 * Extra authenticated WebSocket "lanes" for the Bulk Trader.
 *
 * Deriv handles the requests on a single connection one after another, so 50 `buy` calls
 * sent down the one shared socket come out as a queue. Spreading a batch over several
 * connections (same account, own one-time OTP URL each) lets them execute side by side.
 *
 * Slot 0 of every batch is always the app's normal shared connection, so if the extra
 * lanes are not open yet (or cannot be opened) trades simply go out the way they did before.
 */
import { getAuthInfo } from '@/external/deriv-core';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';

/** Extra connections on top of the shared one => up to 10 parallel lanes. */
export const MAX_EXTRA_LANES = 9;

const OPEN_TIMEOUT_MS = 8000;
const REQUEST_TIMEOUT_MS = 15000;
const PING_INTERVAL_MS = 25000;
// The OTP helper reuses an in-flight/just-finished request for ~100ms, which would hand two
// lanes the same one-time URL. Keep fetches further apart than that.
const OTP_SPACING_MS = 180;

type TRequest = Record<string, unknown>;
type TPending = { resolve: (value: any) => void; reject: (reason: any) => void; timer: ReturnType<typeof setTimeout> };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** The request never left this machine, so it is safe to send it down another connection. */
const notSent = (message: string) => Object.assign(new Error(message), { not_sent: true });

class Lane {
    private pending = new Map<number, TPending>();
    private seq = 0;
    private ping: ReturnType<typeof setInterval>;
    private closed = false;

    private constructor(private ws: WebSocket) {
        ws.onmessage = event => this.onMessage(event);
        ws.onclose = () => this.shutdown();
        ws.onerror = () => {};
        this.ping = setInterval(() => {
            if (this.ready) this.ws.send(JSON.stringify({ ping: 1 }));
        }, PING_INTERVAL_MS);
    }

    static connect(url: string): Promise<Lane> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            const timer = setTimeout(() => {
                ws.close();
                reject(new Error('Timed out opening trade connection'));
            }, OPEN_TIMEOUT_MS);
            ws.onopen = () => {
                clearTimeout(timer);
                resolve(new Lane(ws));
            };
            ws.onerror = () => {
                clearTimeout(timer);
                reject(new Error('Could not open trade connection'));
            };
            ws.onclose = () => {
                clearTimeout(timer);
                reject(new Error('Trade connection closed before opening'));
            };
        });
    }

    get ready() {
        return !this.closed && this.ws.readyState === WebSocket.OPEN;
    }

    send(request: TRequest): Promise<any> {
        if (!this.ready) return Promise.reject(notSent('Trade connection is not open'));
        const req_id = (this.seq += 1);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(req_id);
                reject(new Error('Trade request timed out'));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(req_id, { resolve, reject, timer });
            try {
                this.ws.send(JSON.stringify({ ...request, req_id }));
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(req_id);
                reject(notSent((error as Error)?.message || 'Could not write to trade connection'));
            }
        });
    }

    close() {
        try {
            this.ws.close();
        } catch {
            /* already closed */
        }
        this.shutdown();
    }

    private onMessage(event: MessageEvent) {
        let message: any;
        try {
            message = JSON.parse(event.data);
        } catch {
            return;
        }
        const entry = this.pending.get(message?.req_id);
        if (!entry) return;
        this.pending.delete(message.req_id);
        clearTimeout(entry.timer);
        // Same contract as the shared API: errors reject with the whole response (`.error.message`).
        if (message.error) entry.reject(message);
        else entry.resolve(message);
    }

    private shutdown() {
        this.closed = true;
        clearInterval(this.ping);
        this.pending.forEach(entry => {
            clearTimeout(entry.timer);
            // The request was written and no answer came back, so the buy may or may not have
            // happened. Never retry this one.
            entry.reject(new Error('Trade connection closed before a reply'));
        });
        this.pending.clear();
    }
}

class BatchLanes {
    private lanes: Lane[] = [];
    private queue: Promise<void> = Promise.resolve();
    private epoch = 0;

    /** Open extra lanes in the background until `extra` are ready (capped). Never throws. */
    warm(extra: number): Promise<void> {
        const target = Math.min(Math.max(Math.floor(extra) || 0, 0), MAX_EXTRA_LANES);
        this.queue = this.queue.then(() => this.fill(target)).catch(() => {});
        return this.queue;
    }

    /** Send one request on lane `index` of the batch (0 = the app's shared connection). */
    send(index: number, request: TRequest, send_on_shared: (request: TRequest) => Promise<any>): Promise<any> {
        const ready = this.lanes.filter(lane => lane.ready);
        const slot = index % (ready.length + 1);
        if (slot === 0) return send_on_shared(request);
        return ready[slot - 1].send(request).catch(error => {
            if (error?.not_sent) return send_on_shared(request);
            throw error;
        });
    }

    /** Close every extra lane (log out, account switch, leaving the page). */
    close() {
        this.epoch += 1;
        this.lanes.forEach(lane => lane.close());
        this.lanes = [];
    }

    private async fill(target: number) {
        const my_epoch = this.epoch;
        this.lanes = this.lanes.filter(lane => lane.ready);
        let failures = 0;
        while (this.lanes.length < target && my_epoch === this.epoch && failures < 2) {
            try {
                const auth = getAuthInfo();
                if (!auth?.access_token) return;
                const url = await DerivWSAccountsService.getAuthenticatedWebSocketURL(auth.access_token);
                const lane = await Lane.connect(url);
                if (my_epoch !== this.epoch) {
                    lane.close();
                    return;
                }
                this.lanes.push(lane);
            } catch (error) {
                failures += 1;
                // eslint-disable-next-line no-console
                console.warn('[BulkTrader] could not open an extra trade connection:', error);
            }
            await sleep(OTP_SPACING_MS);
        }
    }
}

export const batch_lanes = new BatchLanes();
