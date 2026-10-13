const mockGetUrl = jest.fn();

jest.mock('@/external/deriv-core', () => ({ getAuthInfo: () => ({ access_token: 'tok' }) }));
jest.mock('@/services/derivws-accounts.service', () => ({
    DerivWSAccountsService: { getAuthenticatedWebSocketURL: (...args: unknown[]) => mockGetUrl(...args) },
}));

class FakeSocket {
    static instances: FakeSocket[] = [];
    static OPEN = 1;
    readyState = 0;
    sent: any[] = [];
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    constructor(public url: string) {
        FakeSocket.instances.push(this);
        setTimeout(() => {
            this.readyState = 1;
            this.onopen?.();
        }, 0);
    }
    send(data: string) {
        const msg = JSON.parse(data);
        this.sent.push(msg);
        if (msg.buy) {
            setTimeout(() => this.onmessage?.({ data: JSON.stringify({ req_id: msg.req_id, buy: { contract_id: 1 } }) }), 0);
        }
    }
    close() {
        this.readyState = 3;
        this.onclose?.();
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).WebSocket = FakeSocket;

// eslint-disable-next-line import/first
import { batch_lanes } from '../batch-sockets';

describe('batch_lanes', () => {
    let n = 0;
    beforeEach(() => {
        FakeSocket.instances = [];
        n = 0;
        mockGetUrl.mockImplementation(async () => `wss://example/otp-${(n += 1)}`);
    });
    afterEach(() => batch_lanes.close());

    it('uses a different one-time URL for every extra lane', async () => {
        await batch_lanes.warm(3);
        expect(FakeSocket.instances.map(s => s.url)).toEqual(['wss://example/otp-1', 'wss://example/otp-2', 'wss://example/otp-3']);
    });

    it('spreads a batch across the shared connection and the extra lanes', async () => {
        await batch_lanes.warm(2);
        const shared = jest.fn().mockResolvedValue({ buy: { contract_id: 99 } });
        await Promise.all(Array.from({ length: 6 }, (_, i) => batch_lanes.send(i, { buy: '1' }, shared)));
        expect(shared).toHaveBeenCalledTimes(2);
        expect(FakeSocket.instances.map(s => s.sent.filter(m => m.buy).length)).toEqual([2, 2]);
    });

    it('falls back to the shared connection when no extra lanes are open', async () => {
        const shared = jest.fn().mockResolvedValue({ buy: { contract_id: 99 } });
        await Promise.all(Array.from({ length: 4 }, (_, i) => batch_lanes.send(i, { buy: '1' }, shared)));
        expect(shared).toHaveBeenCalledTimes(4);
    });

    it('never re-sends a buy that was already written when its lane drops', async () => {
        await batch_lanes.warm(1);
        const lane = FakeSocket.instances[0];
        lane.send = () => {}; // swallow the write, no reply
        const shared = jest.fn();
        const pending = batch_lanes.send(1, { buy: '1' }, shared);
        lane.close();
        await expect(pending).rejects.toThrow(/closed before a reply/);
        expect(shared).not.toHaveBeenCalled();
    });

    it('rejects with the API error body so callers can read error.message', async () => {
        await batch_lanes.warm(1);
        const lane = FakeSocket.instances[0];
        lane.send = (data: string) => {
            const { req_id } = JSON.parse(data);
            setTimeout(() => lane.onmessage?.({ data: JSON.stringify({ req_id, error: { message: 'nope' } }) }), 0);
        };
        await expect(batch_lanes.send(1, { buy: '1' }, jest.fn())).rejects.toMatchObject({ error: { message: 'nope' } });
    });
});
