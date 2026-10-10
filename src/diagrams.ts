/**
 * Ways to see a selection. The views drawn from the arrangement need no extra call; AI diagrams are one cheap
 * strict-JSON call each, and every element cites the sentence ids it comes from, so tapping it shows the
 * exact words. Sentences no element uses are listed under the diagram ("Not in this diagram").
 */
import type { Sentence } from "./split";

export type ArrangedView = "bigidea" | "levels" | "mindmap" | "doc" | "chain" | "outline";
export type DiagramType = "concept" | "compare" | "venn" | "flow" | "cause" | "timeline" | "scale" | "chart";
export type PictureView = "sketch" | "story";
export type ViewId = ArrangedView | DiagramType | PictureView;

export const VIEW_INFO: Record<ViewId, { label: string; about: string; kind: "arranged" | "diagram" | "picture" }> = {
  bigidea: { label: "Big idea → details", about: "The main point first; zoom from big to fine.", kind: "arranged" },
  levels: { label: "Levels", about: "Where it sits, from the broad field down to this, with neighbours.", kind: "arranged" },
  mindmap: { label: "Mind map", about: "The idea in the middle, its parts around it.", kind: "arranged" },
  doc: { label: "Study doc", about: "Sections to read, with your notes and a side chat.", kind: "arranged" },
  chain: { label: "Argument chain", about: "Foundations → steps → conclusions, and what builds on what.", kind: "arranged" },
  outline: { label: "Outline", about: "An indented list of everything.", kind: "arranged" },
  concept: { label: "Concept map", about: "Ideas joined by labelled links.", kind: "diagram" },
  compare: { label: "Compare table", about: "Things side by side, point by point.", kind: "diagram" },
  venn: { label: "Venn / overlap", about: "What two ideas share and where they differ.", kind: "diagram" },
  flow: { label: "Process flow", about: "Steps in order.", kind: "diagram" },
  cause: { label: "Cause → effect", about: "What leads to what.", kind: "diagram" },
  timeline: { label: "Timeline", about: "Events in time order.", kind: "diagram" },
  scale: { label: "Scale ladder", about: "Sizes or amounts in order, like Scale of the Universe.", kind: "diagram" },
  chart: { label: "Numbers chart", about: "The numbers as bars (log scale when they differ a lot).", kind: "diagram" },
  sketch: { label: "Sketch", about: "An AI-drawn picture of it.", kind: "picture" },
  story: { label: "Story slides", about: "A short narrated story.", kind: "picture" },
};

export const ARRANGED_VIEWS: ArrangedView[] = ["bigidea", "levels", "mindmap", "doc", "chain", "outline"];
export const DIAGRAMS: DiagramType[] = ["concept", "compare", "venn", "flow", "cause", "timeline", "scale", "chart"];

const NUMBER_UNIT = /\b\d[\d,.]*\s?(%|nm|µm|mm|cm|m|km|kg|g|mg|s|ms|min|h|years?|days?|km\/s|m\/s|°C|°F|K|light[- ]years?|AU|million|billion|trillion|thousand|×)(?![a-z])/i;
const DATE = /\b(1[0-9]{3}|20[0-9]{2})s?\b|\bcentur(y|ies)\b|\b\d+\s?(BC|BCE|AD|CE)\b/i;
const STEPS = /\b(first|then|next|after that|finally|step \d)\b/i;
const CAUSE = /\b(because|causes?|caused by|leads? to|results? in|therefore|so that|due to)\b/i;

/** Views that fit this text best come first; the rest follow in the usual order. */
export function suggestViews(sentences: Sentence[], opts: { highlights?: number } = {}): ViewId[] {
  const text = sentences.map((s) => s.text).join(" ");
  const first: ViewId[] = [];
  const numbers = sentences.filter((s) => NUMBER_UNIT.test(s.text)).length;
  if (numbers >= 2) first.push("scale", "chart");
  if (sentences.filter((s) => DATE.test(s.text)).length >= 2) first.push("timeline");
  if ((opts.highlights ?? 0) >= 2) first.push("compare", "venn");
  if (STEPS.test(text)) first.push("flow");
  if (CAUSE.test(text)) first.push("cause");
  const rest: ViewId[] = ["bigidea", "levels", "mindmap", "doc", "concept", "chain", "outline", "compare", "venn", "flow", "cause", "timeline", "scale", "chart", "sketch", "story"];
  return [...new Set([...first, ...rest])];
}

