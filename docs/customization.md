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
- **Push notifications backend**: `sw.js`'s `push` listener and the `enable-notifications-btn` click handler in `index.html` (dashboard → Agenda → Centro de tareas) both have `// FASE 2:` comments marking where VAPID keys + the serverless push backend get wired in
