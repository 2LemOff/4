import { db, uid } from "./db";
import { modelInfo, settingsStore, streamStore, updateSettings } from "./store";
import { completeJSON, completeText, embed, OpenRouterError, prepareMessages, streamChat } from "./openrouter";
import { buildMessages, indexCards, pathToRoot, type ChatMessage } from "./tree";
import { buildRequestParams, resolveReasoning, settingsControls } from "./modelRules";
import { canUseConfigUpdate, DEFAULT_MAX_TOKENS, reasoningExhausted } from "./reasoning";
import { planEffort } from "./effort";
import { splitBlocks } from "./blocks";
import { makeFreshCard } from "./context";
import { rerankPrompt, sessionPrompt, usesPyramids } from "./prompts";
import { settingsFor, taskModel, taskSetup } from "./taskConfig";
import { ANSWER_SCHEMA, answerTitle, parseAnswer, prefixFor, pruneCrossLinks, textAnswer, type Answer } from "./answer";
import { hitText, keywordSearch, quantize, topCards } from "./search";
import type { Anchor, Card, ModelSettings, Session } from "./types";

const apiKey = () => settingsStore.get().apiKey;

/** Node-id prefix of a card: K{seq} for pyramid answers, a card-based prefix for converted v1 answers. */
export const cardPrefix = (c: Pick<Card, "id" | "seq">) => (c.seq !== undefined ? prefixFor(c.seq) : `C${c.id}`);

/** The answer as pyramids: stored for v2 cards, converted from paragraphs for v1 cards. */
export function cardAnswer(c: Card): Answer | undefined {
  if (c.answer) return c.answer;
  const text = c.assistant?.content || c.blocks.join("\n\n");
  return text.trim() ? textAnswer(text, cardPrefix(c)) : undefined;
}

export { settingsFor };

/** The model of a role (kept for older call sites; every role is a task now). */
export function roleModel(role: "answer" | "tags" | "rerank" | "embed"): string | undefined {
  return taskModel(role === "tags" ? "summary" : role) || undefined;
}

export interface AskOptions {
  sessionId?: string;
  parentId: string | null;
  question: string;
  anchor?: Anchor;
  model: string;
  settings: ModelSettings;
  /** answer with the LLM Council (model is then the chairman) */
  council?: boolean;
}

/** Create the card (and the session, for a first question) and start streaming. Returns immediately. */
export async function ask(o: AskOptions): Promise<{ cardId: string; sessionId: string }> {
  const now = Date.now();
  const cardId = uid();
  let sessionId = o.sessionId;
  if (!sessionId) {
    sessionId = uid();
    const session: Session = {
      id: sessionId,
      title: o.question.slice(0, 80),
      rootCardId: cardId,
      lastCardId: cardId,
      systemPrompt: sessionPrompt(settingsStore.get().systemPrompt, settingsStore.get().answerFormat),
      answerModel: o.model,
      createdAt: now,
      updatedAt: now,
    };
    await db.sessions.put(session);
  } else {
    await db.sessions.update(sessionId, { lastCardId: cardId, updatedAt: now });
  }
  const session = await db.sessions.get(sessionId);
  const siblings = await db.cards.where("sessionId").equals(sessionId).toArray();
  const seq = session && usesPyramids(session.systemPrompt) ? siblings.reduce((m, c) => Math.max(m, c.seq ?? 0), 0) + 1 : undefined;
  const card: Card = {
    id: cardId,
    sessionId,
    seq,
    parentId: o.parentId,
    anchor: o.anchor,
    question: o.question,
    blocks: [],
    model: o.model,
    modelSettings: o.settings,
    mode: o.council ? "council" : undefined,
    status: "streaming",
    createdAt: now,
  };
  await db.cards.put(card);
  void run(cardId);
  return { cardId, sessionId };
}

