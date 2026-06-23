/**
 * iptv-cors-proxy — CORS proxy + /trials endpoint
 * /trials: tries all known panel API action/sub combos, returns parsed trial list
 * /* : generic proxy to activationpanel.ru
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const API_KEY = '35cf68cc83a3a82e1a0ac536lc7b6105';  // placeholder, overridden by env or query param
const BASE    = 'https://activationpanel.ru/api/api.php';

async function tryAction(apiKey, params) {
  try {
    const qs  = new URLSearchParams({ ...params, api_key: apiKey });
    const res = await fetch(`${BASE}?${qs}`);
    const txt = await res.text();
    if (!txt || !res.ok) return [];
    const parsed = JSON.parse(txt);
    if (!parsed || parsed.status === 'error') return [];
    const arr = Array.isArray(parsed) ? parsed
              : Array.isArray(parsed.result) ? parsed.result
              : Array.isArray(parsed.data)   ? parsed.data
              : Array.isArray(parsed.lines)  ? parsed.lines
              : null;
    return arr || [];
  } catch { return []; }
}

function parseNote(line) {
  // Notes format: "Trial / site.com / email@x.com | +1234567890"
  const note = line.note || line.notes || '';
  const m = note.match(/Trial\s*\/\s*([^/]+?)\s*\/\s*([^|]+?)\s*\|?\s*([+\d\s]*)$/i);
  if (!m) return null;
  const phone = m[3].trim().replace(/\s/g, '');
  if (phone.length < 5) return null;
  return {
    id:         line.id || line.username || note,
    site:       m[1].trim().toLowerCase(),
    email:      m[2].trim(),
    phone,
    name:       '',
    created_at: line.created_at || line.date || null,
    source:     'panel',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // ── /trials — fetch all trial lines from the panel ────────────
    if (url.pathname === '/trials') {
      const apiKey = url.searchParams.get('key') || env.PANEL_API_KEY || '';

      // Try every known action + sub combo in parallel
      const attempts = [
        tryAction(apiKey, { action: 'get_lines' }),
        tryAction(apiKey, { action: 'lines' }),
        tryAction(apiKey, { action: 'user_list', sub: '1' }),
        tryAction(apiKey, { action: 'user_list', sub: '3' }),
        tryAction(apiKey, { action: 'user_list', sub: '6' }),
        tryAction(apiKey, { action: 'user_list', sub: '12' }),
        tryAction(apiKey, { action: 'user_list', sub: '99' }),
        tryAction(apiKey, { action: 'user_list', type: 'm3u' }),
        tryAction(apiKey, { action: 'get_lines', type: 'm3u' }),
        tryAction(apiKey, { action: 'get_lines', status: 'all' }),
        tryAction(apiKey, { action: 'get_m3u_lines' }),
      ];

      const results = await Promise.all(attempts);
      const seen    = new Set();
      const trials  = [];

      for (const arr of results) {
        for (const line of arr) {
          const t = parseNote(line);
          if (!t) continue;
          const key = t.email + t.phone;
          if (seen.has(key)) continue;
          seen.add(key);
          trials.push(t);
        }
      }

      // Sort newest first
      trials.sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });

      return new Response(JSON.stringify({ count: trials.length, trials }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    // ── /debug — show raw response for a specific action ──────────
    if (url.pathname === '/debug') {
      const apiKey = url.searchParams.get('key') || env.PANEL_API_KEY || '';
      const action = url.searchParams.get('action') || 'reseller_info';
      const sub    = url.searchParams.get('sub') || '';
      const params = { action, api_key: apiKey };
      if (sub) params.sub = sub;
      const qs  = new URLSearchParams(params);
      const res = await fetch(`${BASE}?${qs}`);
      const txt = await res.text();
      return new Response(txt, {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    // ── Generic proxy to activationpanel.ru ───────────────────────
    const target = 'https://activationpanel.ru' + url.pathname + url.search;
    try {
      const res  = await fetch(target, {
        method:  request.method,
        headers: { 'Content-Type': 'application/json' },
        body:    request.method === 'POST' ? request.body : undefined,
      });
      const body = await res.text();
      return new Response(body, {
        status:  res.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  },
};
