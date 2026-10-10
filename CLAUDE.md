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

e2e: `askRoot` asks a full-text topic in the chat (`branches.spec.ts` covers asking beside the original; the keyboard is simulated by shrinking the viewport); `askRootMap` switches new topics to pyramids and opens the old map; `selectWords` makes a selection inside an answer.

Playwright uses the pre-installed Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (override with `CHROMIUM_PATH`); never run `playwright install`. The sandbox cannot reach openrouter.ai, so every e2e test mocks it (`e2e/mock.ts`); the real service can only be tried from a phone.

## What this is

Fractal is a mobile-only PWA (Vite + React + TypeScript, no backend). A session ("topic") is a **tree of cards**; each card is one question and the AI's answer. The main screen is a **classic chat** (`screens/ChatScreen.tsx`, `#/s/:sid`) showing one branch: answers are full text (markdown via react-markdown + remark-gfm), and the user highlights words to ask about them, several at once through a tray; every question is a branch. Older **pyramid** topics (JSON: foundations in nested categories → steps → conclusions, node ids `K{seq}.nX`) still work and have the old pan/zoom **map** (`MapScreen`, `MapView`, dagre layout in `mapLayout.ts`, `#/m/:sid`). All data is in IndexedDB (Dexie); the user's OpenRouter key lives in the same store. `IDEA.md` is the product spec: read it before changing behavior.

## Architecture

The code splits into **pure, unit-tested modules** and **orchestration/UI** that wire them to IndexedDB, the network and React.

Pure logic (`src/`, covered by `tests/`):
- `tree.ts` builds the messages for a request by replaying the ancestor path **verbatim**. Every branch is append-only: a child's prefix is exactly its parent's messages plus the parent's answer. This keeps providers' signed reasoning valid and sibling branches cache-friendly. Do not edit, reorder or drop earlier turns.
- `tasks.ts` lists every task that uses a model (group, kind, default model by family, editable prompt, the fixed format the app needs, length choices, base settings); `taskConfig.ts` resolves them (`taskModel`, `taskSetup` → model, prompt, request params). New model calls must go through a task, never a hardcoded model, prompt or max_tokens.
- `modelRules.ts` + `reasoning.ts` turn a model's OpenRouter metadata (`supported_parameters`, the `reasoning` object) into the settings UI (`settingsControls`) and the request body (`buildRequestParams`). Per-family exceptions (Claude, Gemini, Grok, GPT-5.6+) live here.
- `openrouter.ts` is the whole network layer (plain `fetch`) plus `applyChunk`, the SSE accumulator.
- `prompts.ts` holds the hidden system prompt, synthesis presets and the JSON schema for outlines. `effort.ts` plans mid-conversation effort changes. `context.ts` is the token meter and fresh-branch card. `search.ts` is cosine/keyword search. `route.ts` is the hash router.

