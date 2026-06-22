# Spiewnik proxy (Cloudflare Worker)

Mały pośrednik, dzięki któremu PWA na tablecie może pobrać tekst piosenki
z tekstowo.pl / teksciory mimo blokady CORS. Przepuszcza wyłącznie GET do
trzech dozwolonych hostów, nic więcej.

## Wdrożenie (raz, ~3 minuty)

W tym katalogu (`proxy/`):

```bash
npx wrangler login        # zaloguj się do swojego konta Cloudflare (otworzy przeglądarkę)
npx wrangler deploy       # wgrywa worker
```

Po wdrożeniu Wrangler wypisze adres, np.:

```
https://spiewnik-proxy.TWOJA-NAZWA.workers.dev
```

Skopiuj ten adres i wklej w aplikacji: **🌐 Z sieci → ⚙ (ustaw proxy)**.
Adres zapisuje się lokalnie, podajesz go tylko raz.

## Test

```bash
curl "https://spiewnik-proxy.TWOJA-NAZWA.workers.dev/?url=https://www.tekstowo.pl/szukaj.html?q=chandelier"
```

Powinno zwrócić HTML strony wyszukiwania.

## Bezpieczeństwo

- Tylko metoda GET, tylko `https`, tylko hosty: `www.tekstowo.pl`, `tekstowo.pl`,
  `teksciory.interia.pl` (edytuj listę w `src/worker.js`).
- Read-only: worker nic nie zapisuje, niczego nie modyfikuje.
- Darmowy plan Cloudflare w zupełności wystarcza (100k żądań/dobę).
