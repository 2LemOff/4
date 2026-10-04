# Fractal: learn by questioning every answer

Ask a frontier AI a question. Then question its answer, or any later answer, as deeply as you like. Fractal keeps every question as a branch of a tree, not a straight chat, so you can always find your way back.

Mobile only. Runs in the phone browser (installable PWA). History stays on your phone.

## The core loop

1. Ask a question. The answer arrives as a **card** of short blocks, one premise each.
2. **Tap any sentence.** A new card slides in with that sentence as its header and an input: *"What do you want to ask about this?"*
3. Keep going. Every card can have many questions, so the session becomes a tree.
4. Press **✦ Synthesize** at any time to compile the whole tree into a one-page **Concept Outline**. Outlines are collected in a **Library**, grouped by subject.

```
Q: What is superposition?
 ├ [1] "A mix of states at once"
 ├ [2] "Measuring gives one result"
 │    ├─> Q: Why does measuring change it?
 │    │    └ [2] "It entangles with the world"
 │    │         ├─> Q: Who counts as an observer?
 │    │         └─> Q: Is that decoherence?
 │    └─> Q: Can you measure gently?
 └ [3] "Odds come from the wave function"
      └─> Q: Why is it squared?
```

## One card

```
┌──────────────────────────────┐
│ Physics > Measurement > ...  │ ← breadcrumbs (tap a tag to jump back)
│                          [🔍]│
├──────────────────────────────┤
│ [↑ Parent]  [◀] 1 / 2 [▶] [⋯]│ ← buttons, no gestures
├──────────────────────────────┤
│ "Measuring gives one result" │ ← the sentence you tapped
│ Q: Why does measuring        │
│    change anything?          │
│ ┌──────────────────────────┐ │
│ │ Measuring means          │ │ ← each block = one premise
│ │ interacting.             │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ Interacting entangles    │ │ ← tap any sentence to dig deeper
│ │ it with the world.       │ │
│ └──────────────────────────┘ │
│ > Show reasoning             │ ← folded away
│ Questions on this card (2)   │ ← the way back down
├──────────────────────────────┤
│ ◯ 38k / 1M                   │ ← context left
│ [Why?][Example][What if…]    │
│ [ Ask about this card… ][⚙][Ask]
│ [        ✦ Synthesize     ][▾]│
│  Learn      Library   Settings│
└──────────────────────────────┘
```

## Navigation

- **Breadcrumbs** are short semantic tags (2–4 words) written by a fast model. Tapping one teleports to that card.
- **↑ Parent**, **◀ 1 / 2 ▶** (sibling questions on the same parent) and a **Questions on this card** list cover up, sideways and down.
- **Search by concept** ("where did I ask about observers?"): embeddings find candidate cards, an LLM reranks them, and the exact card opens in its branch with the matching block highlighted. Offline, search falls back to word matching.

## Synthesis (and how to change it)

**✦ Synthesize** reads the whole tree of the session in the background and returns structured JSON: title, category, summary, and sections of points. Each point links back to the card(s) it came from.

In **Settings › Synthesis** (or the **▾** next to the button for a single run) you can change:

- the **style** (concept outline, study notes, Q&A flashcards, argument map, textbook chapter)
- the full **synthesis prompt**
- heading depth, length, examples, open questions and language
- the **model** and its reasoning settings
- whether categories are reused or chosen freely, and rename or merge categories

The **Library** groups outlines by category ("Economics", "Biology"), with an "In progress" section for anything not yet synthesized. Re-synthesizing keeps older versions.

## The hidden system prompt (and how to change it)

Every session starts with a hidden system prompt containing two exact directives:

1. "Never provide long, unbroken walls of text. Break answers into distinct, logical premises."
2. "Speak in first principles. Assume the user will question the foundational logic of every claim you make."

It also carries formatting rules (one premise per paragraph) and honest-pushback rules. Edit it in **Settings › System prompt**; each rule has a switch. Changes apply to **new** sessions: a session keeps the prompt it started with, which keeps its history append-only and its reasoning valid.

## Models and settings (OpenRouter)

Fractal talks to [OpenRouter](https://openrouter.ai), so one account covers Gemini Pro and Flash, Grok, the ChatGPT tiers, and Claude Opus, Fable and Sonnet. The model list is loaded live; each family starts on its newest model, and the answer model defaults to the newest Gemini Pro.

The **⚙** button opens that model's settings. Each control shows only if the model supports it:

| Model | Extra settings and exceptions |
|---|---|
| **Every model** | Reasoning effort levels, the token-budget slider, and the off switch follow the model's own `reasoning` info from OpenRouter. Also temperature, top-p, max tokens and the like where listed, plus provider routing and fallback models. |
| **Claude** | Effort can't be "none"; "minimal" is sent as "low". Max tokens is always kept above the reasoning budget. Newer Claude models don't accept temperature. Effort can change mid-session without resetting the cache on newer models. |
| **Gemini 3** | Effort maps to Google's thinking level ("xhigh" is treated as "high"); the budget is approximate; reasoning usually can't be turned off. |
| **Grok** | Effort level only; no budget slider. |
| **GPT-5.6 and newer** | Pro mode, reasoning context (auto / all turns / current turn) and verbosity. |

Effort and a token budget are never sent together. If reasoning uses up the whole token limit, the card says so and offers **More tokens** or **Lower effort**.

## Memory ("context left")

Each branch sends only its own path, so drilling down stays cheap. The meter on every card shows tokens used against the model's limit. At about 70% it offers **Continue in a fresh branch**: a short AI summary of the path becomes a new linked root card.

## Not in this version

- Spending guardrails (each card just shows its cost).
- Cloud sync or accounts. Export/import JSON in Settings › Data is the backup.
- A chat-bubble view.
