# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Personal portfolio + private dashboard for Juan Diego Hernández (Software Engineer, Colombia).
**No build step, no framework, no package manager** for the frontend — that constraint still
holds and is worth preserving.

It is no longer a single file, though. `index.html` is markup only; styles live in
`css/styles.css` and behaviour in `js/*.js`, loaded as **classic scripts in numbered order**
(not ES modules), so they all share one global scope. See
[Architecture](docs/architecture.md) for the file-by-file responsibility table — read it before
adding a file, because load order *is* the dependency graph and new files need a `<script>` tag
added by hand.

The `/netlify` directory holds the serverless backend. **Portfolio and backend deploy together
from one Netlify site** — `netlify.toml` publishes the repo root as static files and registers
`netlify/functions`. Same domain for both, so there are no cross-origin concerns and every
`git push` redeploys everything.

**Backend dependencies live in the root `package.json`, not inside `netlify/functions/`.**
Netlify does *not* install from a `package.json` nested in the functions directory — the
bundler fails with `Could not resolve "@netlify/blobs"` and the whole deploy dies. The frontend
still uses no npm and no build step; that root `package.json` exists only to feed the
functions. `npm test` runs the three test suites.

## Run locally

```
# Python (no install needed on most systems)
python -m http.server 8080

# Node (if available)
npx serve .
```

Serve it over HTTP rather than opening `index.html` from disk — the service worker and the PWA
manifest don't work from `file://`.

## Tests

```
npm test     # corre las tres suites
```

Three plain `node` scripts, no runner and no dependencies. Each covers a place where a bug is
*silent* rather than loud:

- `tests/merge.test.js` — cloud-sync merge (last-write-wins per record, tombstones, TTL pruning),
  loading `js/07-sync.js` in a sandboxed VM with stubbed browser globals. A bug here loses data
  instead of raising an error.
- `tests/markdown.test.js` — the in-house markdown renderer, mostly escaping: its output goes
  straight into `innerHTML`.
- `tests/pricing.test.js` — the money arithmetic of `js/20-dropship-tools.js`. A wrong margin
  doesn't throw; it prints a believable number that a pricing decision gets made on.

Note that `const` declarations in a loaded script are **not** properties of the VM context
(only `function` declarations and `var` are). To read one from a test, use
`vm.runInContext('NOMBRE', sandbox)`.

## Gotchas

- **Bump `SW_VERSION` in `sw.js`** after changing any file in its `SHELL_ASSETS` list, or
  returning visitors keep the cached old shell.
- **The `ACCESS_PIN` is not security.** It's a plain string in a file anyone can read; it keeps
  casual visitors out of the panel and nothing more. Real secrets belong in the backend's
  environment variables.

## Agent architecture

This project runs Claude Code as an **orchestrator** by default (`"agent": "orchestrator"` in `.claude/settings.json`). The orchestrator does not write code, review diffs, or draft specs itself — it only decomposes the user's request and delegates to one of three specialists defined in `.claude/agents/`:

- **developer** — implements code, design, and content changes in `index.html`.
- **git-manager** — handles git status, diffs, commits, branches, and PRs.
- **research** — investigates external design trends, technologies, and references without touching the repo.

The orchestrator's `tools` frontmatter uses the `Agent(developer, git-manager, research)` allowlist syntax, so it can only spawn these three subagent types — no other built-in agent (Explore, general-purpose, etc.) can be spawned from the main thread. To bypass orchestration for a single session, start Claude Code with `claude --agent claude` (or another agent name) instead of relying on the project default.

## Reference docs

- [Architecture](docs/architecture.md) — page sections, external deps, ambient effects
- [Design system](docs/design-system.md) — colors, typography, dark mode, surface classes
- [Private dashboard](docs/dashboard.md) — `#dashboard` views and localStorage schema
- [Customization](docs/customization.md) — asset paths, PIN, social links, contact form
