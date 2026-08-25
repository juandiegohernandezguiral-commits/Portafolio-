# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Single-file personal portfolio for Juan Diego Hernández (Software Engineer, Colombia) — no build step, no framework, no package manager. Edit `index.html` directly.

## Run locally

```
# Python (no install needed on most systems)
python -m http.server 8080

# Node (if available)
npx serve .
```

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
