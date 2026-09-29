# Customization hotspots

- **PIN**: search for `const ACCESS_PIN` near the top of the `<script>` block (currently `'1021'`)
- **Audio source**: `<source src="...">` inside `#audio-el`
- **Music cover**: `<img id="audio-cover" src="music-cover.jpg">`
- **Project images**: `src="prediccion-global.jpg"`, `src="interclases.jpg"`, `src="torneos.jpg"` — place files alongside `index.html`
- **Hero video**: `<source src="intro.mp4">` — place file alongside `index.html`
- **Background image**: `dinero-bg.jpg` used in `#intro-bg`
- **Social links**: three `<a href="#">` anchors in the contact section (GitHub, LinkedIn, WhatsApp)
- **Contact form**: no backend; `#form-msg` shows status messages
- **PWA icon**: `icon.svg` at the repo root is a placeholder (reuses the favicon's "J" mark on accent background). Replace with a dedicated icon set (ideally PNG, 192x192 + 512x512, with a maskable variant) and update the `icons` array in `manifest.json` plus the `<link rel="apple-touch-icon">` in `index.html`
- **Serverless backend (Notion proxy + push)**: `/netlify/` at the repo root — see [Architecture → Backend serverless](architecture.md#backend-serverless-netlify-functions) for what each file does and the full list of required environment variables. It deploys as its own separate Netlify site (the portfolio itself stays a plain static deploy, no build step). After deploying, paste the resulting URL into "Conectar cuentas" → Notion, and the VAPID public key (generated with `npx web-push generate-vapid-keys`) into "Conectar cuentas" → Notificaciones push
