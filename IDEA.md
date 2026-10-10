# Fractal: learn by questioning every answer

Ask a frontier AI a question and read the answer in a classic chat, like Claude or Gemini. Then **highlight any words of an answer and ask about them**, or highlight several passages, even in different answers, and ask about all of them in one prompt. Every question starts its own branch, so the conversation becomes a tree you can always find your way back through.

Mobile only. Runs in the phone browser (installable PWA). Everything stays on your phone, with a one-tap backup.

## The core loop

1. Ask a question. The box on Home grows with what you paste and keeps paragraph breaks.
2. The answer arrives **whole, exactly as the model wrote it** (paragraphs, lists, tables). The app never cuts or shortens it.
3. Select words in an answer. A slim bar above the question box offers:
   - **Mark+**: keep the words as a yellow highlight and collect them
   - **Ask**: the same, then type your question
   - **Copy**
4. Collected highlights wait in a **tray** above the question box, numbered 1, 2, 3… They can come from one answer or several. Your question is sent once, quoting all of them:
   ```
   About these parts of your previous answers:
   1. "…"
   2. "…"

   My question: …
   ```
5. Asking about highlights starts a **branch** under the answer they came from (with highlights in several answers, under the latest of them). Then:
   - a highlight shows **↳ n**, the number of questions asked about it; tap it to see them, add it to the tray again, or delete it
   - your message shows **‹ 1/2 ›** when an answer has several follow-ups
   - the title (top bar) opens the **Branches** list of the whole tree
6. **✦ Synthesize** (in ⋯) compiles the whole tree into a **Concept Outline** in the **Library**.

**Why answers aren't cut into pieces:** a highlight is saved as the quoted words plus where they sit in the answer, with a little context before and after so it can be found again. The chat never needs pieces.

**Compact layout:**
- one slim top bar (‹, the title, ⋯) that hides while you scroll down
- a one-line question box with the quick questions (?), the council, the model settings and a round send button
- the selection bar and the tray appear only while they're needed
- no tab bar inside a topic

## The old map (pyramid topics)

Settings › System prompt › **How new topics are answered** can switch new topics to **pyramid points** (JSON) for the old map. A pyramid answer builds from the bottom up:
- **Foundations** (first principles) at the top, grouped into nested **categories**
- **Steps** derived from the foundations
- a **Conclusion** at the bottom, whose title names the pyramid

Unrelated parts of an answer become separate pyramids.

The map is reachable from ⋯ › **Open the old map** (any topic; full-text answers appear as a chain of paragraphs) and is kept as it was:
- pinch to zoom and drag, plus **−**, **+**, **Fit** and **Focus**
- **All | Foundations**, an **Outline** view, and breadcrumbs
- tap a point to ask about it, **Select several points**, a category or **the whole pyramid**
- dashed "builds on" links between answers, and dotted links to similar earlier points

Pyramid topics also open in the chat, shown as an indented outline.

**Search by concept** (⋯ in the chat): embeddings find candidates, an LLM reranks them, and the chat opens at the answer with the words marked. Offline, search falls back to word matching.

**Bookmarks:** a small black-and-white ribbon, in an answer's ⋯ (or on a map point). Saved items are listed on Home and in the Library.

## LLM Council (optional, per question)