// ── Diagram specs ────────────────────────────────────────────────────────────

export interface Sourced {
  sources: string[];
}
export interface ConceptSpec { nodes: ({ id: string; label: string } & Sourced)[]; edges: ({ from: string; to: string; label: string } & Sourced)[] }
export interface CompareSpec { columns: ({ id: string; title: string } & Sourced)[]; rows: { label: string; cells: ({ column: string; text: string } & Sourced)[] }[] }
export interface VennSpec { a: { title: string; items: ({ text: string } & Sourced)[] }; b: { title: string; items: ({ text: string } & Sourced)[] }; both: ({ text: string } & Sourced)[] }
export interface FlowSpec { steps: ({ label: string; detail: string } & Sourced)[] }
export interface CauseSpec { links: ({ cause: string; effect: string } & Sourced)[] }
export interface TimelineSpec { events: ({ when: string; label: string } & Sourced)[] }
export interface ScaleSpec { items: ({ label: string; value: number; unit: string } & Sourced)[] }
export type ChartSpec = ScaleSpec;

export interface DiagramSpecs {
  concept: ConceptSpec;
  compare: CompareSpec;
  venn: VennSpec;
  flow: FlowSpec;
  cause: CauseSpec;
  timeline: TimelineSpec;
  scale: ScaleSpec;
  chart: ChartSpec;
}
export type AnyDiagram = DiagramSpecs[DiagramType];

