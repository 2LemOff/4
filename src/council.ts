import { db } from "./db";
import { modelInfo, settingsStore, streamStore, modelsStore } from "./store";
import { completeJSON, completeText, prepareMessages, streamChat } from "./openrouter";
import { buildMessages, indexCards, pathToRoot, type ChatMessage } from "./tree";
import { imageOptions, type ImageOptions } from "./photos";
import { buildRequestParams, settingsControls } from "./modelRules";
import { cardPrefix, embedCards, settingsFor } from "./ai";
import { taskModel, taskSetup } from "./taskConfig";
import { lengthOf, TASK } from "./tasks";
import { ANSWER_SCHEMA, answerTitle, outlineText, parseAnswer, pruneCrossLinks, type Answer } from "./answer";
import { agreement, aggregateRankings, applyGrounding, LABELS, labelOf, leftOut, parseRanking, splitTagged, type TaggedBlock, type Verdict } from "./councilLogic";
import { councilDefaults } from "./models";
import { CHAIRMAN_PYRAMID_FORMAT, reviewPrompt, usesPyramids } from "./prompts";
import { splitBlocks } from "./blocks";
import { splitSources } from "./split";
import type { Card, CouncilData, CouncilMember, ModelSettings } from "./types";

export function councilMembers(): string[] {
  const s = settingsStore.get().council;
  return s.members.length ? s.members : councilDefaults(modelsStore.get().models);
}
export function councilChairman(): string {
  return taskModel("chairman");
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

/** A member's settings: its own (Settings › Council ⚙), else that model's saved defaults. */
export const memberSettings = (model: string): ModelSettings => settingsStore.get().council.memberSettings?.[model] ?? settingsFor(model);

/**
 * Karpathy-style council, continuing the conversation:
 * 1. every member answers with the branch history, 2. members rank the anonymized answers,
 * 3. the chairman reasons and writes the final answer from the council's text only,
 * 4. a verifier checks every chairman point against the council's answers.
 * Full-text topics get a full-text answer with the sources of every paragraph; pyramid topics a pyramid.
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
  const textMode = !(usesPyramids(session.systemPrompt) && card.seq !== undefined);

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

  // attached pictures: members that can't see them get the text read from them
  const parentPath = card.parentId ? pathToRoot(idx, card.parentId) : [];
  const pictures = new Map<string, ImageOptions>();
  for (const m of new Set([...members, chairman])) pictures.set(m, await imageOptions(m, parentPath, card));
  const historyFor = (model: string): ChatMessage[] =>
    buildMessages(idx, card.parentId, card.question, card.anchor, { systemPrompt: session.systemPrompt, model, includeConfigUpdates: false, ...pictures.get(model) }, card.seq);
  const wantsSchema = (model: string) => modelInfo(model).supported_parameters?.includes("structured_outputs");

  // 1. members answer in parallel
  await Promise.all(
    council.members.map(async (m: CouncilMember) => {
      try {
        const body: Record<string, unknown> = {
          model: m.model,
          messages: prepareMessages(m.model, historyFor(m.model)),
          ...buildRequestParams(memberSettings(m.model), modelInfo(m.model)),
        };
        if (!textMode && wantsSchema(m.model)) body.response_format = { type: "json_schema", json_schema: { name: "pyramid_answer", strict: true, schema: ANSWER_SCHEMA } };
        const st = await streamChat({ apiKey, body, onUpdate: () => {} });
        m.content = st.content;
        m.answer = textMode ? undefined : parseAnswer(st.content, `${prefix}${m.label}`);
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
        const prompt = reviewPrompt(question, responses, taskSetup("review").prompt);
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
            extra: buildRequestParams({ ...memberSettings(m.model), max_tokens: lengthOf(TASK.review, settingsStore.get().tasks.review)?.maxTokens ?? 8000 }, model),
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
  const rules = textMode ? taskSetup("chairman").prompt : `${taskSetup("chairman").prompt.replace(TASK.chairman.fixed ?? "", "").trim()}\n\n${CHAIRMAN_PYRAMID_FORMAT}`;
  history.push({ role: "user", content: `${rules}\n\nCOUNCIL RESPONSES:\n${responses}${reviews}${ranking}\n\nTHE LEARNER'S MESSAGE:\n${lastTurn.content}`, ...(lastTurn.images ? { images: lastTurn.images } : {}) });
  const chairSettings = withReasoning(card.modelSettings ?? settingsFor(chairman), chairman);
  const body: Record<string, unknown> = {
    model: chairman,
    messages: prepareMessages(chairman, history),
    ...buildRequestParams(chairSettings, modelInfo(chairman)),
  };
  if (!textMode && wantsSchema(chairman)) body.response_format = { type: "json_schema", json_schema: { name: "council_answer", strict: true, schema: COUNCIL_SCHEMA } };
  streamStore.set((s) => ({ ...s, [cardId]: { content: "", reasoning: "" } }));
  let final: Answer | undefined;
  let finalText = "";
  let usage: Card["usage"];
  try {
    const st = await streamChat({
      apiKey,
      body,
      onUpdate: (s) => streamStore.set((x) => ({ ...x, [cardId]: { content: s.content, reasoning: s.reasoning } })),
    });
    finalText = st.content.trim();
    final = !textMode && finalText ? parseAnswer(st.content, prefix) : undefined;
    council.chairmanReasoning = st.reasoning || undefined;
    usage = st.usage ? { prompt: st.usage.prompt, completion: st.usage.completion, reasoning: st.usage.reasoning, cost: st.usage.cost } : undefined;
  } catch (e) {
    clear(cardId);
    await save(cardId, { ...council, stage: "error" }, { status: "error", error: e instanceof Error ? e.message : String(e) });
    return;
  }
  if (textMode ? !finalText : !final) {
    clear(cardId);
    await save(cardId, { ...council, stage: "error" }, { status: "error", error: "The chairman returned an empty answer." });
    return;
  }
  council.agreement = agreement(answered.map((m) => m.content));
  if (textMode) return finishText(cardId, council, finalText, answered, responses, usage);
  final = final!;

  // 4. grounding check
  council.stage = "checking";
  const vt = taskSetup("verifier");
  council.verifier = vt.model;
  await save(cardId, { ...council });
  let verdicts: Verdict[] = [];
  try {
    const { data } = await completeJSON<{ results: Verdict[] }>({
      apiKey,
      model: vt.info,
      messages: [
        { role: "system", content: vt.prompt },
        { role: "user", content: `COUNCIL RESPONSES:\n${responses}\n\nCHAIRMAN POINTS:\n${final.nodes.map((n) => `[${n.id}] ${n.text}`).join("\n")}` },
      ],
      schemaName: "grounding",
      schema: {
        type: "object", additionalProperties: false, required: ["results"],
        properties: { results: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "supported", "quote"], properties: { id: { type: "string" }, supported: { type: "boolean" }, quote: { type: "string" } } } } },
      },
      extra: vt.params,
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

/**
 * Full-text council: the chairman's paragraphs keep the answers they came from; the verifier checks each one.
 * Paragraphs it can't find in the members' answers are folded (never deleted) and left out of the replay.
 */
async function finishText(cardId: string, council: CouncilData, text: string, answered: CouncilMember[], responses: string, usage: Card["usage"]) {
  const apiKey = settingsStore.get().apiKey;
  const { blocks } = splitTagged(text);
  const labels = new Set(answered.map((m) => m.label));
  for (const b of blocks) b.sources = b.sources.filter((l) => labels.has(l));
  const isHeading = (b: TaggedBlock) => /^#{1,6}\s/.test(b.text);
  const checked = blocks.map((b, i) => ({ b, id: `p${i + 1}` })).filter(({ b }) => !isHeading(b));

  council.stage = "checking";
  const vt = taskSetup("verifier");
  council.verifier = vt.model;
  await save(cardId, { ...council });
  let verdicts: Verdict[] = [];
  try {
    const { data } = await completeJSON<{ results: Verdict[] }>({
      apiKey,
      model: vt.info,
      messages: [
        { role: "system", content: vt.prompt },
        { role: "user", content: `COUNCIL RESPONSES:\n${responses}\n\nCHAIRMAN POINTS:\n${checked.map(({ b, id }) => `[${id}] ${b.text}`).join("\n")}` },
      ],
      schemaName: "grounding",
      schema: {
        type: "object", additionalProperties: false, required: ["results"],
        properties: { results: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "supported", "quote"], properties: { id: { type: "string" }, supported: { type: "boolean" }, quote: { type: "string" } } } } },
      },
      extra: vt.params,
    });
    verdicts = data.results ?? [];
  } catch {
    // without a verifier, only paragraphs with no sources are folded
  }
  const verdict = new Map(verdicts.map((v) => [v.id, v.supported]));
  const bad = new Set(checked.filter(({ b, id }) => verdict.get(id) === false || (!b.sources.length && verdict.get(id) !== true)).map(({ id }) => id));
  let kept = blocks.filter((_, i) => !bad.has(`p${i + 1}`));
  let folded = blocks.filter((_, i) => bad.has(`p${i + 1}`));
  // never leave the answer empty: if nothing could be confirmed, show it all, flagged
  if (!kept.some((b) => !isHeading(b))) {
    kept = blocks;
    folded = [];
  }
  council.textSources = kept;
  council.unverified = folded;
  council.unsupported = folded.map((b) => b.text);
  council.removed = false;
  council.leftOut = leftOut(answered.map((m) => ({ label: m.label, sentences: splitSources([{ key: m.label, text: m.content }]).filter((x) => !x.heading).map((x) => x.text) })), blocks.map((b) => b.text).join("\n"));
  council.stage = "done";
  const content = kept.map((b) => b.text).join("\n\n");
  clear(cardId);
  await save(cardId, { ...council }, {
    status: "done",
    answer: undefined,
    blocks: splitBlocks(content),
    // replayed later as the plain question + the kept text (no source tags, no reasoning)
    assistant: { content },
    usage: sumUsage([...answered.map((m) => m.usage), usage]),
  });
  void embedCards([cardId]).catch(() => {});
}
