import { db, uid } from "./db";
import { splitBlocks } from "./blocks";
import { completeJSON, prepareMessages, streamChat } from "./openrouter";
import { settingsStore, streamStore } from "./store";
import { taskSetup } from "./taskConfig";
import { buildMessages, highlightTurn, indexCards, type ChatMessage } from "./tree";
import { ANSWER_FORMAT, usesPyramids } from "./prompts";
import type { Card, Claim, ClaimCheck, ClaimVerdict, Quick, QuickTurn, QuickVerdict } from "./types";

const key = () => settingsStore.get().apiKey;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const quickStreamKey = (id: string, i: number) => `quick:${id}:${i}`;

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Messages for a quick answer: the branch history exactly as it is (so the provider's prompt cache applies),
 * earlier turns of this quick thread, then the quick instructions with the quoted words and the question.
 */
export function quickMessages(history: ChatMessage[], instructions: string, quotes: string[], turns: { question: string; answer: string }[], question: string): ChatMessage[] {
  const ask = (q: string, first: boolean) => `${instructions}\n\n${first && quotes.length ? highlightTurn(quotes, q) : q}`;
  const msgs = [...history];
  turns.forEach((t, i) => {
    msgs.push({ role: "user", content: ask(t.question, i === 0) });
    msgs.push({ role: "assistant", content: t.answer });
  });
  msgs.push({ role: "user", content: ask(question, turns.length === 0) });
  return msgs;
}

const VERDICTS: QuickVerdict[] = ["ok", "unsure", "wrong"];
export function normalizeVerdict(raw: unknown): { verdict: QuickVerdict; reason: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const v = String(r.verdict ?? "").toLowerCase();
  return { verdict: VERDICTS.includes(v as QuickVerdict) ? (v as QuickVerdict) : "unsure", reason: String(r.reason ?? "").trim() };
}

const CLAIM_VERDICTS: ClaimVerdict[] = ["supported", "uncertain", "disputed"];
/** The checker's claims made safe: empty ones dropped, unknown verdicts read as "uncertain". */
export function normalizeClaims(raw: unknown, max = 30): Claim[] {
  const list = Array.isArray((raw as { claims?: unknown })?.claims) ? (raw as { claims: unknown[] }).claims : [];
  return list
    .map((c: any) => ({
      claim: String(c?.claim ?? "").trim(),
      quote: String(c?.quote ?? "").trim(),
      verdict: CLAIM_VERDICTS.includes(String(c?.verdict ?? "").toLowerCase() as ClaimVerdict) ? (String(c.verdict).toLowerCase() as ClaimVerdict) : "uncertain",
      reason: String(c?.reason ?? "").trim(),
    }))
    .filter((c) => c.claim)
    .slice(0, max);
}

export const claimCounts = (claims: Claim[]) => ({
  supported: claims.filter((c) => c.verdict === "supported").length,
  uncertain: claims.filter((c) => c.verdict === "uncertain").length,
  disputed: claims.filter((c) => c.verdict === "disputed").length,
});

// ── Quick threads ────────────────────────────────────────────────────────────

async function patchQuick(id: string, fn: (q: Quick) => void) {
  await db.transaction("rw", db.quicks, async () => {
    const q = await db.quicks.get(id);
    if (!q) return;
    fn(q);
    await db.quicks.put(q);
  });
}

/** Start a quick thread about highlighted words (or quoted text) under an answer. */
export async function startQuick(o: { sessionId: string; cardId: string; highlightIds: string[]; quotes: string[]; question: string }): Promise<string> {
  const id = uid();
  const model = taskSetup("quick").model;
  await db.quicks.put({ id, sessionId: o.sessionId, cardId: o.cardId, highlightIds: o.highlightIds, quotes: o.quotes, turns: [{ question: o.question, answer: "", status: "running", model }], createdAt: Date.now() });
  void runQuickTurn(id, 0);
  return id;
}

/** A follow-up in the same quick thread. */
export async function askQuick(id: string, question: string): Promise<void> {
  const model = taskSetup("quick").model;
  let i = -1;
  await patchQuick(id, (q) => {
    q.turns.push({ question, answer: "", status: "running", model });
    i = q.turns.length - 1;
  });
  if (i >= 0) void runQuickTurn(id, i);
}

export async function runQuickTurn(id: string, i: number): Promise<void> {
  const q = await db.quicks.get(id);
  const turn = q?.turns[i];
  if (!q || !turn) return;
  const sk = quickStreamKey(id, i);
  try {
    if (!key()) throw new Error("Connect OpenRouter in Settings first.");
    const session = await db.sessions.get(q.sessionId);
    const cards = await db.cards.where("sessionId").equals(q.sessionId).toArray();
    const t = taskSetup("quick", { model: turn.model });
    const idx = indexCards(cards);
    // pyramid topics ask for JSON answers; a quick answer is plain text, so that section is left out here
    const sys = session ? (usesPyramids(session.systemPrompt) ? session.systemPrompt.replace(ANSWER_FORMAT, "").trim() : session.systemPrompt) : "";
    const history = idx.has(q.cardId) ? buildMessages(idx, q.cardId, "", undefined, { systemPrompt: sys, model: t.model }).slice(0, -1) : [];
    const msgs = quickMessages(history, t.prompt, q.quotes, q.turns.slice(0, i).filter((x) => x.status === "done"), turn.question);
    streamStore.set((s) => ({ ...s, [sk]: { content: "", reasoning: "" } }));
    const st = await streamChat({
      apiKey: key(),
      body: { model: t.model, messages: prepareMessages(t.model, msgs), ...t.params },
      onUpdate: (s) => streamStore.set((all) => ({ ...all, [sk]: { content: s.content, reasoning: s.reasoning } })),
    });
    await patchQuick(id, (x) => {
      x.turns[i] = {
        ...x.turns[i],
        answer: st.content.trim(),
        status: st.content.trim() ? "done" : "error",
        error: st.content.trim() ? undefined : st.error ?? "No answer came back.",
        usage: st.usage ? { prompt: st.usage.prompt, completion: st.usage.completion, reasoning: st.usage.reasoning, cost: st.usage.cost } : undefined,
      };
    });
    if (st.content.trim() && settingsStore.get().quickAutoCheck) void checkQuickTurn(id, i);
  } catch (e) {
    await patchQuick(id, (x) => {
      x.turns[i] = { ...x.turns[i], status: "error", error: message(e) };
    });
  } finally {
    streamStore.set((s) => {
      const { [sk]: _drop, ...rest } = s;
      return rest;
    });
  }
}

export async function retryQuickTurn(id: string, i: number): Promise<void> {
  await patchQuick(id, (q) => {
    if (q.turns[i]) q.turns[i] = { ...q.turns[i], status: "running", error: undefined, answer: "", model: taskSetup("quick").model };
  });
  void runQuickTurn(id, i);
}

/** A second model checks one quick answer: ✓ / ? / ✗ with a reason. */
export async function checkQuickTurn(id: string, i: number): Promise<void> {
  const q = await db.quicks.get(id);
  const turn = q?.turns[i];
  if (!q || !turn || turn.status !== "done") return;
  const t = taskSetup("quickCheck");
  await patchQuick(id, (x) => {
    x.turns[i].check = { status: "running", model: t.model };
  });
  try {
    const { data } = await completeJSON<unknown>({
      apiKey: key(),
      model: t.info,
      messages: [
        { role: "system", content: t.prompt },
        { role: "user", content: `${q.quotes.length ? `About: ${q.quotes.map((x) => `"${x}"`).join(" / ")}\n\n` : ""}Question: ${turn.question}\n\nShort answer to check:\n${turn.answer}` },
      ],
      schemaName: "quick_check",
      schema: { type: "object", additionalProperties: false, required: ["verdict", "reason"], properties: { verdict: { type: "string", enum: VERDICTS }, reason: { type: "string" } } },
      extra: t.params,
    });
    const v = normalizeVerdict(data);
    await patchQuick(id, (x) => {
      x.turns[i].check = { status: "done", model: t.model, ...v };
    });
  } catch (e) {
    await patchQuick(id, (x) => {
      x.turns[i].check = { status: "error", model: t.model, error: message(e) };
    });
  }
}

/** Turn a quick thread into real questions and answers: a branch under the answer it hangs under. */
export async function quickToBranch(id: string): Promise<string | undefined> {
  const q = await db.quicks.get(id);
  if (!q) return;
  const done = q.turns.filter((t: QuickTurn) => t.status === "done");
  let parent = q.cardId;
  let last: string | undefined;
  const now = Date.now();
  for (const [k, t] of done.entries()) {
    const card: Card = {
      id: uid(),
      sessionId: q.sessionId,
      parentId: parent,
      anchor: k === 0 && q.quotes.length ? { text: q.quotes.join(" / "), quotes: q.quotes, scope: "highlights", highlightIds: q.highlightIds.length ? q.highlightIds : undefined } : undefined,
      question: t.question,
      blocks: splitBlocks(t.answer),
      assistant: { content: t.answer },
      model: t.model,
      usage: t.usage,
      status: "done",
      createdAt: now + k,
    };
    await db.cards.put(card);
    parent = card.id;
    last = card.id;
  }
  if (last) {
    await db.sessions.update(q.sessionId, { lastCardId: last, updatedAt: Date.now() });
    await db.quicks.delete(id);
  }
  return last;
}

export const deleteQuick = (id: string) => db.quicks.delete(id);

// ── Claim checks ─────────────────────────────────────────────────────────────

const CLAIM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "quote", "verdict", "reason"],
        properties: { claim: { type: "string" }, quote: { type: "string" }, verdict: { type: "string", enum: CLAIM_VERDICTS }, reason: { type: "string" } },
      },
    },
  },
};