/** (Re)run the answer for an existing card. */
export async function run(cardId: string, opts: { noSchema?: boolean } = {}): Promise<void> {
  const card = await db.cards.get(cardId);
  if (!card) return;
  if (card.mode === "council") return (await import("./council")).runCouncil(cardId);
  const session = await db.sessions.get(card.sessionId);
  if (!session) return;
  const fail = async (message: string, status: Card["status"] = "error") => {
    await db.cards.update(cardId, { status, error: message });
    clearStream(cardId);
  };
  if (!apiKey()) return fail("Connect OpenRouter in Settings to ask questions.");

  const model = modelInfo(card.model);
  const settings = card.modelSettings ?? settingsFor(card.model);
  const all = await db.cards.where("sessionId").equals(card.sessionId).toArray();
  const idx = indexCards(all.filter((c) => c.id !== cardId));
  const parentPath = card.parentId ? pathToRoot(idx, card.parentId) : [];

  // effort: stay at the root's baseline and send changes as stored mid-conversation updates where supported
  const blocked = settingsStore.get().blockedConfigUpdate;
  const resolved = resolveReasoning(settings, model);
  const nextEffort = resolved.kind.kind === "effort" ? resolved.kind.effort : undefined;
  const canUpdate = canUseConfigUpdate(card.model, blocked) && settings.reasoning.mode !== "pro";
  const plan = planEffort({ canUpdate, parentPath, next: nextEffort, kind: resolved.kind.kind });
  let effective = settings;
  let configUpdate = card.configUpdate;
  if (plan.mode === "update") {
    configUpdate = plan.update;
    effective = { ...settings, reasoning: { ...settings.reasoning, effort: plan.baseline, budget: undefined } };
  } else {
    configUpdate = undefined;
  }
  await db.cards.update(cardId, { configUpdate, effortUsed: nextEffort, status: "streaming", error: undefined });

  const messages: ChatMessage[] = buildMessages(
    idx,
    card.parentId,
    card.question,
    card.anchor,
    { systemPrompt: session.systemPrompt, model: card.model, includeConfigUpdates: canUpdate, newConfigUpdate: configUpdate },
    card.seq,
  );
  const pyramidMode = usesPyramids(session.systemPrompt) && card.seq !== undefined;
  const body: Record<string, unknown> = {
    model: card.model,
    messages: prepareMessages(card.model, messages),
    ...buildRequestParams(effective, model),
  };
  if (pyramidMode && !opts.noSchema && model.supported_parameters?.includes("structured_outputs")) {
    body.response_format = { type: "json_schema", json_schema: { name: "pyramid_answer", strict: true, schema: ANSWER_SCHEMA } };
  }

  streamStore.set((s) => ({ ...s, [cardId]: { content: "", reasoning: "" } }));
  try {
    const st = await streamChat({
      apiKey: apiKey(),
      body,
      onUpdate: (s) => streamStore.set((all) => ({ ...all, [cardId]: { content: s.content, reasoning: s.reasoning } })),
    });
    const exhausted = reasoningExhausted(st.usage, st.finishReason);
    const status: Card["status"] =
      st.finishReason === "content_filter" ? "refused" : st.finishReason === "length" ? "length" : st.error ? "error" : "done";
    const known = new Set(all.flatMap((c) => c.answer?.nodes.map((n) => n.id) ?? []));
    // full-text topics keep the answer exactly as written; only pyramid topics are parsed
    const parsed = usesPyramids(session.systemPrompt) && st.content.trim() ? parseAnswer(st.content, cardPrefix(card)) : undefined;
    const answer = parsed ? pruneCrossLinks(parsed, known) : undefined;
    await db.cards.update(cardId, {
      status,
      error: exhausted
        ? "Ran out of room while thinking"
        : st.error ?? (status === "length" ? "The answer was cut off at the token limit." : undefined),
      answer,
      tag: answerTitle(answer)?.slice(0, 32),
      blocks: answer ? answer.nodes.map((n) => n.text) : splitBlocks(st.content),
      assistant: {
        content: st.content,
        reasoning: st.reasoning || undefined,
        reasoning_details: st.reasoningDetails.length ? st.reasoningDetails : undefined,
      },
      usage: st.usage
        ? { prompt: st.usage.prompt, completion: st.usage.completion, reasoning: st.usage.reasoning, cost: st.usage.cost }
        : undefined,
    });
    clearStream(cardId);
    if (st.content) void afterAnswer(cardId);
  } catch (e) {
    // a model that rejects mid-conversation updates: remember it and retry once without them
    if (e instanceof OpenRouterError && e.status === 400 && body.response_format && /response_format|schema|structured/i.test(e.message)) {
      clearStream(cardId);
      return run(cardId, { ...opts, noSchema: true });
    }
    if (e instanceof OpenRouterError && e.status === 400 && configUpdate && /configuration_update|effort/i.test(e.message)) {
      updateSettings((s) => ({ blockedConfigUpdate: [...s.blockedConfigUpdate, card.model] }));
      clearStream(cardId);
      return run(cardId);
    }
    await fail(e instanceof Error ? e.message : String(e));
  }
}

function clearStream(id: string) {
  streamStore.set((s) => {
    const { [id]: _drop, ...rest } = s;
    return rest;
  });
}

