// Cloudflare Worker entry (Workers + static assets). Only /api/* reaches this code (see wrangler.jsonc:
// run_worker_first); every other request is served straight from the built site in dist/.
import { onRequest as admin } from '../functions/api/admin';
import { onRequestGet as site } from '../functions/api/site';

export default {
    async fetch(request, env, ctx) {
        const { pathname } = new URL(request.url);
        if (pathname === '/api/admin') return admin({ request, env, ctx });
        if (pathname === '/api/site') {
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                return new Response(JSON.stringify({ error: 'Use GET.' }), {
                    status: 405,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return site({ request, env, ctx });
        }
        return env.ASSETS.fetch(request);
    },
};