/** Split highlighted text into claims and judge each (optionally with web search). */
export async function startClaimCheck(o: { sessionId: string; cardId: string; highlightIds: string[]; quotes: string[] }): Promise<string> {
  const id = uid();
  const t = taskSetup("claimCheck");
  const web = settingsStore.get().claimWebSearch;
  await db.checks.put({ id, sessionId: o.sessionId, cardId: o.cardId, highlightIds: o.highlightIds, quotes: o.quotes, status: "running", claims: [], model: t.model, web, createdAt: Date.now() });
  void runClaimCheck(id);
  return id;
}

export async function runClaimCheck(id: string): Promise<void> {
  const c = await db.checks.get(id);
  if (!c) return;
  const t = taskSetup("claimCheck");
  await db.checks.update(id, { status: "running", error: undefined, model: t.model });
  try {
    if (!key()) throw new Error("Connect OpenRouter in Settings first.");
    const card = await db.cards.get(c.cardId);
    const { data, usage } = await completeJSON<unknown>({
      apiKey: key(),
      model: t.info,
      messages: [
        { role: "system", content: t.prompt },
        { role: "user", content: `${card ? `It comes from an answer to: ${card.question}\n\n` : ""}Text to check:\n${c.quotes.map((x) => `"${x}"`).join("\n\n")}` },
      ],
      schemaName: "claim_check",
      schema: CLAIM_SCHEMA,
      extra: { ...t.params, ...(c.web ? { plugins: [{ id: "web" }] } : {}) },
    });
    const claims = normalizeClaims(data);
    await db.checks.update(id, { status: claims.length ? "done" : "error", claims, usage, error: claims.length ? undefined : "No claims came back." });
  } catch (e) {
    await db.checks.update(id, { status: "error", error: message(e) });
  }
}

export const deleteCheck = (id: string) => db.checks.delete(id);

/** Quick threads and checks left running when the app closed run again. */
export async function resumeQuick(): Promise<void> {
  for (const q of await db.quicks.toArray()) q.turns.forEach((t, i) => t.status === "running" && void runQuickTurn(q.id, i));
  for (const c of await db.checks.toArray()) if (c.status === "running") void runClaimCheck(c.id);
}

export type { ClaimCheck };
