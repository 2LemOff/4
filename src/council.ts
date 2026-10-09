import { db } from "./db";
import { modelInfo, settingsStore, streamStore, modelsStore } from "./store";
import { completeJSON, completeText, prepareMessages, streamChat } from "./openrouter";
import { buildMessages, indexCards, type ChatMessage } from "./tree";
import { buildRequestParams, settingsControls } from "./modelRules";
import { cardPrefix, embedCards, roleModel, settingsFor } from "./ai";
import { ANSWER_SCHEMA, answerTitle, outlineText, parseAnswer, pruneCrossLinks, type Answer } from "./answer";
import { aggregateRankings, applyGrounding, LABELS, labelOf, parseRanking, type Verdict } from "./councilLogic";
import { councilDefaults, newestOf } from "./models";
import { CHAIRMAN_RULES, reviewPrompt, VERIFIER_PROMPT } from "./prompts";
import type { Card, CouncilData, CouncilMember, ModelSettings } from "./types";

export function councilMembers(): string[] {
  const s = settingsStore.get().council;
  return s.members.length ? s.members : councilDefaults(modelsStore.get().models);
}
export function councilChairman(): string {
  return settingsStore.get().council.chairman || roleModel("answer") || "";
}
function verifierModel(): string {
  return settingsStore.get().council.verifier || newestOf(modelsStore.get().models, "gemini-flash")?.id || roleModel("tags") || councilChairman();
}

/** Chairman reasons whenever the model allows it. */
function withReasoning(s: ModelSettings, modelId: string): ModelSettings {
  const ctl = settingsControls(modelInfo(modelId));
  if (!ctl.reasoning.available || s.reasoning.enabled === false && !ctl.reasoning.canDisable) return s;
  return { ...s, reasoning: { ...s.reasoning, enabled: true, exclude: false } };
}

const COUNCIL_SCHEMA = (() => {
  const s = JSON.parse(JSON.stringify(ANSWER_SCHEMA));
  s.properties.nodes.items.properties.sources = { type: "array", items: { type: "string" } };
  s.properties.nodes.items.required.push("sources");
  return s;
})();

async function save(cardId: string, council: CouncilData, extra: Partial<Card> = {}) {
  await db.cards.update(cardId, { council, ...extra });
}

/**
 * Karpathy-style council, continuing the conversation:
 * 1. every member answers with the branch history, 2. members rank the anonymized answers,
 * 3. the chairman reasons and writes the final pyramid from the council's text only,
 * 4. a verifier checks every chairman point against the council's answers.
 */
