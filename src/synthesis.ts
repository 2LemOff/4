import { db, uid } from "./db";
import { modelInfo, settingsStore } from "./store";
import { completeJSON } from "./openrouter";
import { buildRequestParams } from "./modelRules";
import { composeSynthesisPrompt, OUTLINE_SCHEMA, serializeTree } from "./prompts";
import { settingsFor } from "./ai";
import type { Card, Outline, OutlineSection, SynthesisSettings } from "./types";

/** Start a background synthesis of a whole session. Returns the outline id immediately. */
export async function synthesize(sessionId: string, override?: Partial<SynthesisSettings>): Promise<string> {
  const base = settingsStore.get().synthesis;
  const settings: SynthesisSettings = { ...base, ...override, options: { ...base.options, ...override?.options } };
  const previous = await db.outlines.where("sessionId").equals(sessionId).toArray();
  const outline: Outline = {
    id: uid(),
    sessionId,
    version: previous.reduce((n, o) => Math.max(n, o.version), 0) + 1,
    title: "",
    category: "",
    summary: "",
    sections: [],
    synthesisSettings: settings,
    status: "pending",
    createdAt: Date.now(),
  };
  await db.outlines.put(outline);
  void runOutline(outline.id);
  return outline.id;
}

const running = new Set<string>();

/** Validate and tidy the model's JSON; unknown card ids are dropped so links never dangle. */
export function normalizeOutline(raw: unknown, validIds: Set<string>): Pick<Outline, "title" | "category" | "summary" | "sections"> {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(r.sections)) throw new Error("The synthesis had no sections.");
  const sections: OutlineSection[] = r.sections.map((s: any) => ({
    heading: String(s?.heading ?? "").trim() || "Untitled",
    points: (Array.isArray(s?.points) ? s.points : [])
      .map((p: any) => ({
        text: String(p?.text ?? "").trim(),
        cardIds: (Array.isArray(p?.cardIds) ? p.cardIds : []).map(String).filter((id: string) => validIds.has(id)),
      }))
      .filter((p: { text: string }) => p.text),
  }));
  return {
    title: String(r.title ?? "").trim() || "Untitled outline",
    category: String(r.category ?? "").trim() || "General",
    summary: String(r.summary ?? "").trim(),
    sections,
  };
}

export async function runOutline(outlineId: string): Promise<void> {
  if (running.has(outlineId)) return;
  running.add(outlineId);
  try {
    const outline = await db.outlines.get(outlineId);
    if (!outline) return;
    await db.outlines.update(outlineId, { status: "running", error: undefined });
    const session = await db.sessions.get(outline.sessionId);
    if (!session) throw new Error("Session not found.");
    const cards: Card[] = (await db.cards.where("sessionId").equals(session.id).toArray())
      .filter((c) => c.assistant?.content)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (!cards.length) throw new Error("There is nothing to synthesize yet.");
    const apiKey = settingsStore.get().apiKey;
    if (!apiKey) throw new Error("Connect OpenRouter in Settings first.");

    const s = outline.synthesisSettings;
    const modelId = s.model || session.answerModel;
    const model = modelInfo(modelId);
    const categories = [...new Set((await db.outlines.toArray()).filter((o) => o.status === "done" && o.category).map((o) => o.category))];
    const tree = serializeTree(cards.map((c) => ({ id: c.id, parentId: c.parentId, question: c.question, anchor: c.anchor, assistantText: c.assistant?.content })));
    const params = buildRequestParams(s.modelSettings ?? settingsFor(modelId), model);
    params.max_tokens = Math.max(Number(params.max_tokens ?? 0), 16000);

    const { data } = await completeJSON<unknown>({
      apiKey,
      model,
      messages: [
        { role: "system", content: composeSynthesisPrompt(s, categories) },
        { role: "user", content: tree },
      ],
      schemaName: "concept_outline",
      schema: OUTLINE_SCHEMA,
      extra: params,
    });
    const result = normalizeOutline(data, new Set(cards.map((c) => c.id)));
    await db.outlines.update(outlineId, { ...result, status: "done" });
  } catch (e) {
    await db.outlines.update(outlineId, { status: "error", error: e instanceof Error ? e.message : String(e) });
  } finally {
    running.delete(outlineId);
  }
}

/** Jobs left unfinished when the app closed run again on the next start. */
export async function resumePending(): Promise<void> {
  const open = await db.outlines.where("createdAt").above(0).filter((o) => o.status === "pending" || o.status === "running").toArray();
  for (const o of open) void runOutline(o.id);
}
