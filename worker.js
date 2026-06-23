// iptv-cors-proxy — Cloudflare Worker
// Forwards requests to activationpanel.ru and adds CORS headers
// so the GitHub Pages dashboard can reach the panel API from the browser.

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    // Only allow proxying to activationpanel.ru
    const target = 'https://activationpanel.ru' + url.pathname + url.search;

    try {
      const res = await fetch(target, {
        method: request.method,
        headers: { 'Content-Type': 'application/json' },
        body: request.method === 'POST' ? request.body : undefined,
      });

      const body = await res.text();

      return new Response(body, {
        status: res.status,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
        },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
};
