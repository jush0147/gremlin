# Gremlin

AI-guided, replayable exploratory testing for web apps.

Gremlin keeps the model on a short leash: the agent chooses from semantic UI actions, while Gremlin owns Playwright, records evidence, and detects objective failures. The model cannot execute arbitrary JavaScript, shell commands, filesystem writes, or raw selectors through Gremlin.

## v0.1 goal

Answer one question:

> Can an agent discover useful web-app failures when it can only choose from constrained semantic actions?

The first version intentionally does only four things:

- `gremlin_start` — open a URL in a fresh Chromium context and start tracing.
- `gremlin_observe` — return an AI-friendly accessibility snapshot, allowed actions, and hard failure signals.
- `gremlin_act` — execute one previously-issued action ID.
- `gremlin_finish` — stop the run and write the action log, findings, and Playwright trace.

No source-code editing. No arbitrary browser scripting. No automatic fixing.

## Requirements

- Node.js 20+
- Chromium installed through Playwright
- An MCP host such as Google Antigravity

## Setup

```bash
npm install
npx playwright install chromium
npm run check
```

For local development:

```bash
npm run dev
```

To exercise the MCP server directly:

```bash
npm run inspect
```

## Antigravity

This repository includes a workspace MCP config and a `/gremlin` skill under `.agents/`.

Open the repository in Antigravity, install dependencies, then ask it to run `/gremlin` against a local web app.

Example:

```text
/gremlin Explore http://localhost:5173 on a 390x844 viewport.
Focus on create, edit, delete, and print flows.
```

Run artifacts are written under `.gremlin/runs/` and ignored by Git.

## Design constraints

1. The model never receives a raw Playwright execution surface.
2. The model never supplies CSS/XPath selectors.
3. Every executable action is minted by `gremlin_observe` and referenced by an opaque action ID.
4. Gremlin, not the model, decides whether an objective failure signal occurred.
5. A later version will add clean-context replay before promoting a candidate to a reproducible finding.

## Roadmap

- v0.1 — constrained semantic exploration + trace capture
- v0.2 — replay and reproducibility checks
- v0.3 — state hashing
- v0.4 — novelty scoring
- v0.5 — coverage-guided exploration
- v0.6 — local vs production differential runs
