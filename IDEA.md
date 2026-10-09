# Fractal: learn by questioning every answer

Ask a frontier AI a question. Then question its answer, or any later answer, as deeply as you like. Fractal keeps every question as a branch of a tree, not a straight chat, and draws every answer as a **pyramid of reasoning** on one map, so you can see how ideas connect and always find your way back.

Mobile only. Runs in the phone browser (installable PWA). Everything stays on your phone, with a one-tap backup.

## The core loop

1. Ask a question. The box on Home grows with what you paste and keeps paragraph breaks.
2. The answer arrives as one or more **pyramids** on the **map**. Each one builds from the bottom up:
   - **Foundations** (first principles) at the top, grouped into **categories**, which can sit inside other categories
   - **Steps** derived from the foundations
   - a **Conclusion** at the bottom, whose title names the pyramid

   Unrelated parts of an answer become separate pyramids.
3. Ask about:
   - one point (tap it)
   - several points (**Select several points**, then tap each)
   - a category (tap its title)
   - a whole pyramid (**Ask about the whole pyramid** in the point's panel)
4. The new question appears as a bubble linked to what you asked about, and its answer as new pyramids. Answers can build on earlier points (dashed "builds on" links). When an answer declares no link, similar earlier points are linked with dotted lines.
5. **✦ Synthesize** compiles the whole tree into a **Concept Outline** in the **Library**.

```
 [Light]──────────[Scattering]        ← categories of foundations
  Light is waves   Small particles
        \           /  scatter short waves
       Air scatters blue the most     ← step
              |
        "Blue sky"                    ← conclusion (pyramid title)
              |
      ( Why not violet? )             ← your question, linked to the point
              |
        new pyramid… ─ ─ builds on ─ ─ ▶ earlier foundation
```

## The map

- **Moving around:** pinch to zoom and drag to move, plus buttons for **−**, **+**, **Fit** and **Focus** (frames the current answer).
- **All | Foundations:** Foundations shows only the first principles of the whole topic, inside their categories, as an overview.
- **Selecting a point** highlights what it rests on and what it supports, across answers. The panel lists both, plus a bookmark and **Learn as a story**.
- **Outline** shows the same answer as an indented list for reading.
- **Breadcrumbs** (small pills) show the path to the current answer; tapping one jumps there.
- **Search by concept:** embeddings find candidates, an LLM reranks them, and the map opens on the exact point. Offline, search falls back to word matching.
- **Bookmarks:** a small black-and-white ribbon on points and answers. Saved items are listed on Home and in the Library.
- **Compact UI:** the quick-question chips sit behind the **?** toggle. Icons are monochrome line drawings, not emoji.

## LLM Council (optional, per question)

Turn on the **Council** toggle next to the question box before asking. It stays on for that topic until you turn it off. This follows [karpathy/llm-council](https://github.com/karpathy/llm-council), but conversations can continue.

1. **Members** (newest Gemini Pro, Claude Opus, top ChatGPT and Grok by default) answer in parallel, each with the branch history.
2. **Peer review:** members rank each other's anonymized answers ("Response A…"). This step can be turned off.
3. The **chairman** (one fixed model, changeable between questions with **▾** or in Settings › Council) reasons and writes the final pyramid using **only the council's text**. Each point cites the answers it came from. A cheap verifier then checks every point against the member answers, and points that aren't supported are removed (or, if you prefer, badged "Not in the council's answers").

Each member's answer has **Continue with this model**, which switches the council off and asks the next question with that model. Later questions replay a council answer as the plain question plus the checked JSON, with no reasoning, so history stays append-only.

## Story slides (optional, on demand)

**Learn as a story** (in the ⋯ menu, or on a point) turns this answer, the point's pyramid, or the whole branch into 3–4 narrated slides. Nothing is generated until you ask.

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
  - captions: tap a sentence to ask about it on the map
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

Edit it in **Settings › System prompt**, where each rule has a switch and you can add your own text. A fixed **answer format** section (the pyramid JSON) is added after it and shown there read-only. Changes apply to **new** topics; a topic keeps the prompt it started with.

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

Each branch sends only its own path. The question's panel shows tokens used against the model's limit. At about 70%, **Continue in a fresh branch** starts a new linked root from a short summary.

## Not in this version

- Spending guardrails (each answer shows its cost, and AI images and video show an estimate first).
- Cloud sync or accounts: the zip backup is the way to move data.
- Swipe gestures: the map uses pinch and drag, and everything else uses buttons.
