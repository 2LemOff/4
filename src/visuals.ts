import { db, uid } from "./db";
import { cardMarkdown } from "./answer";
import { ARRANGE_FORMAT, ARRANGE_SCHEMA, fallbackArrangement, normalizeArrangement, type Arrangement } from "./arrange";
import { DIAGRAM_ASK, DIAGRAM_SCHEMAS, normalizeDiagram, type DiagramType } from "./diagrams";
import { completeJSON, completeText } from "./openrouter";
import { numbered, splitSources, type Sentence, type SourceText } from "./split";
import { settingsStore } from "./store";
import { lookLine, sanitizeSvg } from "./storyStyles";
import { taskSetup } from "./taskConfig";
import { indexCards, pathToRoot, treeRows } from "./tree";
import type { Card, Highlight, Visual, VisualScope } from "./types";

const key = () => settingsStore.get().apiKey;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Above this many sentences the arrangement comes from the headings and questions, without a model call. */
export const ARRANGE_LIMIT = 300;

export const scopeKey = (s: VisualScope) => `${s.kind}:${[...s.cardIds].sort().join(",")}:${[...(s.highlightIds ?? [])].sort().join(",")}`;

/** The text a scope covers: answers as written (branch and topic answers under their question), or highlighted words. */
export function scopeSources(scope: VisualScope, cards: Card[], highlights: Highlight[]): { sources: SourceText[]; titles: Record<string, string> } {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const titles: Record<string, string> = {};
  if (scope.kind === "highlight" || scope.kind === "highlights") {
    const hs = (scope.highlightIds ?? []).map((id) => highlights.find((h) => h.id === id)).filter((h): h is Highlight => !!h);
    return { sources: hs.map((h) => ({ key: h.id, text: h.quote })), titles };
  }
  const list = scope.cardIds.map((id) => byId.get(id)).filter((c): c is Card => !!c && c.status !== "streaming");
  const many = list.length > 1;
  for (const c of list) if (many) titles[c.id] = c.question.length > 80 ? `${c.question.slice(0, 79)}…` : c.question;
  return { sources: list.map((c) => ({ key: c.id, text: cardMarkdown(c) })), titles };
}

/** Cards a branch or the whole topic covers, in reading order. */
export function scopeCards(kind: "branch" | "topic", cards: Card[], cardId: string): string[] {
  const idx = indexCards(cards);
  return kind === "branch" ? pathToRoot(idx, cardId).map((c) => c.id) : treeRows(idx).map((r) => r.card.id);
}

/** The saved visual of this scope, or a new one (its sentences split now, from exactly this text). */
export async function openVisual(sessionId: string, cardId: string, scope: VisualScope): Promise<string> {
  const k = scopeKey(scope);
  const existing = (await db.visuals.where("scopeKey").equals(k).toArray()).find((v) => v.sessionId === sessionId);
  if (existing) return existing.id;
  const cards = await db.cards.where("sessionId").equals(sessionId).toArray();
  const highlights = await db.highlights.where("sessionId").equals(sessionId).toArray();
  const { sources } = scopeSources(scope, cards, highlights);
  const sentences = splitSources(sources);
  const now = Date.now();
  const v: Visual = { id: uid(), sessionId, cardId, scope, scopeKey: k, sentences, diagrams: {}, createdAt: now, updatedAt: now };
  await db.visuals.put(v);
  return v.id;
}

async function patch(id: string, p: Partial<Visual> | ((v: Visual) => Partial<Visual>)) {
  await db.transaction("rw", db.visuals, async () => {
    const v = await db.visuals.get(id);
    if (!v) return;
    await db.visuals.put({ ...v, ...(typeof p === "function" ? p(v) : p), updatedAt: Date.now() });
  });
}

const running = new Set<string>();
async function once(k: string, fn: () => Promise<void>) {
  if (running.has(k)) return;
  running.add(k);
  try {
    await fn();
  } finally {
    running.delete(k);
  }
}

/**
 * Arrange the visual's sentences (one cheap call). Large scopes, or a reply that can't be used, fall back to
 * the headings and questions, with a note.
 */
export function ensureArrangement(id: string, force = false): Promise<void> {
  return once(`${id}:arrange`, async () => {
    const v = await db.visuals.get(id);
    if (!v || (!force && v.arrangement && v.arrangement.status !== "error")) return;
    const cards = await db.cards.where("sessionId").equals(v.sessionId).toArray();
    const { titles } = scopeSources(v.scope, cards, []);
    if (v.sentences.length > ARRANGE_LIMIT) {
      await patch(id, { arrangement: { status: "done", data: fallbackArrangement(v.sentences, titles), error: `Arranged by questions and headings (more than ${ARRANGE_LIMIT} sentences).` } });
      return;
    }
    await patch(id, { arrangement: { status: "running" } });
    try {
      if (!key()) throw new Error("Connect OpenRouter in Settings first.");
      const t = taskSetup("arrange", { middle: ARRANGE_FORMAT });
      const { data } = await completeJSON<unknown>({
        apiKey: key(),
        model: t.info,
        messages: [
          { role: "system", content: t.prompt },
          { role: "user", content: `What these sentences are about: ${v.scope.label}\n\n${numbered(v.sentences)}` },
        ],
        schemaName: "arrangement",
        schema: ARRANGE_SCHEMA,
        extra: t.params,
      });
      await patch(id, { arrangement: { status: "done", data: normalizeArrangement(data, v.sentences) } });
    } catch (e) {
      await patch(id, { arrangement: { status: "error", data: fallbackArrangement(v.sentences, titles), error: message(e) } });
    }
  });
}

