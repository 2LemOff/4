import { parse as parsePartial, Allow } from "partial-json";
import { splitBlocks } from "./blocks";

/** Answers are pyramids: foundations (first principles) at the top, steps derived from them, conclusions at the bottom. */
export type NodeKind = "foundation" | "step" | "conclusion";

export interface AnswerNode {
  id: string;
  kind: NodeKind;
  text: string;
  /** category this node sits in */
  group?: string;
  /** ids this node is derived from; may name nodes of earlier answers (cross-answer links) */
  from: string[];
  /** short name of a conclusion (names its pyramid) */
  title?: string;
  /** council answers: labels of the member responses this point came from */
  sources?: string[];
  /** council grounding check */
  grounded?: boolean;
}

export interface AnswerGroup {
  id: string;
  title: string;
  parent: string | null;
}

export interface Answer {
  groups: AnswerGroup[];
  nodes: AnswerNode[];
  /** true when the reply was not in the pyramid format and was converted */
  converted?: boolean;
}

export const prefixFor = (seq: number) => `K${seq}`;
const CROSS = /^K\d+\./;

function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
}

function rawJSON(raw: string, partial: boolean): unknown {
  const t = stripFences(raw);
  const start = t.indexOf("{");
  if (start < 0) return undefined;
  const body = t.slice(start);
  try {
    return JSON.parse(body);
  } catch {
    try {
      return parsePartial(body, partial ? Allow.ALL : Allow.ALL & ~Allow.STR);
    } catch {
      return undefined;
    }
  }
}

const KINDS: NodeKind[] = ["foundation", "step", "conclusion"];

/** Normalize model JSON into an Answer with globally unique ids (`K7.n1`). Returns undefined if it isn't the format. */
export function normalizeAnswer(data: unknown, prefix: string): Answer | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as { groups?: unknown; nodes?: unknown };
  if (!Array.isArray(d.nodes)) return undefined;
  const local = (id: string) => (CROSS.test(id) ? id : `${prefix}.${id.replace(/^\.+/, "")}`);

  const groups: AnswerGroup[] = [];
  const gIds = new Set<string>();
  if (Array.isArray(d.groups)) {
    d.groups.forEach((g: any, i: number) => {
      if (!g || typeof g !== "object") return;
      const title = String(g.title ?? "").trim();
      if (!title) return;
      const id = local(String(g.id ?? `g${i + 1}`));
      if (gIds.has(id)) return;
      gIds.add(id);
      groups.push({ id, title, parent: g.parent ? local(String(g.parent)) : null });
    });
  }
  // drop unknown parents and break cycles
  for (const g of groups) if (g.parent && !gIds.has(g.parent)) g.parent = null;
  for (const g of groups) {
    const seen = new Set<string>([g.id]);
    let p = g.parent;
    while (p) {
      if (seen.has(p)) {
        g.parent = null;
        break;
      }
      seen.add(p);
      p = groups.find((x) => x.id === p)?.parent ?? null;
    }
  }

  const nodes: AnswerNode[] = [];
  const nIds = new Set<string>();
  d.nodes.forEach((n: any, i: number) => {
    if (!n || typeof n !== "object") return;
    const text = String(n.text ?? "").trim();
    if (!text) return;
    let id = local(String(n.id ?? `n${i + 1}`));
    if (nIds.has(id)) id = `${prefix}.n${i + 1}_${nodes.length}`;
    nIds.add(id);
    const kind: NodeKind = KINDS.includes(n.kind) ? n.kind : "step";
    const node: AnswerNode = {
      id,
      kind,
      text,
      from: Array.isArray(n.from) ? n.from.filter((x: unknown) => typeof x === "string" && x).map((x: string) => local(x)) : [],
    };
    const group = n.group ? local(String(n.group)) : undefined;
    if (group && gIds.has(group)) node.group = group;
    if (typeof n.title === "string" && n.title.trim()) node.title = n.title.trim();
    if (Array.isArray(n.sources)) node.sources = n.sources.filter((x: unknown) => typeof x === "string");
    nodes.push(node);
  });
  if (!nodes.length) return undefined;
  // local references must exist; cross-answer references are checked by the caller against known ids
  for (const n of nodes) n.from = [...new Set(n.from)].filter((f) => f !== n.id && (CROSS.test(f) && !f.startsWith(prefix + ".") ? true : nIds.has(f)));
  return { groups, nodes };
}

/** Parse a (possibly still streaming) reply. Non-JSON replies become a simple chain once complete. */
export function parseAnswer(raw: string, prefix: string, opts: { partial?: boolean } = {}): Answer | undefined {
  const ans = normalizeAnswer(rawJSON(raw, !!opts.partial), prefix);
  if (ans) return ans;
  if (opts.partial) return undefined;
  return raw.trim() ? textAnswer(raw, prefix) : undefined;
}

/** Paragraph text as a chain: each paragraph a step built on the one before, the last one the conclusion. */
export function textAnswer(text: string, prefix: string): Answer {
  const paras = splitBlocks(stripFences(text));
  const nodes: AnswerNode[] = paras.map((p, i) => ({
    id: `${prefix}.p${i + 1}`,
    kind: i === paras.length - 1 && paras.length > 1 ? "conclusion" : i === 0 ? "foundation" : "step",
    text: p,
    from: i === 0 ? [] : [`${prefix}.p${i}`],
  }));
  return { groups: [], nodes, converted: true };
}

