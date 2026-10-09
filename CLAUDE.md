# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                              # Vite dev server (service worker is only active in the built app)
npm run build                            # tsc --noEmit && vite build -> dist/ (also the typecheck: `npm run typecheck`)
npm test                                 # vitest, unit tests in tests/
npx vitest run tests/tree.test.ts        # one unit test file
npx vitest run -t "append-only"          # one test by name
npm run e2e                              # Playwright (Pixel 7 profile); builds and serves `vite preview` on :4173
npx playwright test -g "quick chips"     # one e2e test by name
SCREENSHOTS=1 npx playwright test screenshots   # regenerate docs/screenshots/
```

Playwright uses the pre-installed Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (override with `CHROMIUM_PATH`); never run `playwright install`. The sandbox cannot reach openrouter.ai, so every e2e test mocks it (`e2e/mock.ts`); the real service can only be tried from a phone.

## What this is

Fractal is a mobile-only PWA (Vite + React + TypeScript, no backend). A session ("topic") is a **tree of cards**; each card is one question and the AI's answer. Answers are **pyramids** (JSON: foundations in nested categories → steps → conclusions, node ids `K{seq}.nX`) drawn on a pan/zoom **map** (`MapScreen`, `MapView`, layout by dagre in `mapLayout.ts`), with an Outline view for reading. All data is in IndexedDB (Dexie); the user's OpenRouter key lives in the same store. `IDEA.md` is the product spec: read it before changing behavior.

## Architecture

The code splits into **pure, unit-tested modules** and **orchestration/UI** that wire them to IndexedDB, the network and React.

Pure logic (`src/`, covered by `tests/`):
- `tree.ts` builds the messages for a request by replaying the ancestor path **verbatim**. Every branch is append-only: a child's prefix is exactly its parent's messages plus the parent's answer. This keeps providers' signed reasoning valid and sibling branches cache-friendly. Do not edit, reorder or drop earlier turns.
- `modelRules.ts` + `reasoning.ts` turn a model's OpenRouter metadata (`supported_parameters`, the `reasoning` object) into the settings UI (`settingsControls`) and the request body (`buildRequestParams`). Per-family exceptions (Claude, Gemini, Grok, GPT-5.6+) live here.
- `openrouter.ts` is the whole network layer (plain `fetch`) plus `applyChunk`, the SSE accumulator.
- `prompts.ts` holds the hidden system prompt, synthesis presets and the JSON schema for outlines. `effort.ts` plans mid-conversation effort changes. `context.ts` is the token meter and fresh-branch card. `search.ts` is cosine/keyword search. `route.ts` is the hash router.

Orchestration: `ai.ts` (ask / run / retry, tags, embeddings, concept search, fresh branch), `synthesis.ts` (background outline jobs), `db.ts` + `store.ts` (Dexie tables, settings, models and live-stream stores, `useLive`). `screens/` and `components/` are the UI.

## Rules to keep

- The system prompt's two directives are exact strings (`DIRECTIVE_1`, `DIRECTIVE_2` in `prompts.ts`); do not reword them. Each session stores a frozen copy of the prompt it started with; Settings edits only affect new sessions.
- Never send both `reasoning.effort` and `reasoning.max_tokens`. Never send effort `none`. Keep `max_tokens` strictly above any reasoning budget (Claude).
- `reasoning_details` from a response are stored unmodified and replayed unmodified, only on turns made by the same model as the current request.
- Mid-conversation effort changes (`configuration_update` system messages) are stored on the card and must keep their position on every replay; never two in a row. A 400 about them marks the model in `blockedConfigUpdate` and the request retries without them.
- Only show settings the selected model supports; never hardcode model ids for the picker (families are matched by id pattern in `models.ts` from the live `/models` list).
- The map uses pinch/drag plus buttons; elsewhere navigation is buttons only. Compact sizes: icon buttons 32–36px, chips 32px, breadcrumbs 28px (e2e checks nothing tappable is under 28px). Icons are monochrome inline SVG (`components/Icon.tsx`), not emoji.
- The answer format section (`ANSWER_FORMAT` in `prompts.ts`) is appended to each new topic's frozen prompt; replay sends the stored JSON verbatim. v1 topics (prose answers, no format marker) still open: `cardAnswer()` converts paragraphs to a chain.
- Search vectors are Int8 (cosine ignores scale); text-embedding-3 models are asked for 512 dimensions.
- Storage: IndexedDB only (Dexie v2 adds bookmarks, stories, media). Nothing is deleted automatically; Settings › Storage lets the user pick files/topics. Backups are one zip (`backup.ts`, fflate) without the API key.
- Synthesis runs in a module-level queue and its status is persisted; unfinished jobs resume on start (`resumePending`).

## Deployment

`.github/workflows/pages.yml` runs the tests and deploys `dist/` to GitHub Pages. `vite.config.ts` uses `base: "./"`, and the OpenRouter sign-in callback is `location.origin + location.pathname`, so the app must be served from a stable URL.
