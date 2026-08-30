# Atlas — landing page

A static, zero-build marketing site (`index.html` + `styles.css` + `app.js` +
`assets/`). Deploy anywhere that serves static files.

## Local preview

```bash
cd apps/web
python3 -m http.server 4321   # or: bunx serve .
```

## Deploy to Vercel

```bash
cd apps/web
vercel deploy --prod
```

`vercel.json` sets clean URLs + long-lived caching for `/assets`. Point a
subdomain (e.g. `get.notpritam.in`) at it — note `atlas.notpritam.in` is the
API backend, so the marketing site needs its own hostname.

## Extension download

The landing page's "Download the extension" button serves
`atlas-extension.zip` from this folder (no GitHub redirect). Regenerate it after
changing the extension:

```bash
../../deploy/pack-extension.sh
```

The zip unpacks to an `atlas-extension/` folder ready for
`chrome://extensions` → Developer mode → **Load unpacked**.
