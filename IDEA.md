# Fractal: learn by questioning every answer

Ask a frontier AI a question and read the answer in a classic chat, like Claude or Gemini. Then **highlight any words of an answer and ask about them**, or highlight several passages, even in different answers, and ask about all of them in one prompt. Every question starts its own branch, so the conversation becomes a tree you can always find your way back through.

Mobile only. Runs in the phone browser (installable PWA). Everything stays on your phone, with a one-tap backup.

## The core loop

1. Ask a question. The box on Home grows with what you paste and keeps paragraph breaks.
2. The answer arrives **whole, exactly as the model wrote it** (paragraphs, lists, tables). The app never cuts or shortens it.
3. Select words in an answer. A slim bar of small icons above the question box offers:
   - **Mark+**: keep the words as a yellow highlight and collect them
   - **Ask**: the same, then type your question
   - **Quick**: a short side answer (below)
   - **Check**: a claim check (below)
   - **Visualize** (below)
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

## Quick answers and checks

- **Quick** (on a selection or the tray) opens a small sheet with the quoted words and one-tap questions: Explain this, Give an example, Why is this true?, Define the terms. You can also type your own.
  - The short answer uses the same conversation (so it's cheap with a prompt cache) and the **Quick answers** task: its model, prompt, length (1 sentence to 2 paragraphs) and settings.
  - It appears under the answer it's about. Follow-ups continue the same side thread.
  - **Check it** has a second model (the **Quick check** task) give ✓, ? or ✗ with a reason. This can also run on every quick answer.
  - Quick answers are never sent with later questions. **Make it a branch** turns the side thread into real questions and answers in the tree.
- **Check** (on a selection or the tray) splits the words into claims. Each claim is ✓ supported, ? uncertain or ✗ disputed, with a reason. A highlight with a disputed claim gets a red wavy underline. Web search (OpenRouter's web plugin) can be switched on in the **Claim check** task.

## Photos and screenshots

- **+** next to the question box (on Home and in the chat) offers **Take a photo**, **Photos and screenshots**, **From files** and **Paste a copied picture**. Pasting a picture straight into the question box works too.
- Pictures are made smaller (at most 1600 px, WebP) and kept on the phone with the topic. Their thumbnails wait above the question box; ✕ removes one. With no question typed, they're sent with "Explain this picture."
- **Ask about a part:** the box button on a thumbnail, or **Ask about a part of it** on a picture you already sent, lets you draw a box over what you mean. The part is cut from the picture as it was taken (so it stays sharp) and sent along with the whole picture, and the model is told which picture it is a close-up of.
- If the chosen model can't see pictures, one that can is used instead (the newest of the same family, else Gemini Pro, Claude Opus or ChatGPT) and named under the box. While pictures are attached, ⚙ lists only models that can see them.
- **Read the text** under a sent picture: the **Text from images** task (Settings › Models › Photos) copies the picture's text below your message. That text can be highlighted like an answer (Mark+, Ask, Quick, Check, Visualize, the tray), and the question then says the words come from your picture.
- **History stays append-only:** a picture is replayed in the turn it was sent with. A model that can't see pictures (a council member, say) gets the text read from them instead; the app reads it first when needed.
- Deleting an answer and its branches deletes the pictures sent with those questions. Backups include them.

## Visualize

Any answer, one highlight, the tray (several highlights), a branch or the whole topic can be seen in other ways:
- **Visualize** under an answer
- **Visualize** on the selection bar or the tray
- ⋯ › **Visualize this branch** or **the whole topic**

A picker lists every view, the ones that fit the text best first:
- numbers → scale ladder or chart
- dates → timeline
- steps → flow
- "because / leads to" → cause → effect
- two or more highlights → compare or Venn

**Nothing is lost.** Only when you visualize does the app split just that text into sentences (headings, list items and table rows included). One cheap call (Settings › Models › Arrange for views) places the sentences by id: subject levels, groups, kinds and links. It never rewrites them. Every sentence appears in the views word for word, and anything left unplaced goes to "Other details". If that call fails, the headings and questions give a simple arrangement.

**Views drawn from that one arrangement** (no extra call):
- **Big idea → details:** Big / Mid / Fine, and big idea first ⇄ first principles first.
- **Levels:** where it sits, from the broad field down to this, each level with a short description.
  - Its neighbours appear as dashed "ghosts", with "+N" instead of sideways scrolling. Tap one to ask about it.
  - **＋** asks what else is on that level, and **Question it ↓** asks how this fits within it.
  - **Compare 2** compares two topics.
  - Your answer's groups sit at the bottom, shaded when you've asked about them, with badges (↳ questions asked, Council, Saved).
  - A search box filters every level.
- **Mind map:** the big idea in the middle, groups around it, with pinch, drag and − + Fit.
- **Study doc:** sections with the answer's own paragraphs, headings and list items, plus **My notes** and a **side chat**. Questions asked there continue the topic as a branch, and their answers show in the doc.
- **Argument chain:** foundations → steps → conclusions, with what each builds on.
- **Outline.**

**AI diagrams**, one cheap call each (Settings › Models › Diagrams):
- concept map
- compare table
- Venn / overlap
- process flow
- cause → effect
- timeline
- scale ladder
- numbers chart (log scale when values differ more than 100×)

Every element cites the sentences it came from, and **Not in this diagram (n)** lists the ones it doesn't use. There's also an AI **sketch** and **story slides** of the selection.

Tap anything in a view to see the exact sentences, then **Ask about this** or **Show in the answer** (the chat opens with the words marked). Visuals are saved: an answer shows **Visuals (n)**, and reopening costs nothing.

**Read more** lives only in these views: long text is cut after a few lines (Settings › Views). The chat always shows everything.

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

1. **Members** (newest Gemini Pro, Claude Opus, top ChatGPT and Grok by default) answer in parallel, each with the branch history. Each member can have **its own settings** (⚙ next to it in Settings › Council), used for answering and reviewing.
2. **Peer review:** members rank each other's anonymized answers ("Response A…"). This step can be turned off, and its prompt and length edited (⚙).
3. The **chairman** (changeable between questions with **▾** or in Settings › Council; ⚙ for its prompt and settings) reasons and writes the final answer using **only the council's text**:
   - In a full-text topic it writes normal text and ends every paragraph with the answers it came from (`[A, C]`). The app shows them as small badges and removes the tags from the text.
   - A cheap verifier (the **Grounding check** task) checks every paragraph against the member answers. Paragraphs it can't find are **folded** under the answer ("1 paragraph not found in the members' answers"), never deleted, and left out of later questions.
4. Under the answer:
   - the **agreement** between the members
   - each member's **full answer**, with **Continue with this model**
   - **Not in the final answer:** the member sentences the chairman left out (an offline word check)
   - the peer reviews

Pyramid topics keep the pyramid chairman: each point cites its sources, and unsupported points are removed or marked. **Council** on the tray asks the council about exactly the highlighted words. Later questions replay a council answer as the plain question plus the kept text (or the checked JSON), with no reasoning, so history stays append-only.

## Story slides (optional, on demand)

**Learn as a story** (in an answer's ⋯, or on a map point) turns this answer, the point's pyramid, or the whole branch into 3–4 narrated slides. Nothing is generated until you ask.

- **Style:**
  - **TED-Ed:** a character-driven hook, warm flat illustrations, and a reflective question at the end
  - **ScienceClic:** one visual model built step by step, with geometric diagrams on dark
  - **Custom**

  The rules for every style can be edited. **Add screenshots** of frames you like, and a vision model writes a style description for that style.
- **Pictures:**
  - **Shapes drawn by AI** (default): a small SVG in a chosen look (colorful flat vectors, line art, diagrams on dark, isometric, paper cut-out, chalkboard, or your own). It is sanitized and shown only as an image.
  - **AI image** per slide or for every slide. Models and settings come from OpenRouter's `/images/models` and each model's endpoint record. The estimated price comes from the endpoint's pricing lines: per image or per megapixel (from the resolution tier), the line for the chosen resolution, plus reference images when sent; token-priced models say "known when done". A failed image isn't charged.
  - **AI video**, opt-in per slide. Models, durations, resolutions and aspect ratios come from `/videos/models` (never a size next to them); a clip starts at the duration closest to 5 seconds. **Clip's own sound** is off by default (the narration plays anyway). The price from `pricing_skus` is shown before you confirm, with the SKU it's based on and a **Price details** list. Clips are downloaded with your key (the links aren't public), kept on the phone, and their cost is saved. Jobs are checked about every 30 seconds, keep going if you leave, and resume after a restart.
- **Voice:**
  - an AI voice model from OpenRouter's speech models, with that model's own voices (`supported_voices`), **▶ Preview**, an optional **narrator style** (followed by OpenAI and Gemini voices) and speech speed (left out for models without it)
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

Fractal talks to [OpenRouter](https://openrouter.ai): Gemini Pro and Flash, Grok, the ChatGPT tiers, and Claude Opus, Fable and Sonnet. The model list is loaded live.

**Settings › Models lists every place a model is used**, grouped, and each opens the same editor:
- **Chat:** answers, quick answers, quick check, claim check
- **Council:** the chairman, peer review and the grounding check (members in Settings › Council)
- **Views:** arranging for views, diagrams, drawing (plus the study doc in Settings › Synthesis)
- **Photos:** text from images
- **Search and memory:** reranking, the fresh-branch summary, embeddings
- **Stories:** the story writer and the style-from-screenshots model (voice, images and video in Settings › Story)

In each editor you choose:
- the **model**; Automatic picks the newest suitable one, never a `:batch` or `:free` variant
- the **prompt**; whatever the app must add to read the reply (a JSON format) is shown read-only
- the **length**, in the task's own terms: sentences, words, claims or elements
- **every setting that model supports**, saved per model

The answers' editor also holds the hidden system prompt. The answer model defaults to the newest Gemini Pro and can be changed per question. The **⚙** button next to the question box shows only the settings a model supports:

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
