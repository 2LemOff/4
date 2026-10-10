/**
 * The arrangement of chosen sentences that the views are drawn from: where the topic sits (broad → narrow
 * levels, with neighbours), the groups, and each sentence's kind, short label and links. The model only
 * places sentence ids; the app keeps every sentence word for word, and anything left unplaced goes to
 * "Other details".
 */
import type { Sentence } from "./split";

export type ItemKind = "foundation" | "step" | "conclusion" | "detail" | "example";
export const ITEM_KINDS: ItemKind[] = ["foundation", "step", "conclusion", "detail", "example"];

export interface Level {
  name: string;
  about: string;
  /** neighbours on the same level (shown as dashed "ghosts") */
  siblings: string[];
}

export interface ArrangedGroup {
  id: string;
  title: string;
  parent: string | null;
}

export interface ArrangedItem {
  /** sentence id */
  id: string;
  group: string;
  kind: ItemKind;
  /** 2-6 word label; the sentence itself is always shown in full where it matters */
  label: string;
  /** sentence ids this one builds on */
  from: string[];
}

export interface Arrangement {
  title: string;
  levels: Level[];
  groups: ArrangedGroup[];
  items: ArrangedItem[];
  /** true when built from headings because the model's reply wasn't usable */
  fallback?: boolean;
}

export const OTHER = "other";

export const ARRANGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "levels", "groups", "items"],
  properties: {
    title: { type: "string" },
    levels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "about", "siblings"],
        properties: { name: { type: "string" }, about: { type: "string" }, siblings: { type: "array", items: { type: "string" } } },
      },
    },
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "parent"],
        properties: { id: { type: "string" }, title: { type: "string" }, parent: { type: ["string", "null"] } },
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "group", "kind", "label", "from"],
        properties: {
          id: { type: "string" },
          group: { type: ["string", "null"] },
          kind: { type: "string", enum: ITEM_KINDS },
          label: { type: "string" },
          from: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

/** What the arranger is told about the reply it must give (after the task's editable prompt). */
export const ARRANGE_FORMAT = `Reply with JSON only:
{"title":"the big idea in a few words","levels":[{"name","about","siblings"}],"groups":[{"id","title","parent"}],"items":[{"id","group","kind","label","from"}]}
- levels: where this sits in human knowledge, broadest first (e.g. Science › Physics › Optics › Scattering), 2-6 levels; "about" is one short sentence; "siblings" are 2-6 other topics on the same level.
- groups: the answer's own categories ("parent" for nesting, else null).
- items: one per sentence id, every id exactly once. kind is foundation, step, conclusion, detail or example; label is 2-6 words; "from" lists the ids it builds on.`;

const short = (t: string, n = 40) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");

/** The model's reply made safe: unknown or repeated ids dropped, every sentence placed exactly once. */
export function normalizeArrangement(raw: unknown, sentences: Sentence[]): Arrangement {
  const r = (raw ?? {}) as Record<string, unknown>;
  const valid = new Set(sentences.map((s) => s.id));

  const levels: Level[] = (Array.isArray(r.levels) ? r.levels : [])
    .map((l: any) => ({
      name: str(l?.name),
      about: str(l?.about),
      siblings: (Array.isArray(l?.siblings) ? l.siblings : []).map(str).filter(Boolean).slice(0, 12),
    }))
    .filter((l: Level) => l.name)
    .slice(0, 8);

  const groups: ArrangedGroup[] = [];
  const gIds = new Set<string>();
  for (const g of Array.isArray(r.groups) ? r.groups : []) {
    const id = str((g as any)?.id);
    const title = str((g as any)?.title);
    if (!id || !title || gIds.has(id) || id === OTHER) continue;
    gIds.add(id);
    groups.push({ id, title, parent: str((g as any)?.parent) || null });
  }
  for (const g of groups) if (g.parent && (!gIds.has(g.parent) || g.parent === g.id)) g.parent = null;
  // break parent cycles
  for (const g of groups) {
    const seen = new Set([g.id]);
    for (let p = g.parent; p; p = groups.find((x) => x.id === p)?.parent ?? null) {
      if (seen.has(p)) {
        g.parent = null;
        break;
      }
      seen.add(p);
    }
  }

  const items: ArrangedItem[] = [];
  const placed = new Set<string>();
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const id = str((it as any)?.id);
    if (!valid.has(id) || placed.has(id)) continue;
    placed.add(id);
    const g = str((it as any)?.group);
    const kind = ITEM_KINDS.includes((it as any)?.kind) ? ((it as any).kind as ItemKind) : "detail";
    items.push({
      id,
      group: gIds.has(g) ? g : OTHER,
      kind,
      label: str((it as any)?.label) || short(sentences.find((s) => s.id === id)!.text),
      from: [...new Set<string>((Array.isArray((it as any)?.from) ? ((it as any).from as unknown[]) : []).map(str))].filter((f) => valid.has(f) && f !== id),
    });
  }
  // nothing is ever dropped: unplaced sentences go to "Other details", in reading order
  for (const s of sentences) {
    if (placed.has(s.id)) continue;
    items.push({ id: s.id, group: OTHER, kind: "detail", label: short(s.text), from: [] });
  }
  if (items.some((i) => i.group === OTHER)) groups.push({ id: OTHER, title: "Other details", parent: null });
  const order = new Map(sentences.map((s, i) => [s.id, i]));
  items.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { title: str(r.title) || short(sentences[0]?.text ?? "Untitled", 60), levels, groups, items };
}

/** Without the model: each source (titled) and each heading becomes a group; sentences sit under the last one. */
export function fallbackArrangement(sentences: Sentence[], titles: Record<string, string> = {}): Arrangement {
  const groups: ArrangedGroup[] = [];
  const items: ArrangedItem[] = [];
  let sourceGroup: string | null = null;
  let current = "";
  let lastSource: string | undefined;
  for (const s of sentences) {
    if (s.source !== lastSource) {
      lastSource = s.source;
      sourceGroup = null;
      current = "";
      if (titles[s.source]) {
        sourceGroup = `g${groups.length + 1}`;
        groups.push({ id: sourceGroup, title: titles[s.source], parent: null });
        current = sourceGroup;
      }
    }
    if (s.heading) {
      const id = `g${groups.length + 1}`;
      groups.push({ id, title: s.text, parent: sourceGroup });
      current = id;
    }
    items.push({ id: s.id, group: current || OTHER, kind: "detail", label: short(s.text), from: [] });
  }
  if (items.some((i) => i.group === OTHER)) groups.push({ id: OTHER, title: groups.length ? "Other details" : "Details", parent: null });
  return { title: short(sentences[0]?.text ?? "Untitled", 60), levels: [], groups, items, fallback: true };
}

/** Items of a group and its nested groups. */
export function itemsIn(a: Arrangement, gid: string): ArrangedItem[] {
  const ids = new Set([gid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of a.groups) if (g.parent && ids.has(g.parent) && !ids.has(g.id)) (ids.add(g.id), (grew = true));
  }
  return a.items.filter((i) => ids.has(i.group));
}