const SRC = { type: "array", items: { type: "string" } } as const;
const obj = (props: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
const arr = (items: unknown) => ({ type: "array", items });
const S = { type: "string" } as const;
const N = { type: "number" } as const;

export const DIAGRAM_SCHEMAS: Record<DiagramType, object> = {
  concept: obj({ nodes: arr(obj({ id: S, label: S, sources: SRC })), edges: arr(obj({ from: S, to: S, label: S, sources: SRC })) }),
  compare: obj({ columns: arr(obj({ id: S, title: S, sources: SRC })), rows: arr(obj({ label: S, cells: arr(obj({ column: S, text: S, sources: SRC })) })) }),
  venn: obj({ a: obj({ title: S, items: arr(obj({ text: S, sources: SRC })) }), b: obj({ title: S, items: arr(obj({ text: S, sources: SRC })) }), both: arr(obj({ text: S, sources: SRC })) }),
  flow: obj({ steps: arr(obj({ label: S, detail: S, sources: SRC })) }),
  cause: obj({ links: arr(obj({ cause: S, effect: S, sources: SRC })) }),
  timeline: obj({ events: arr(obj({ when: S, label: S, sources: SRC })) }),
  scale: obj({ items: arr(obj({ label: S, value: N, unit: S, sources: SRC })) }),
  chart: obj({ items: arr(obj({ label: S, value: N, unit: S, sources: SRC })) }),
};

/** The shape asked for, in words (added to the diagram task's prompt). */
export const DIAGRAM_ASK: Record<DiagramType, string> = {
  concept: 'Diagram: a concept map. Reply with JSON only: {"nodes":[{"id","label","sources"}],"edges":[{"from","to","label","sources"}]}. Edges join node ids; edge labels are 1-3 word relations.',
  compare: 'Diagram: a comparison table. Reply with JSON only: {"columns":[{"id","title","sources"}],"rows":[{"label","cells":[{"column","text","sources"}]}]}. Columns are the things compared; rows are the points of comparison.',
  venn: 'Diagram: a two-set overlap (Venn). Reply with JSON only: {"a":{"title","items":[{"text","sources"}]},"b":{"title","items":[…]},"both":[{"text","sources"}]}.',
  flow: 'Diagram: a process flow, steps in order. Reply with JSON only: {"steps":[{"label","detail","sources"}]}.',
  cause: 'Diagram: cause and effect links. Reply with JSON only: {"links":[{"cause","effect","sources"}]}.',
  timeline: 'Diagram: a timeline in time order. Reply with JSON only: {"events":[{"when","label","sources"}]}.',
  scale: 'Diagram: a scale ladder of sizes or amounts mentioned, smallest first, all in one unit where possible. Reply with JSON only: {"items":[{"label","value","unit","sources"}]}.',
  chart: 'Diagram: a bar chart of the numbers mentioned (one unit). Reply with JSON only: {"items":[{"label","value","unit","sources"}]}.',
};

const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
const nums = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" ? Number(x.replace(/,/g, "")) : NaN);
const list = (x: unknown): any[] => (Array.isArray(x) ? x : []);

/** Validate a diagram reply: unknown source ids dropped, empty or broken elements removed. */
export function normalizeDiagram<T extends DiagramType>(type: T, raw: unknown, sentences: Sentence[]): DiagramSpecs[T] {
  const ok = new Set(sentences.map((s) => s.id));
  const src = (x: any) => [...new Set(list(x?.sources).map(str))].filter((id) => ok.has(id));
  const r = (raw ?? {}) as any;
  switch (type) {
    case "concept": {
      const nodes = list(r.nodes).map((n) => ({ id: str(n?.id), label: str(n?.label), sources: src(n) })).filter((n) => n.id && n.label);
      const ids = new Set(nodes.map((n) => n.id));
      const edges = list(r.edges).map((e) => ({ from: str(e?.from), to: str(e?.to), label: str(e?.label), sources: src(e) })).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
      return { nodes, edges } as DiagramSpecs[T];
    }
    case "compare": {
      const columns = list(r.columns).map((c) => ({ id: str(c?.id), title: str(c?.title), sources: src(c) })).filter((c) => c.id && c.title);
      const cols = new Set(columns.map((c) => c.id));
      const rows = list(r.rows)
        .map((row) => ({ label: str(row?.label), cells: list(row?.cells).map((c) => ({ column: str(c?.column), text: str(c?.text), sources: src(c) })).filter((c) => cols.has(c.column) && c.text) }))
        .filter((row) => row.label && row.cells.length);
      return { columns, rows } as DiagramSpecs[T];
    }
    case "venn": {
      const side = (x: any) => ({ title: str(x?.title), items: list(x?.items).map((i) => ({ text: str(i?.text), sources: src(i) })).filter((i) => i.text) });
      return { a: side(r.a), b: side(r.b), both: list(r.both).map((i) => ({ text: str(i?.text), sources: src(i) })).filter((i) => i.text) } as DiagramSpecs[T];
    }
    case "flow":
      return { steps: list(r.steps).map((s) => ({ label: str(s?.label), detail: str(s?.detail), sources: src(s) })).filter((s) => s.label) } as DiagramSpecs[T];
    case "cause":
      return { links: list(r.links).map((l) => ({ cause: str(l?.cause), effect: str(l?.effect), sources: src(l) })).filter((l) => l.cause && l.effect) } as DiagramSpecs[T];
    case "timeline":
      return { events: list(r.events).map((e) => ({ when: str(e?.when), label: str(e?.label), sources: src(e) })).filter((e) => e.label) } as DiagramSpecs[T];
    case "scale":
    case "chart": {
      const items = list(r.items).map((i) => ({ label: str(i?.label), value: nums(i?.value), unit: str(i?.unit), sources: src(i) })).filter((i) => i.label && isFinite(i.value));
      if (type === "scale") items.sort((a, b) => a.value - b.value);
      return { items } as DiagramSpecs[T];
    }
  }
  return raw as DiagramSpecs[T];
}

/** Every source list in a diagram. */
export function diagramSources(spec: AnyDiagram): string[][] {
  const out: string[][] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (Array.isArray(o.sources)) out.push(o.sources as string[]);
      for (const [k, v] of Object.entries(o)) if (k !== "sources") walk(v);
    }
  };
  walk(spec);
  return out;
}

/** Sentences no element of the diagram cites ("Not in this diagram"). */
export function uncovered(spec: AnyDiagram, sentences: Sentence[]): Sentence[] {
  const used = new Set(diagramSources(spec).flat());
  return sentences.filter((s) => !used.has(s.id) && !s.heading);
}

/** True when the diagram has nothing to show. */
export function emptyDiagram(spec: AnyDiagram | undefined): boolean {
  return !spec || diagramSources(spec).length === 0;
}

/** Bar lengths: linear, or log scale when the values differ more than 100×. */
export function barScale(values: number[]): { log: boolean; at: (v: number) => number } {
  const pos = values.filter((v) => v > 0);
  const min = pos.length ? Math.min(...pos) : 1;
  const max = Math.max(...values, 0) || 1;
  const log = pos.length >= 2 && max / min > 100;
  if (log) {
    const lo = Math.log10(min) - 0.3;
    const hi = Math.log10(max);
    return { log, at: (v) => (v > 0 ? Math.max(0.03, (Math.log10(v) - lo) / (hi - lo || 1)) : 0) };
  }
  return { log, at: (v) => Math.max(0, v / max) };
}
