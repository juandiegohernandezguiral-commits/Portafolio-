# Customization hotspots

- **PIN**: `const ACCESS_PIN` at the top of `js/01-base.js`.

  Be clear-eyed about what this is: the PIN is a plain string in a file anyone can open with
  View Source. It keeps a casual visitor out of the panel; it is **not** a security boundary,
  and it never was. Anything that genuinely must stay private belongs behind the serverless
  backend's `SYNC_TOKEN` (which does live server-side), not behind this PIN.
- **Audio source**: `<source src="...">` inside `#audio-el`
- **Music cover**: `<img id="audio-cover" src="music-cover.jpg">`
- **Project images**: `src="prediccion-global.jpg"`, `src="interclases.jpg"`, `src="torneos.jpg"` — place files alongside `index.html`
- **Hero video**: `<source src="intro.mp4">` — place file alongside `index.html`
- **Background image**: `dinero-bg.jpg` used in `#intro-bg`
- **Social links**: three `<a href="#">` anchors in the contact section (GitHub, LinkedIn, WhatsApp)
- **Contact form**: no backend; `#form-msg` shows status messages
- **PWA icons**: `icon-192.png`, `icon-512.png` and `icon-maskable-512.png` at the repo root,
  generated from the same "J on accent" mark as the favicon. To regenerate at a different size
  or colour, use `System.Drawing` from PowerShell — the maskable one needs a full-bleed
  background (no rounded corners) with the glyph at ~42% of the canvas so it survives Android's
  crop, while the others use a 22% corner radius and a ~58% glyph:

  ```powershell
  Add-Type -AssemblyName System.Drawing
  # ver docs/architecture.md → PWA shell para las reglas de cada variante
  ```

  If you change the filenames, update three places: the `icons` array in `manifest.json`,
  `<link rel="apple-touch-icon">` in `index.html`, and `SHELL_ASSETS` in `sw.js`.
- **Service worker cache**: after editing any file listed in `SHELL_ASSETS`, bump `SW_VERSION`
  in `sw.js`. The version string names the caches, so not bumping it means returning visitors
  keep the old shell. Adding a new `js/*.js` file means adding it to `SHELL_ASSETS` too, or it
  won't be available offline.
- **Cloud sync**: needs `SYNC_TOKEN` set in the Netlify site's environment variables, and the
  same string pasted into the panel → "Conectar cuentas" → Sincronización. Generate one with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Also
  consider setting `ALLOWED_ORIGIN` to your exact domain now that the backend serves personal
  data.
- **Serverless backend (Notion proxy + push)**: `/netlify/` at the repo root — see [Architecture → Backend serverless](architecture.md#backend-serverless-netlify-functions) for what each file does and the full list of required environment variables. It deploys from the **same Netlify site as the portfolio** (`netlify.toml` publishes the repo root and registers `netlify/functions`), so the site's own URL is also the backend URL. Paste it into "Conectar cuentas" → Sincronización (and → Notion, if you use it), plus the VAPID public key (generated with `npx web-push generate-vapid-keys`) into → Notificaciones push