/** Background work after an answer: embeddings for search. Failures are silent: it's optional.
 * (The breadcrumb tag is the conclusion's title; no extra AI call is made for it.) */
async function afterAnswer(cardId: string) {
  await embedCards([cardId]).catch(() => {});
}

const cardTexts = (c: Card) => [c.anchor?.text ?? c.question, ...c.blocks];

/** Embed header + blocks of the given cards (blockIdx -1 is the header). */
export async function embedCards(cardIds: string[]) {
  const model = roleModel("embed");
  if (!model || !apiKey() || !cardIds.length) return;
  const cards = (await db.cards.bulkGet(cardIds)).filter((c): c is Card => !!c && c.status !== "streaming");
  const items = cards.flatMap((c) => cardTexts(c).map((text, i) => ({ cardId: c.id, blockIdx: i - 1, text })));
  for (let i = 0; i < items.length; i += 64) {
    const chunk = items.slice(i, i + 64);
    const vecs = await embed(apiKey(), model, chunk.map((x) => x.text.slice(0, 2000)));
    await db.vectors.bulkPut(chunk.map((x, k) => ({ cardId: x.cardId, blockIdx: x.blockIdx, model, vector: quantize(vecs[k]) })));
  }
}

export interface SearchResult {
  cardId: string;
  blockIdx: number;
  text: string;
  why?: string;
}
export interface SearchOutcome {
  results: SearchResult[];
  mode: "rerank" | "embedding" | "keyword";
  note?: string;
}

/** Concept search: embeddings pick candidates, an LLM reranks them; plain keyword matching is the offline fallback. */
export async function searchConcepts(query: string): Promise<SearchOutcome> {
  const cards = (await db.cards.toArray()).filter((c) => c.status !== "streaming" && (c.blocks.length || c.question));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const toResults = (hits: { cardId: string; blockIdx: number }[], why?: Map<string, string>): SearchResult[] =>
    hits.flatMap((h) => {
      const c = byId.get(h.cardId);
      return c ? [{ cardId: h.cardId, blockIdx: h.blockIdx, text: hitText(c, h.blockIdx), why: why?.get(h.cardId) }] : [];
    });
  const keyword = (note?: string): SearchOutcome => ({ results: toResults(keywordSearch(cards, query)), mode: "keyword", note });

  const embedModel = roleModel("embed");
  if (!apiKey() || !embedModel) return keyword("Offline or no embedding model: matching words only.");
  try {
    // embed any cards that have no vectors yet
    const rows = (await db.vectors.toArray()).filter((v) => v.model === embedModel);
    const done = new Set(rows.map((r) => r.cardId));
    const missing = cards.filter((c) => !done.has(c.id)).map((c) => c.id).slice(0, 40);
    if (missing.length) await embedCards(missing);
    const all = missing.length ? (await db.vectors.toArray()).filter((v) => v.model === embedModel) : rows;
    const [qv] = await embed(apiKey(), embedModel, [query]);
    const hits = topCards(qv, all, 20);
    if (!hits.length) return keyword();

    const rr = taskSetup("rerank");
    if (rr.model && hits.length > 1) {
      try {
        const cands = hits.flatMap((h) => {
          const c = byId.get(h.cardId);
          return c ? [{ id: c.id, tag: c.tag ?? "", text: hitText(c, h.blockIdx).slice(0, 240) }] : [];
        });
        const { data } = await completeJSON<{ results: { id: string; why?: string }[] }>({
          apiKey: apiKey(),
          model: rr.info,
          messages: [{ role: "user", content: rerankPrompt(query, cands, rr.prompt) }],
          schemaName: "rerank",
          schema: {
            type: "object", additionalProperties: false, required: ["results"],
            properties: { results: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "why"], properties: { id: { type: "string" }, why: { type: "string" } } } } },
          },
          extra: rr.params,
        });
        const why = new Map(data.results.map((r) => [r.id, r.why ?? ""]));
        const order = data.results.map((r) => hits.find((h) => h.cardId === r.id)).filter((h): h is NonNullable<typeof h> => !!h);
        if (order.length) return { results: toResults(order, why), mode: "rerank" };
      } catch {
        /* fall through to embedding order */
      }
    }
    return { results: toResults(hits.slice(0, 8)), mode: "embedding" };
  } catch (e) {
    return keyword(`Search service unavailable (${e instanceof Error ? e.message : "error"}): matching words only.`);
  }
}

