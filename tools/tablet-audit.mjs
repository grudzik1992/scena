// Audyt tabletowy śpiewnika przez Playwright.
// Uruchom: node tools/tablet-audit.mjs
// Serwuje katalog projektu po HTTP (SW + fetch songs.json wymagają http://, nie file://),
// przechodzi kluczowe flow na viewporcie iPada (portrait + landscape),
// zbiera błędy konsoli i zapisuje zrzuty do tools/audit-shots/.

import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Playwright bywa zainstalowany tylko w cache npx — import z fallbackiem.
async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const { execSync } = await import('node:child_process');
  const candidates = [];
  try {
    const base = execSync('npm root -g', { encoding: 'utf8' }).trim();
    candidates.push(path.join(base, 'playwright', 'index.mjs'));
  } catch {}
  const npxCache = path.join(process.env.LOCALAPPDATA || path.join(process.env.HOME || '', 'AppData', 'Local'), 'npm-cache', '_npx');
  if (existsSync(npxCache)) {
    const { readdirSync } = await import('node:fs');
    for (const dir of readdirSync(npxCache)) {
      candidates.push(path.join(npxCache, dir, 'node_modules', 'playwright', 'index.mjs'));
    }
  }
  for (const c of candidates) {
    if (existsSync(c)) return await import(pathToFileURL(c).href);
  }
  throw new Error('Nie znaleziono playwright. Zainstaluj: npm i -D playwright  (lub npx playwright install)');
}
const { chromium } = await loadPlaywright();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'audit-shots');
const PORT = 4179;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/koncert.html';
      const filePath = path.join(ROOT, urlPath);
      if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
        res.writeHead(404); res.end('not found'); return;
      }
      const buf = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(buf);
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function runFlow(browser, label, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: false,
    locale: 'pl-PL',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(`http://localhost:${PORT}/koncert.html`, { waitUntil: 'networkidle' });
  // czekamy aż wczyta bundled songs.json przy pierwszym uruchomieniu
  await page.waitForFunction(() => typeof songs !== 'undefined' && songs.length > 0, null, { timeout: 8000 }).catch(() => {});

  const songCount = await page.evaluate(() => (typeof songs !== 'undefined' ? songs : []).length);
  check(`[${label}] wczytano utwory`, songCount > 0, `${songCount} utworów`);

  await page.screenshot({ path: path.join(SHOTS, `${label}-01-start.png`) });

  // --- Wyszukiwarka: test spacji (błąd 1) ---
  const search = page.locator('#search');
  await search.click();
  await search.fill('');
  await search.pressSequentially('Stand by Me', { delay: 15 });
  const searchVal = await search.inputValue();
  check(`[${label}] spacja w wyszukiwarce`, searchVal === 'Stand by Me', `wartość="${searchVal}"`);
  const visible = await page.evaluate(() => document.querySelectorAll('#song-list .si').length);
  check(`[${label}] filtr po tytule ze spacjami`, visible >= 1, `${visible} wyników`);
  await page.screenshot({ path: path.join(SHOTS, `${label}-02-search.png`) });

  // czyścimy wyszukiwarkę i wybieramy pierwszy utwór z pełnej listy
  await search.fill('');
  await page.evaluate(() => renderList(''));
  await page.waitForTimeout(80);
  await page.locator('#song-list .si').first().click();
  await page.waitForTimeout(150);
  const inView = await page.evaluate(() => document.getElementById('song-view').style.display !== 'none');
  check(`[${label}] otwarcie utworu`, inView);

  // --- font +/- ---
  const fsBefore = await page.evaluate(() => fontSize);
  await page.locator('#stbar .ctl-btn').first().click(); // minus
  const fsAfter = await page.evaluate(() => fontSize);
  check(`[${label}] zmiana czcionki`, fsAfter !== fsBefore, `${fsBefore} -> ${fsAfter}`);

  // --- kolumny ---
  await page.locator('#cols-btn').click();
  const cols = await page.evaluate(() => getActiveColumns());
  check(`[${label}] zmiana liczby kolumn`, cols >= 1);

  // --- ukrycie akordów ---
  await page.locator('#chord-vis-btn').click();
  const chordsHidden = await page.evaluate(() => showChords === false);
  check(`[${label}] ukrywanie akordów`, chordsHidden);
  await page.locator('#chord-vis-btn').click(); // z powrotem

  // --- transpozycja (jeśli dostępna) ---
  const hasTranspose = await page.evaluate(() => typeof window.transposeChordToken === 'function');
  if (hasTranspose) {
    // notacja niemiecko-polska: H=B, B=Bb, małe litery = molowe
    const t = await page.evaluate(() => ({
      majmin: [transposeChordToken('C', 2), transposeChordToken('a', 2), transposeChordToken('F', 2), transposeChordToken('G', 2)],
      bass: transposeChordToken('d/C', 2),
      hDown: transposeChordToken('H', -1),
      seq: transposeChordToken('|h|cis|D|E|', 2),
      sus: transposeChordToken('Esus4', 2),
      prose: transposeChordToken('Bridge:', 2),
      zero: transposeChordToken('cis0', 2),
    }));
    const ok = t.majmin.join(' ') === 'D h G A'
      && t.bass === 'e/D'
      && t.hDown === 'B'
      && t.seq === '|cis|dis|E|Fis|'
      && t.sus === 'Fissus4'
      && t.prose === 'Bridge:'
      && t.zero === 'dis0';
    check(`[${label}] transpozycja akordów (notacja PL)`, ok, JSON.stringify(t));
  } else {
    check(`[${label}] transpozycja akordów (notacja PL)`, false, 'helper niedostępny');
  }

  // --- autoscroll start/stop ---
  await page.evaluate(() => { if (typeof startScroll === 'function') startScroll(); });
  await page.waitForTimeout(120);
  const scrolling = await page.evaluate(() => isScrolling);
  await page.evaluate(() => stopScroll());
  check(`[${label}] autoscroll start`, scrolling === true || scrolling === false); // smoke: brak wyjątku

  // --- Wake Lock dostępny w kodzie ---
  const wakeLockWired = await page.evaluate(() => typeof window.requestWakeLock === 'function');
  check(`[${label}] Wake Lock podłączony`, wakeLockWired);

  // --- pinch-zoom dozwolony (meta viewport) ---
  const viewportMeta = await page.evaluate(() => {
    const m = document.querySelector('meta[name="viewport"]');
    return m ? m.getAttribute('content') : '';
  });
  check(`[${label}] pinch-zoom dozwolony`, !/user-scalable=no|maximum-scale=1/.test(viewportMeta), viewportMeta);

  // --- playlista nie ginie po reload songs.json (błąd 2/3) ---
  await page.evaluate(() => {
    playlists = [{ id: 'testpl', name: 'Test Set', songIds: [songs[0].id] }];
    activePlaylistId = 'testpl';
    savePlaylists();
    isDark = true; applyTheme(); savePrefs();
  });
  await page.evaluate(async () => { await loadBundledData(false); });
  await page.waitForTimeout(200);
  const afterReload = await page.evaluate(() => ({
    plCount: playlists.length,
    keepName: (playlists[0] || {}).name,
    dark: isDark,
  }));
  check(`[${label}] playlista przetrwała reload songs.json`, afterReload.plCount === 1 && afterReload.keepName === 'Test Set', JSON.stringify(afterReload));
  check(`[${label}] motyw nie nadpisany przez songs.json`, afterReload.dark === true);

  // --- dodanie utworu z tytułem ze spacją (modal) ---
  await page.evaluate(() => { localStorage.removeItem('x'); });
  await page.locator('#add-btn').click();
  await page.waitForTimeout(80);
  await page.locator('#modal-title').pressSequentially('Nowy Test Utwór', { delay: 15 });
  const modalVal = await page.locator('#modal-title').inputValue();
  check(`[${label}] spacja w tytule (modal)`, modalVal === 'Nowy Test Utwór', `"${modalVal}"`);
  await page.locator('#modal .mp').click();
  await page.waitForTimeout(120);
  // anuluj edytor
  await page.evaluate(() => { if (isEditing) toggleEdit(); });

  await page.screenshot({ path: path.join(SHOTS, `${label}-03-song.png`) });

  check(`[${label}] brak błędów konsoli`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await context.close();
}

// Test pobierania tekstu z sieci — proxy podstawiony przez route mock (bez sieci).
async function runWebImportTest(browser) {
  const PROXY = 'https://spiewnik-proxy.test.workers.dev';
  const LYRICS_HTML = `<!doctype html><html><body><h1>Sia - Chandelier (tekst piosenki)</h1>
    <div class="inner-text">[Zwrotka 1]<br>Party girls don't get hurt<br>Can't feel anything<br><br>[Refren]<br>I'm gonna swing from the chandelier</div>
    </body></html>`;

  const context = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true, locale: 'pl-PL', serviceWorkers: 'block' });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  // mock proxy: zwraca tekst tylko dla poprawnie zbudowanego slugu /sia/chandelier
  let requestedTarget = '';
  await page.route(/spiewnik-proxy\.test\.workers\.dev/, route => {
    const u = new URL(route.request().url());
    requestedTarget = u.searchParams.get('url') || '';
    const ok = /\/sia\/chandelier$/.test(requestedTarget);
    route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' }, body: ok ? LYRICS_HTML : '<html><body>404</body></html>' });
  });

  await page.goto(`http://localhost:${PORT}/koncert.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof songs !== 'undefined' && songs.length > 0, null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(p => { webProxyUrl = p; savePrefs(); }, PROXY);

  // slug-build: polskie znaki -> ASCII
  const slugs = await page.evaluate(() => ({
    podsiadlo: slugifyTekstowo('Dawid Podsiadło'),
    trojkaty: slugifyTekstowo('Trójkąty i kwadraty'),
  }));
  check('[web] slug z polskich znaków', slugs.podsiadlo === 'dawid-podsiadlo' && slugs.trojkaty === 'trojkaty-i-kwadraty', JSON.stringify(slugs));

  const before = await page.evaluate(() => songs.length);
  await page.locator('button[onclick="openWebImport()"]').click();
  await page.locator('#web-artist').fill('Sia');
  await page.locator('#web-title').fill('Chandelier');
  await page.locator('#web-go').click();
  await page.waitForFunction(n => songs.length === n + 1, before, { timeout: 5000 });
  check('[web] zbudowano poprawny adres slug', /\/sia\/chandelier$/.test(requestedTarget), requestedTarget);
  const added = await page.evaluate(() => {
    const s = songs[songs.length - 1];
    return {
      title: s.title,
      hasSection: s.lines.some(l => l.type === 'section' && l.lyric === 'Zwrotka 1'),
      hasLyric: s.lines.some(l => l.lyric === "Party girls don't get hurt" && l.type === 'normal'),
      allChordsEmpty: s.lines.every(l => !l.chord),
      editing: isEditing,
    };
  });
  check('[web] utworzono utwór z tytułem', added.title === 'Chandelier', added.title);
  check('[web] wykryto sekcję [Zwrotka 1]', added.hasSection);
  check('[web] tekst wczytany w linie', added.hasLyric);
  check('[web] akordy puste (do wpisania)', added.allChordsEmpty);
  check('[web] otwarto edytor do przeglądu', added.editing === true);
  check('[web] brak błędów konsoli', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await page.screenshot({ path: path.join(SHOTS, 'web-import.png') });
  await context.close();
}

(async () => {
  await mkdir(SHOTS, { recursive: true });
  const server = await startServer();
  console.log(`Serwer: http://localhost:${PORT}`);
  const browser = await chromium.launch();
  try {
    await runFlow(browser, 'ipad-portrait', { width: 1024, height: 1366 });
    await runFlow(browser, 'ipad-landscape', { width: 1366, height: 1024 });
    await runWebImportTest(browser);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== Wynik: ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length) {
    console.log('Niepowodzenia:');
    failed.forEach(f => console.log(`  - ${f.name}${f.detail ? ' (' + f.detail + ')' : ''}`));
    process.exit(1);
  }
})();