export async function runCouncil(cardId: string): Promise<void> {
  const card = await db.cards.get(cardId);
  if (!card) return;
  const session = await db.sessions.get(card.sessionId);
  if (!session) return;
  const apiKey = settingsStore.get().apiKey;
  const cfg = settingsStore.get().council;
  const chairman = card.model;
  const members = councilMembers();
  const all = await db.cards.where("sessionId").equals(card.sessionId).toArray();
  const idx = indexCards(all.filter((c) => c.id !== cardId));
  const prefix = cardPrefix(card);
  const known = new Set(all.flatMap((c) => c.answer?.nodes.map((n) => n.id) ?? []));

  const council: CouncilData = {
    stage: "members",
    chairman,
    members: members.map((m, i) => ({ label: LABELS[i], model: m, status: "running", content: "" })),
    reviews: [],
    aggregate: [],
  };
  await save(cardId, council, { status: "streaming", error: undefined });
  if (!apiKey) {
    await save(cardId, { ...council, stage: "error" }, { status: "error", error: "Connect OpenRouter in Settings first." });
    return;
  }
  if (members.length < 2) {
    await save(cardId, { ...council, stage: "error" }, { status: "error", error: "Choose at least two council members in Settings › Council." });
    return;
  }

  const historyFor = (model: string): ChatMessage[] =>
    buildMessages(idx, card.parentId, card.question, card.anchor, { systemPrompt: session.systemPrompt, model, includeConfigUpdates: false }, card.seq);
  const wantsSchema = (model: string) => modelInfo(model).supported_parameters?.includes("structured_outputs");

  // 1. members answer in parallel
  await Promise.all(
    council.members.map(async (m: CouncilMember) => {
      try {
        const body: Record<string, unknown> = {
          model: m.model,
          messages: prepareMessages(m.model, historyFor(m.model)),
          ...buildRequestParams(settingsFor(m.model), modelInfo(m.model)),
        };
        if (wantsSchema(m.model)) body.response_format = { type: "json_schema", json_schema: { name: "pyramid_answer", strict: true, schema: ANSWER_SCHEMA } };
        const st = await streamChat({ apiKey, body, onUpdate: () => {} });
        m.content = st.content;
        m.answer = parseAnswer(st.content, `${prefix}${m.label}`);
        m.usage = st.usage ? { prompt: st.usage.prompt, completion: st.usage.completion, reasoning: st.usage.reasoning, cost: st.usage.cost } : undefined;
        m.status = st.content.trim() ? "done" : "error";
        if (!st.content.trim()) m.error = st.error ?? "Empty answer";
      } catch (e) {
        m.status = "error";
        m.error = e instanceof Error ? e.message : String(e);
      }
      await save(cardId, { ...council });
    }),
  );
  const answered = council.members.filter((m) => m.status === "done");
  if (!answered.length) {
    await save(cardId, { ...council, stage: "error" }, { status: "error", error: "Every council member failed." });
    return;
  }
  const responses = answered.map((m) => `Response ${m.label}:\n${m.answer ? outlineText(m.answer) : m.content}`).join("\n\n");
  const labelToModel = Object.fromEntries(answered.map((m) => [m.label, m.model]));

  // 2. peer review of the anonymized answers
  if (cfg.peerReview && answered.length > 1) {
    council.stage = "reviews";
    await save(cardId, { ...council });
    const question = card.anchor ? `${card.anchor.text}\n\n${card.question}` : card.question;
    council.reviews = await Promise.all(
      answered.map(async (m) => {
        const model = modelInfo(m.model);
        const prompt = reviewPrompt(question, responses);
        try {
          const { data } = await completeJSON<{ evaluation: string; ranking: string[] }>({
            apiKey,
            model,
            messages: [{ role: "user", content: prompt }],
            schemaName: "council_review",
            schema: {
              type: "object", additionalProperties: false, required: ["evaluation", "ranking"],
              properties: { evaluation: { type: "string" }, ranking: { type: "array", items: { type: "string" } } },
            },
            extra: buildRequestParams({ ...settingsFor(m.model), max_tokens: 8000 }, model),
          });
          return { model: m.model, label: m.label, evaluation: String(data.evaluation ?? ""), ranking: (data.ranking ?? []).map(labelOf) };
        } catch {
          try {
            const text = await completeText({ apiKey, model, messages: [{ role: "user", content: prompt }], extra: { max_tokens: 8000 } });
            return { model: m.model, label: m.label, evaluation: text, ranking: parseRanking(text) };
          } catch (e) {
            return { model: m.model, label: m.label, evaluation: "", ranking: [], error: e instanceof Error ? e.message : String(e) };
          }
        }
      }),
    );
    council.aggregate = aggregateRankings(council.reviews.map((r) => r.ranking), labelToModel);
  }

  // 3. the chairman reasons and writes the final answer from the council's text only
  council.stage = "chairman";
  await save(cardId, { ...council });
  const history = historyFor(chairman);
  const lastTurn = history.pop()!;
  const reviews = council.reviews.length
    ? `\n\nPEER REVIEWS (each member ranked the anonymized responses):\n${council.reviews.map((r) => `Review by ${r.label}: ${r.evaluation}\nRanking: ${r.ranking.join(" > ")}`).join("\n\n")}`
    : "";
  const ranking = council.aggregate.length ? `\n\nAVERAGE RANKING: ${council.aggregate.map((a) => `${a.label} (${a.avgRank})`).join(", ")}` : "";
  history.push({ role: "user", content: `${CHAIRMAN_RULES}\n\nCOUNCIL RESPONSES:\n${responses}${reviews}${ranking}\n\nTHE LEARNER'S MESSAGE:\n${lastTurn.content}` });
  const chairSettings = withReasoning(card.modelSettings ?? settingsFor(chairman), chairman);
  const body: Record<string, unknown> = {
    model: chairman,
    messages: prepareMessages(chairman, history),
    ...buildRequestParams(chairSettings, modelInfo(chairman)),
  };
  if (wantsSchema(chairman)) body.response_format = { type: "json_schema", json_schema: { name: "council_answer", strict: true, schema: COUNCIL_SCHEMA } };
  streamStore.set((s) => ({ ...s, [cardId]: { content: "", reasoning: "" } }));
  let final: Answer | undefined;
  let usage: Card["usage"];
  try {
    const st = await streamChat({
      apiKey,
      body,
      onUpdate: (s) => streamStore.set((x) => ({ ...x, [cardId]: { content: s.content, reasoning: s.reasoning } })),
    });
    final = st.content.trim() ? parseAnswer(st.content, prefix) : undefined;
    council.chairmanReasoning = st.reasoning || undefined;
    usage = st.usage ? { prompt: st.usage.prompt, completion: st.usage.completion, reasoning: st.usage.reasoning, cost: st.usage.cost } : undefined;
  } catch (e) {
    clear(cardId);
    await save(cardId, { ...council, stage: "error" }, { status: "error", error: e instanceof Error ? e.message : String(e) });
    return;
  }
  if (!final) {
    clear(cardId);
    await save(cardId, { ...council, stage: "error" }, { status: "error", error: "The chairman returned an empty answer." });
    return;
  }

  // 4. grounding check
  council.stage = "checking";
  council.verifier = verifierModel();
  await save(cardId, { ...council });
  let verdicts: Verdict[] = [];
  try {
    const vm = modelInfo(council.verifier);
    const { data } = await completeJSON<{ results: Verdict[] }>({
      apiKey,
      model: vm,
      messages: [
        { role: "system", content: VERIFIER_PROMPT },
        { role: "user", content: `COUNCIL RESPONSES:\n${responses}\n\nCHAIRMAN POINTS:\n${final.nodes.map((n) => `[${n.id}] ${n.text}`).join("\n")}` },
      ],
      schemaName: "grounding",
      schema: {
        type: "object", additionalProperties: false, required: ["results"],
        properties: { results: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "supported", "quote"], properties: { id: { type: "string" }, supported: { type: "boolean" }, quote: { type: "string" } } } } },
      },
      extra: buildRequestParams({ reasoning: { effort: "low" }, max_tokens: 6000 }, vm),
    });
    verdicts = data.results ?? [];
  } catch {
    // without a verifier, the sources check below still applies
  }
  const { answer, unsupported } = applyGrounding(final, answered.map((m) => m.label), verdicts, cfg.removeUnsupported);
  council.unsupported = unsupported;
  council.removed = cfg.removeUnsupported;
  council.stage = "done";
  const cleaned = pruneCrossLinks(answer, known);
  clear(cardId);
  await save(cardId, { ...council }, {
    status: "done",
    answer: cleaned,
    blocks: cleaned.nodes.map((n) => n.text),
    tag: answerTitle(cleaned)?.slice(0, 32),
    // replayed later as the plain question + this checked JSON, with no reasoning fields
    assistant: { content: JSON.stringify({ groups: cleaned.groups, nodes: cleaned.nodes.map(({ grounded: _g, ...n }) => n) }) },
    usage: sumUsage([...answered.map((m) => m.usage), usage]),
  });
  void embedCards([cardId]).catch(() => {});
}

function sumUsage(us: (Card["usage"] | undefined)[]): Card["usage"] {
  const list = us.filter((u): u is NonNullable<typeof u> => !!u);
  if (!list.length) return undefined;
  const last = list[list.length - 1];
  return {
    prompt: last.prompt,
    completion: last.completion,
    reasoning: list.reduce((n, u) => n + u.reasoning, 0),
    cost: list.some((u) => u.cost !== undefined) ? list.reduce((n, u) => n + (u.cost ?? 0), 0) : undefined,
  };
}

function clear(id: string) {
  streamStore.set((s) => {
    const { [id]: _drop, ...rest } = s;
    return rest;
  });
}