/** Summarize a branch and continue it as a fresh linked root card. */
export async function startFreshBranch(fromCardId: string): Promise<string> {
  const from = await db.cards.get(fromCardId);
  if (!from) throw new Error("Card not found");
  const all = await db.cards.where("sessionId").equals(from.sessionId).toArray();
  const path = pathToRoot(indexCards(all), fromCardId);
  const transcript = path
    .map((c) => `Q: ${c.anchor ? `(on “${c.anchor.text}”) ` : ""}${c.question}\nA: ${c.assistant?.content ?? ""}`)
    .join("\n\n");
  const t = taskSetup("summary");
  if (!t.model || !apiKey()) throw new Error("Connect OpenRouter first.");
  const summary = await completeText({
    apiKey: apiKey(),
    model: t.info,
    messages: [{ role: "system", content: t.prompt }, { role: "user", content: transcript }],
    extra: t.params,
  });
  if (!summary.trim()) throw new Error("Could not summarize this branch.");
  const fresh = makeFreshCard(from, summary.trim(), uid(), Date.now());
  fresh.tag = "Fresh start";
  const session = await db.sessions.get(from.sessionId);
  if (session && usesPyramids(session.systemPrompt)) {
    fresh.seq = all.reduce((m, c) => Math.max(m, c.seq ?? 0), 0) + 1;
  }
  if (fresh.seq !== undefined) {
    fresh.answer = textAnswer(summary.trim(), cardPrefix(fresh));
    fresh.blocks = fresh.answer.nodes.map((n) => n.text);
  }
  await db.cards.put(fresh);
  await db.sessions.update(from.sessionId, { lastCardId: fresh.id, updatedAt: Date.now() });
  void embedCards([fresh.id]).catch(() => {});
  return fresh.id;
}

/** Retry a card, optionally with a bigger token limit or lower reasoning (for "ran out of room while thinking"). */
export async function retry(cardId: string, how: "same" | "more" | "lower" = "same") {
  const card = await db.cards.get(cardId);
  if (!card) return;
  const model = modelInfo(card.model);
  const settings: ModelSettings = JSON.parse(JSON.stringify(card.modelSettings ?? settingsFor(card.model)));
  if (how === "more") {
    settings.max_tokens = Math.min((settings.max_tokens ?? DEFAULT_MAX_TOKENS) * 2, 128000);
  } else if (how === "lower") {
    const ctl = settingsControls(model);
    if (settings.reasoning.budget !== undefined) {
      settings.reasoning.budget = Math.max(1024, Math.floor(settings.reasoning.budget / 2));
    } else if (ctl.reasoning.efforts.length) {
      const cur = settings.reasoning.effort ?? ctl.reasoning.defaultEffort ?? ctl.reasoning.efforts[0];
      const i = ctl.reasoning.efforts.indexOf(cur);
      settings.reasoning.effort = ctl.reasoning.efforts[Math.min(i + 1, ctl.reasoning.efforts.length - 1)];
    }
  }
  await db.cards.update(cardId, { modelSettings: settings, status: "streaming", error: undefined });
  void run(cardId);
}

/** Delete a card with all branches below it (and its search vectors). Returns the card to show next. */
export async function deleteBranch(cardId: string): Promise<{ sessionId: string; next: string | null }> {
  const card = await db.cards.get(cardId);
  if (!card) throw new Error("Card not found");
  const all = await db.cards.where("sessionId").equals(card.sessionId).toArray();
  const doomed = new Set([cardId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of all) if (c.parentId && doomed.has(c.parentId) && !doomed.has(c.id)) (doomed.add(c.id), (grew = true));
  }
  const ids = [...doomed];
  await db.cards.bulkDelete(ids);
  await db.vectors.where("cardId").anyOf(ids).delete();
  await db.highlights.where("cardId").anyOf(ids).delete();
  const left = all.filter((c) => !doomed.has(c.id));
  if (!left.length) {
    await db.outlines.where("sessionId").equals(card.sessionId).delete();
    await db.sessions.delete(card.sessionId);
    return { sessionId: card.sessionId, next: null };
  }
  const next = card.parentId && !doomed.has(card.parentId) ? card.parentId : left[0].id;
  await db.sessions.update(card.sessionId, { lastCardId: next });
  return { sessionId: card.sessionId, next };
}

/** Cards left mid-stream when the app closed can't resume: mark them so they can be retried. */
export async function recoverInterrupted() {
  const stuck = (await db.cards.toArray()).filter((c) => c.status === "streaming");
  for (const c of stuck) await db.cards.update(c.id, { status: "error", error: "Interrupted: the app was closed while answering." });
}