Also pure: `split.ts`, `arrange.ts`, `diagrams.ts`, `viewLayout.ts` (Visualize), `anchors.ts` (a highlight = quote + start/end in the answer's rendered text + context; re-finding), `rehypeMarks.ts` (draws highlights while react-markdown renders; its text offsets must equal `Range.toString()` inside `[data-answer]`), `answer.ts` (parse/normalize pyramid JSON, pyramids, outline text), `mapLayout.ts` (dagre graph), `councilLogic.ts` (rankings, grounding), `storyStyles.ts` (story/draw prompts, style presets, `sanitizeSvg`), `mediaSettings.ts` (OpenRouter image/video descriptors → controls, price estimates, video poll states).

Orchestration: `ai.ts` (ask / run / retry, tags, embeddings, concept search, fresh branch), `highlights.ts` (save/delete highlights), `visuals.ts` (open/arrange/diagram/sketch a scope), `council.ts` (members → reviews → grounded chairman → verifier), `photos.ts` (pictures sent with questions: shrink/crop, which models can see them, `imageOptions` for replay, reading their text), `stories.ts` (story text, SVG drawing, narration, screenshot style notes), `media.ts` (AI images, video jobs, image/video model metadata store), `synthesis.ts` (background outline jobs), `db.ts` + `store.ts` (Dexie tables, settings, models and live-stream stores, `useLive`). `screens/` and `components/` are the UI.

## Rules to keep

- Answers are never cut into pieces or rewritten for the chat: they are stored and shown as the model wrote them. A highlight is `{quote, start, end, prefix, suffix}` on a card (Dexie v3 `highlights`); a branch lists the highlights it asked about in `anchor.highlightIds` (scope `"highlights"`), and `userTurn` quotes them. Older anchor formats must keep replaying exactly as before.
- New topics answer in full text (`answerFormat: "text"`, the frozen prompt is only the user's prompt); `"pyramid"` adds `ANSWER_FORMAT`. Only pyramid topics are parsed into `card.answer`.
- The old map (`MapScreen`, `MapView`) is frozen: the user asked not to touch it. Keep `hrefMap`/`hrefCard` pointing at `#/m/` so it keeps working; every other screen links with `hrefChat`.
- Branches beside the original: a card whose anchor scope is `"highlights"` starts a branch (`startsBranch`); `lineRoot`/`linePath`/`lineBranches`/`branchLabel` in `tree.ts` split the tree into lines. `ChatScreen` shows the source line in `.chat` and the open branch (`?branch=` in the route) in `BranchHost` (split / bubble / layer, `settings.branchMode`). Opening a branch must never scroll or re-lay out the original from its top: the split ends under the asked paragraph (`splitHeight` in `panes.ts`), and any scroll made for it or for the keyboard (`keepInView`, `useKeyboard` in `keyboard.ts`) is restored. Follow-ups continue the branch or (`followUp: "branch"`) start a sibling branch with the same parent and anchor. Requests are unchanged (`buildMessages` over the ancestor path). The bubble is moved/resized by dragging (direct manipulation, like the map) and always has button equivalents.
- Read more (cutting long text) only belongs in the non-chat views (`components/views/Clamp.tsx`); the chat always shows messages in full.
- Quick answers (`quick.ts`, Dexie v5 `quicks`) and claim checks (`checks`) live beside the chat and are never replayed; a quick request is the branch history verbatim + the quick task's instructions in the last user turn (pyramid topics drop the format section for it). "Make it a branch" is the only way they enter the tree.
- Visualize: `split.ts` splits only the chosen text, and only when visualizing (the test checks every rendered word survives); `arrange.ts` normalizes the arranger's reply so every sentence is placed exactly once (unplaced → "Other details"); views show sentence text word for word, labels only on top. Diagrams (`diagrams.ts`) cite sentence ids; invalid ids are dropped and uncovered sentences listed. Visuals are saved in Dexie v4 `visuals` (one per scope, `scopeKey`), each representation made on demand and resumed on start (`resumeVisuals`).

- The editable system prompt is exactly two rules in the user's wording (`PREMISES`, `PUSHBACK` in `prompts.ts`); do not reword them or add others. Older saved prompts are migrated by `migrateSystemPrompt` (keeps the user's own text). Each topic stores a frozen copy of the prompt it started with; Settings edits only affect new topics.
- No AI call is made for breadcrumb tags: the tag is the conclusion's title (or the question).
- Never send both `reasoning.effort` and `reasoning.max_tokens`. Never send effort `none`. Keep `max_tokens` strictly above any reasoning budget (Claude).
- `reasoning_details` from a response are stored unmodified and replayed unmodified, only on turns made by the same model as the current request.
- Mid-conversation effort changes (`configuration_update` system messages) are stored on the card and must keep their position on every replay; never two in a row. A 400 about them marks the model in `blockedConfigUpdate` and the request retries without them.
- Only show settings the selected model supports; never hardcode model ids for the picker (families are matched by id pattern in `models.ts` from the live `/models` list).
- The map uses pinch/drag plus buttons; elsewhere navigation is buttons only. Compact sizes: icon buttons 32–36px, chips 32px, breadcrumbs 28px (e2e checks nothing tappable is under 28px); the chat's top bar is 40px. Icons are monochrome inline SVG (`components/Icon.tsx`), not emoji.
- The answer format section (`ANSWER_FORMAT` in `prompts.ts`) is appended only to pyramid topics' frozen prompt; replay sends the stored JSON verbatim. v1 topics (prose answers, no format marker) still open: `cardAnswer()` converts paragraphs to a chain for the map.
- Search vectors are Int8 (cosine ignores scale); text-embedding-3 models are asked for 512 dimensions.
- Storage: IndexedDB only (Dexie v2 adds bookmarks, stories, media). Nothing is deleted automatically; Settings › Storage lets the user pick files/topics. Backups are one zip (`backup.ts`, fflate) without the API key.
- LLM Council: the chairman's answer must be grounded in the members' text. Full-text topics: `[A, C]` tags per paragraph (`splitTagged`), the verifier checks paragraphs, unverified ones are folded (`council.unverified`) and not replayed; replay sends the plain question and the kept text without tags. Pyramid topics: `sources` per node + verifier, replay sends the final JSON. Never council reasoning. Members use `council.memberSettings` (else the model's defaults).
- Stories are on demand only. SVG pictures go through `sanitizeSvg` and are shown only as `<img>` data URIs. Image/video settings and prices come from OpenRouter metadata (`/images/models` + endpoints with `pricing: [{billable, unit, cost_usd, variant}]`, `/videos/models`); never hardcode model ids or parameters. Video costs are confirmed before submitting; jobs are persisted on the slide (`videoJob`), polled about every 30 s, and `resumeVideos` polls them on start. Clips are downloaded with the Authorization header (only to openrouter.ai): `unsigned_urls` aren't presigned. Never send video `size` with `resolution`/`aspect_ratio`.
- Speech: voices come from the model's `supported_voices`; `response_format` is always mp3; `speed` only when ≠ 1 and dropped (remembered in `story.noSpeedModels`) after a 400. Model ids with `:` (`:batch`, `:free`…) are never picked as defaults.
- Photos and screenshots are stored in `media` (kind "image") and listed on the card (`card.images`; `partOf` for a box drawn over another picture). They're replayed only in the turn they were sent with (`imageOptions` → `buildMessages` `images`/`imageText` → `prepareMessages` image parts). A model that can't see pictures (`architecture.input_modalities`) gets `imageNote` instead: the text read from them, read first by `withImageText`. The text read from a picture is highlightable as a part of its card (`data-part="img{i}"`, `Highlight.part`); quotes from it set `anchor.quoteFrom`, so the prompt says they come from the learner's picture (anchors without it replay unchanged).
- Synthesis runs in a module-level queue and its status is persisted; unfinished jobs resume on start (`resumePending`, `resumeStories`).

## Deployment

`.github/workflows/pages.yml` runs the tests and deploys `dist/` to GitHub Pages. `vite.config.ts` uses `base: "./"`, and the OpenRouter sign-in callback is `location.origin + location.pathname`, so the app must be served from a stable URL.