/** Drop cross-answer links that point at nodes that don't exist. */
export function pruneCrossLinks(ans: Answer, known: Set<string>): Answer {
  const own = new Set(ans.nodes.map((n) => n.id));
  return { ...ans, nodes: ans.nodes.map((n) => ({ ...n, from: n.from.filter((f) => own.has(f) || known.has(f)) })) };
}

export interface Pyramid {
  id: string;
  title: string;
  nodeIds: string[];
}

/** Connected parts of one answer (links inside the answer only). Unrelated parts are separate pyramids. */
export function pyramids(ans: Answer): Pyramid[] {
  const ids = ans.nodes.map((n) => n.id);
  const parent = new Map(ids.map((i) => [i, i]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  for (const n of ans.nodes)
    for (const f of n.from) if (parent.has(f)) parent.set(find(f), find(n.id));
  const comps = new Map<string, string[]>();
  for (const i of ids) comps.set(find(i), [...(comps.get(find(i)) ?? []), i]);
  return [...comps.values()].map((nodeIds, k) => {
    const nodes = ans.nodes.filter((n) => nodeIds.includes(n.id));
    const concl = nodes.find((n) => n.kind === "conclusion") ?? nodes[nodes.length - 1];
    return { id: `${nodeIds[0]}#p${k}`, title: concl.title ?? short(concl.text), nodeIds };
  });
}

export const short = (t: string, n = 40) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);

export function answerTitle(ans: Answer | undefined): string | undefined {
  const c = ans?.nodes.find((n) => n.kind === "conclusion" && n.title);
  return c?.title;
}

/** Group path for a group id (outermost first). */
export function groupPath(ans: Answer, gid: string | undefined): AnswerGroup[] {
  const out: AnswerGroup[] = [];
  let g = ans.groups.find((x) => x.id === gid);
  while (g && out.length < 20) {
    out.unshift(g);
    g = ans.groups.find((x) => x.id === g!.parent);
  }
  return out;
}

/** Readable indented outline: categories (nested) with their foundations, then steps, then conclusions. */
export function outlineLines(ans: Answer): { depth: number; text: string; nodeId?: string; groupId?: string; kind?: NodeKind }[] {
  const lines: { depth: number; text: string; nodeId?: string; groupId?: string; kind?: NodeKind }[] = [];
  const walkGroup = (gid: string | null, depth: number) => {
    for (const g of ans.groups.filter((x) => x.parent === gid)) {
      lines.push({ depth, text: g.title, groupId: g.id });
      for (const n of ans.nodes.filter((x) => x.group === g.id)) lines.push({ depth: depth + 1, text: n.text, nodeId: n.id, kind: n.kind });
      walkGroup(g.id, depth + 1);
    }
  };
  walkGroup(null, 0);
  for (const kind of KINDS)
    for (const n of ans.nodes.filter((x) => x.kind === kind && !x.group)) lines.push({ depth: 0, text: n.text, nodeId: n.id, kind });
  return lines;
}

/** A finished answer as text: full-text answers as written, pyramid answers as an outline. */
export function cardMarkdown(c: { answer?: Answer; assistant?: { content: string }; blocks: string[] }): string {
  if (c.answer && !c.answer.converted) return outlineText(c.answer);
  return c.assistant?.content || c.blocks.join("\n\n");
}

export function outlineText(ans: Answer | undefined): string {
  if (!ans) return "";
  const label: Record<NodeKind, string> = { foundation: "Foundation", step: "Step", conclusion: "Conclusion" };
  return outlineLines(ans)
    .map((l) => `${"  ".repeat(l.depth)}- ${l.kind ? `${label[l.kind]}: ` : "[Category] "}${l.text}`)
    .join("\n");
}

/** Outline of just some nodes (a pyramid or a category). */
export function subsetOutline(ans: Answer, nodeIds: string[]): string {
  const keep = new Set(nodeIds);
  const groups = new Set(ans.nodes.filter((n) => keep.has(n.id) && n.group).flatMap((n) => groupPath(ans, n.group).map((g) => g.id)));
  return outlineText({ groups: ans.groups.filter((g) => groups.has(g.id)), nodes: ans.nodes.filter((n) => keep.has(n.id)) });
}

/** Nodes in a category, including nested categories. */
export function nodesInGroup(ans: Answer, gid: string): string[] {
  const groups = new Set([gid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of ans.groups) if (g.parent && groups.has(g.parent) && !groups.has(g.id)) (groups.add(g.id), (grew = true));
  }
  return ans.nodes.filter((n) => n.group && groups.has(n.group)).map((n) => n.id);
}

/** JSON schema for structured outputs (strict: every field required, optional ones nullable). */
export const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["groups", "nodes"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "parent"],
        properties: { id: { type: "string" }, title: { type: "string" }, parent: { type: ["string", "null"] } },
      },
    },
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "text", "group", "from", "title"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["foundation", "step", "conclusion"] },
          text: { type: "string" },
          group: { type: ["string", "null"] },
          from: { type: "array", items: { type: "string" } },
          title: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;
