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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('method not allowed', { status: 405, headers: CORS });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      // Ktos otworzyl sam adres proxy zamiast aplikacji — pokaz czytelna strone.
      return new Response(
        '<!doctype html><html lang="pl"><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<title>Spiewnik proxy</title></head><body style="font-family:system-ui;max-width:34em;margin:3em auto;padding:0 1em;line-height:1.5;color:#1c1a14">' +
          '<h1 style="color:#c0430e">Spiewnik proxy</h1>' +
          '<p>To jest pomocniczy serwer pobierania tekstow, a nie sama aplikacja.</p>' +
          '<p>Otworz <strong>spiewnik (koncert.html)</strong> i uzyj w nim przycisku <strong>🌐 Z sieci</strong>.</p>' +
          '</body></html>',
        { status: 200, headers: { ...CORS, 'content-type': 'text/html; charset=utf-8' } }
      );
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
      const fetchInit = {
        method: request.method,
        headers: {
          'user-agent':
            'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.9',
          'accept-language': 'pl-PL,pl;q=0.9',
          'referer': 'https://www.tekstowo.pl/',
          'origin': 'https://www.tekstowo.pl',
        },
        cf: { cacheTtl: 3600, cacheEverything: true },
      };
      if (request.method === 'POST') {
        fetchInit.body = request.body;
        const ct = request.headers.get('content-type');
        if (ct) fetchInit.headers['content-type'] = ct;
        fetchInit.cf = { cacheTtl: 60, cacheEverything: false };
      }
      upstream = await fetch(t.toString(), fetchInit);
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