Turn on the **Council** toggle next to the question box before asking. It stays on for that topic until you turn it off. This follows [karpathy/llm-council](https://github.com/karpathy/llm-council), but conversations can continue.

1. **Members** (newest Gemini Pro, Claude Opus, top ChatGPT and Grok by default) answer in parallel, each with the branch history.
2. **Peer review:** members rank each other's anonymized answers ("Response A…"). This step can be turned off.
3. The **chairman** (one fixed model, changeable between questions with **▾** or in Settings › Council) reasons and writes the final pyramid using **only the council's text**. Each point cites the answers it came from. A cheap verifier then checks every point against the member answers, and points that aren't supported are removed (or, if you prefer, badged "Not in the council's answers").

Each member's answer has **Continue with this model**, which switches the council off and asks the next question with that model. Later questions replay a council answer as the plain question plus the checked JSON, with no reasoning, so history stays append-only.

## Story slides (optional, on demand)

**Learn as a story** (in an answer's ⋯, or on a map point) turns this answer, the point's pyramid, or the whole branch into 3–4 narrated slides. Nothing is generated until you ask.

- **Style:**
  - **TED-Ed:** a character-driven hook, warm flat illustrations, and a reflective question at the end
  - **ScienceClic:** one visual model built step by step, with geometric diagrams on dark
  - **Custom**

  The rules for every style can be edited. **Add screenshots** of frames you like, and a vision model writes a style description for that style.
- **Pictures:**
  - **Shapes drawn by AI** (default): a small SVG in a chosen look (colorful flat vectors, line art, diagrams on dark, isometric, paper cut-out, chalkboard, or your own). It is sanitized and shown only as an image.
  - **AI image** per slide or for every slide. Models and settings come from OpenRouter's `/images/models` and each model's endpoint record, with an estimated price per image.
  - **AI video**, opt-in per slide. Models, durations, resolutions, aspect ratios and sound come from `/videos/models`, and the price from `pricing_skus` is shown before you confirm. Jobs keep going if you leave, and resume after a restart.
- **Voice:**
  - an AI voice model with a voice picker, **▶ Preview** and speech speed
  - playback speed from 0.75× to 2× in the player
  - autoplay to the next slide
- **Player:**
  - picture with a slow pan and zoom
  - captions: tap a sentence to ask about it in the chat
  - ◀ ▶ / ⏸ ▶ controls and the speed chip
  - **Regenerate** for any picture or narration that failed or was deleted

## Storage and backup

Everything is kept in the phone's browser storage (IndexedDB), and the app asks Chrome to protect it from automatic cleanup. Search vectors are stored compactly (Int8, 512 dimensions where supported), and AI images are re-saved as WebP.

**Settings › Storage:**
- shows usage per topic and per file (voice, images, videos) with sizes
- you pick what to delete; nothing is deleted automatically
- a story whose files were deleted keeps its text and offers Regenerate

**Back up** writes one `.zip` through Android's share menu (save it to Google Drive or Files); you can leave videos out. **Restore** reads it back. The API key is never included. A banner reminds you after 7 days without a backup.

## Synthesis (and how to change it)

**✦ Synthesize** reads the whole tree in the background and returns structured JSON: title, category, summary, and sections of points that link back to their answers. In **Settings › Synthesis** (or **Synthesize with options…** in the ⋯ menu) you can change:
- the style (concept outline, study notes, Q&A flashcards, argument map, textbook chapter)
- the prompt and the length
- the model and the language
- categories (rename or merge)

## The hidden system prompt (and how to change it)

Every topic starts with a hidden system prompt containing exactly two rules:

1. "Break answers into distinct, logical premises."
2. "When the query challenges something you said, re-examine it honestly: concede plainly if you were wrong, defend it with reasons if you were right, and say so when you are unsure."

Edit it in **Settings › System prompt**, where each rule has a switch and you can add your own text. New topics are answered in **full text** and get only this prompt. If you choose **pyramid points** for new topics, a fixed **answer format** section (the pyramid JSON) is added after it, shown there read-only. Changes apply to **new** topics; a topic keeps the prompt it started with.

## Models and settings (OpenRouter)

Fractal talks to [OpenRouter](https://openrouter.ai): Gemini Pro and Flash, Grok, the ChatGPT tiers, and Claude Opus, Fable and Sonnet. The model list is loaded live, and the answer model defaults to the newest Gemini Pro. The **⚙** button shows only the settings a model supports:

| Model | Extra settings and exceptions |
|---|---|
| **Every model** | Reasoning effort, the budget slider and the off switch follow the model's `reasoning` info. Temperature, top-p, max tokens and the like appear where listed, plus provider routing and fallbacks. |
| **Claude** | Effort can't be "none"; "minimal" is sent as "low". Max tokens stays above the reasoning budget. |
| **Gemini 3** | Effort maps to Google's thinking level; reasoning usually can't be turned off. |
| **Grok** | Effort level only. |
| **GPT-5.6 and newer** | Pro mode, reasoning context and verbosity. |

## Memory ("context left")

Each branch sends only its own path. An answer's ⋯ shows tokens used against the model's limit. At about 70%, **Continue in a fresh branch** starts a new linked root from a short summary.

## Not in this version

- Spending guardrails (each answer shows its cost, and AI images and video show an estimate first).
- Cloud sync or accounts: the zip backup is the way to move data.
- Swipe gestures: the map uses pinch and drag, and everything else uses buttons.
- The Library of all highlights, saved visuals, Test me, export and monthly costs (next version).
