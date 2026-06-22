// Wąski CORS-proxy dla śpiewnika: pozwala PWA na tablecie pobrać stronę
// z tekstem piosenki (tekstowo.pl / teksciory) mimo blokady CORS.
// Tylko GET, tylko whitelista hostów, tylko https. Nic poza tym nie przepuszcza.

const ALLOWED_HOSTS = new Set([
  'www.tekstowo.pl',
  'tekstowo.pl',
  'teksciory.interia.pl',
]);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== 'GET') {
      return new Response('method not allowed', { status: 405, headers: CORS });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      return new Response('Brak parametru ?url=', { status: 400, headers: CORS });
    }

    let t;
    try {
      t = new URL(target);
    } catch {
      return new Response('Niepoprawny URL', { status: 400, headers: CORS });
    }
    if (t.protocol !== 'https:' || !ALLOWED_HOSTS.has(t.hostname)) {
      return new Response('Host niedozwolony', { status: 403, headers: CORS });
    }

    let upstream;
    try {
      upstream = await fetch(t.toString(), {
        headers: {
          'user-agent':
            'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'accept': 'text/html,application/xhtml+xml',
          'accept-language': 'pl-PL,pl;q=0.9',
        },
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
    } catch {
      return new Response('Błąd pobierania ze źródła', { status: 502, headers: CORS });
    }

    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...CORS,
        'content-type': upstream.headers.get('content-type') || 'text/html; charset=utf-8',
      },
    });
  },
};