/** One AI diagram of the visual's sentences; every element cites sentence ids. */
export function ensureDiagram(id: string, type: DiagramType, force = false): Promise<void> {
  return once(`${id}:${type}`, async () => {
    const v = await db.visuals.get(id);
    const cur = v?.diagrams[type];
    if (!v || (!force && cur && cur.status !== "error")) return;
    await patch(id, (x) => ({ diagrams: { ...x.diagrams, [type]: { status: "running" } } }));
    try {
      if (!key()) throw new Error("Connect OpenRouter in Settings first.");
      const t = taskSetup("diagram", { middle: DIAGRAM_ASK[type] });
      const { data } = await completeJSON<unknown>({
        apiKey: key(),
        model: t.info,
        messages: [
          { role: "system", content: t.prompt },
          { role: "user", content: `What these sentences are about: ${v.scope.label}\n\n${numbered(v.sentences)}` },
        ],
        schemaName: `diagram_${type}`,
        schema: DIAGRAM_SCHEMAS[type],
        extra: t.params,
      });
      const spec = normalizeDiagram(type, data, v.sentences);
      await patch(id, (x) => ({ diagrams: { ...x.diagrams, [type]: { status: "done", spec } } }));
    } catch (e) {
      await patch(id, (x) => ({ diagrams: { ...x.diagrams, [type]: { status: "error", error: message(e) } } }));
    }
  });
}

/** An AI sketch (sanitized SVG) explaining the visual's sentences. */
export function ensureSketch(id: string, force = false): Promise<void> {
  return once(`${id}:sketch`, async () => {
    const v = await db.visuals.get(id);
    if (!v || (!force && v.sketch && v.sketch.status !== "error")) return;
    await patch(id, { sketch: { status: "running" } });
    try {
      if (!key()) throw new Error("Connect OpenRouter in Settings first.");
      const t = taskSetup("sketch", { middle: lookLine(settingsStore.get().story) });
      const text = await completeText({
        apiKey: key(),
        model: t.info,
        messages: [
          { role: "system", content: t.prompt },
          { role: "user", content: `Scene: one clear explanatory picture of the idea below, like a textbook illustration.\nIt illustrates: ${v.sentences.map((s) => s.text).join(" ").slice(0, 2500)}` },
        ],
        extra: t.params,
      });
      const svg = sanitizeSvg(text);
      if (!svg) throw new Error("The drawing model didn't return a usable picture.");
      await patch(id, { sketch: { status: "done", svg } });
    } catch (e) {
      await patch(id, { sketch: { status: "error", error: message(e) } });
    }
  });
}

/** More neighbours for one level ("What else is on this level?"). */
export async function moreNeighbours(id: string, level: number): Promise<void> {
  const v = await db.visuals.get(id);
  const a = v?.arrangement?.data;
  const lv = a?.levels[level];
  if (!v || !a || !lv) return;
  const t = taskSetup("arrange");
  const path = a.levels.slice(0, level + 1).map((l) => l.name).join(" › ");
  const { data } = await completeJSON<{ names: string[] }>({
    apiKey: key(),
    model: t.info,
    messages: [{ role: "user", content: `In the map of knowledge ${path}, list up to 8 more topics on the same level as "${lv.name}" that are not already listed: ${[lv.name, ...lv.siblings].join(", ")}. Reply with JSON only: {"names":["…"]}.` }],
    schemaName: "neighbours",
    schema: { type: "object", additionalProperties: false, required: ["names"], properties: { names: { type: "array", items: { type: "string" } } } },
    extra: t.params,
  });
  const extra = (data.names ?? []).map((n) => String(n).trim()).filter((n) => n && n !== lv.name && !lv.siblings.includes(n));
  await patch(id, (x) => {
    const arr = x.arrangement?.data;
    if (!arr) return {};
    const levels = arr.levels.map((l, i) => (i === level ? { ...l, siblings: [...l.siblings, ...extra] } : l));
    return { arrangement: { ...x.arrangement!, data: { ...arr, levels } satisfies Arrangement } };
  });
}

export const setVisualNotes = (id: string, notes: string) => patch(id, { notes });
export const deleteVisual = (id: string) => db.visuals.delete(id);

/** Arrangements, diagrams and sketches left running when the app closed run again. */
export async function resumeVisuals(): Promise<void> {
  for (const v of await db.visuals.toArray()) {
    if (v.arrangement?.status === "running") void ensureArrangement(v.id, true);
    for (const [type, d] of Object.entries(v.diagrams)) if (d?.status === "running") void ensureDiagram(v.id, type as DiagramType, true);
    if (v.sketch?.status === "running") void ensureSketch(v.id, true);
  }
}

/** The answer a sentence comes from (for "Show in the answer" and "Ask about this"). */
export function sentenceCard(v: Visual, s: Sentence, highlights: Highlight[]): string {
  if (v.scope.kind === "highlight" || v.scope.kind === "highlights") return highlights.find((h) => h.id === s.source)?.cardId ?? v.cardId;
  return s.source;
}
