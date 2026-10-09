import dagre from "@dagrejs/dagre";
import type { Answer, AnswerNode, NodeKind } from "./answer";

/** What the map needs to know about one question/answer. */
export interface MapCard {
  id: string;
  parentId: string | null;
  question: string;
  /** nodes the question was asked about (empty = the whole parent answer) */
  anchorNodeIds?: string[];
  answer?: Answer;
  status: string;
  createdAt: number;
}

export type ItemType = "node" | "question";
export type EdgeStyle = "derived" | "builds" | "asked" | "similar" | "supports";

export interface MapItem {
  id: string;
  type: ItemType;
  kind?: NodeKind;
  text: string;
  title?: string;
  cardId: string;
  group?: string;
  status?: string;
  x: number; // center
  y: number;
  w: number;
  h: number;
}
export interface MapGroup {
  id: string;
  title: string;
  cardId: string;
  parent: string | null;
  x: number; // top-left
  y: number;
  w: number;
  h: number;
}
export interface MapEdge {
  from: string;
  to: string;
  style: EdgeStyle;
  points: { x: number; y: number }[];
}
export interface MapLayout {
  items: MapItem[];
  groups: MapGroup[];
  edges: MapEdge[];
  width: number;
  height: number;
}

export const NODE_W = 176;
const Q_W = 200;
const CHARS_PER_LINE = 26;

export function estimateHeight(text: string, type: ItemType): number {
  const lines = Math.max(1, Math.ceil(Math.min(text.length, 400) / CHARS_PER_LINE));
  return 22 + lines * 17 + (type === "node" ? 14 : 0);
}

interface Built {
  items: Omit<MapItem, "x" | "y">[];
  groups: Omit<MapGroup, "x" | "y" | "w" | "h">[];
  edges: Omit<MapEdge, "points">[];
}

/** Turn questions and answers into one graph: answer → asked node(s) → question → new pyramid. */
export function buildGraph(cards: MapCard[], mode: "all" | "foundations" = "all"): Built {
  const sorted = [...cards].sort((a, b) => a.createdAt - b.createdAt);
  const nodeOwner = new Map<string, { card: MapCard; node: AnswerNode }>();
  for (const c of sorted) for (const n of c.answer?.nodes ?? []) nodeOwner.set(n.id, { card: c, node: n });
  const items: Built["items"] = [];
  const groups: Built["groups"] = [];
  const edges: Built["edges"] = [];
  const has = new Set<string>();

  const addNode = (c: MapCard, n: AnswerNode) => {
    items.push({ id: n.id, type: "node", kind: n.kind, text: n.text, title: n.title, cardId: c.id, group: n.group, w: NODE_W, h: estimateHeight(n.text, "node") });
    has.add(n.id);
  };

  if (mode === "foundations") {
    // only foundations (in their categories) and the conclusions they end up supporting
    for (const c of sorted) {
      const ans = c.answer;
      if (!ans) continue;
      for (const n of ans.nodes) if (n.kind === "foundation" || n.kind === "conclusion") addNode(c, n);
      for (const g of ans.groups) groups.push({ id: g.id, title: g.title, cardId: c.id, parent: g.parent });
    }
    const derived = new Map<string, string[]>();
    for (const { node } of nodeOwner.values()) derived.set(node.id, node.from);
    const reaches = (from: string, to: string): boolean => {
      const seen = new Set<string>();
      const stack = [to];
      while (stack.length) {
        const x = stack.pop()!;
        if (x === from) return true;
        if (seen.has(x)) continue;
        seen.add(x);
        stack.push(...(derived.get(x) ?? []));
      }
      return false;
    };
    const fs = items.filter((i) => i.kind === "foundation");
    const cs = items.filter((i) => i.kind === "conclusion");
    for (const f of fs) for (const c of cs) if (reaches(f.id, c.id)) edges.push({ from: f.id, to: c.id, style: "supports" });
    return pruneGroups({ items, groups, edges });
  }

  for (const c of sorted) {
    const q = `q:${c.id}`;
    items.push({ id: q, type: "question", text: c.question, cardId: c.id, status: c.status, w: Q_W, h: estimateHeight(c.question, "question") });
    has.add(q);
    const ans = c.answer;
    if (ans) {
      for (const n of ans.nodes) addNode(c, n);
      for (const g of ans.groups) groups.push({ id: g.id, title: g.title, cardId: c.id, parent: g.parent });
    }
  }
  for (const c of sorted) {
    const q = `q:${c.id}`;
    // what the question was asked about
    if (c.parentId) {
      const parent = sorted.find((p) => p.id === c.parentId);
      const asked = (c.anchorNodeIds ?? []).filter((id) => has.has(id));
      const sources = asked.length
        ? asked
        : (parent?.answer?.nodes.filter((n) => n.kind === "conclusion").map((n) => n.id) ?? []).filter((id) => has.has(id));
      if (sources.length) for (const s of sources) edges.push({ from: s, to: q, style: "asked" });
      else if (parent) edges.push({ from: `q:${parent.id}`, to: q, style: "asked" });
    }
    const ans = c.answer;
    if (!ans) continue;
    const own = new Set(ans.nodes.map((n) => n.id));
    for (const n of ans.nodes) {
      const inner = n.from.filter((f) => own.has(f));
      const outer = n.from.filter((f) => !own.has(f) && has.has(f));
      if (!inner.length) edges.push({ from: q, to: n.id, style: "asked" });
      for (const f of inner) edges.push({ from: f, to: n.id, style: "derived" });
      for (const f of outer) edges.push({ from: f, to: n.id, style: "builds" });
    }
  }
  return pruneGroups({ items, groups, edges });
}

/** Keep only categories that (directly or through sub-categories) contain a shown node. */
function pruneGroups(b: Built): Built {
  const used = new Set<string>();
  for (const i of b.items) {
    let g = i.group ? b.groups.find((x) => x.id === i.group) : undefined;
    while (g && !used.has(g.id)) {
      used.add(g.id);
      g = g.parent ? b.groups.find((x) => x.id === g!.parent) : undefined;
    }
  }
  return { ...b, groups: b.groups.filter((g) => used.has(g.id)) };
}

/** Lay out the graph top-to-bottom: foundations above, conclusions below, categories as boxes. */
export function layoutGraph(b: Built, similar: [string, string][] = []): MapLayout {
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: false });
  g.setGraph({ rankdir: "TB", nodesep: 22, ranksep: 64, marginx: 24, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(b.items.map((i) => i.id));
  for (const i of b.items) g.setNode(i.id, { width: i.w, height: i.h });
  for (const gr of b.groups) g.setNode(gr.id, { paddingTop: 26 });
  for (const gr of b.groups) if (gr.parent && b.groups.some((x) => x.id === gr.parent)) g.setParent(gr.id, gr.parent);
  for (const i of b.items) if (i.group && b.groups.some((x) => x.id === i.group)) g.setParent(i.id, i.group);
  const seen = new Set<string>();
  for (const e of b.edges) {
    const k = `${e.from}>${e.to}`;
    if (e.from === e.to || !ids.has(e.from) || !ids.has(e.to) || seen.has(k)) continue;
    seen.add(k);
    g.setEdge(e.from, e.to);
  }
  dagre.layout(g);

  const items: MapItem[] = b.items.map((i) => {
    const n = g.node(i.id) as { x: number; y: number };
    return { ...i, x: n.x, y: n.y };
  });
  const groups: MapGroup[] = b.groups.map((gr) => {
    const n = g.node(gr.id) as { x: number; y: number; width: number; height: number };
    return { ...gr, x: n.x - n.width / 2, y: n.y - n.height / 2 - 18, w: n.width, h: n.height + 18 };
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const edges: MapEdge[] = [];
  for (const e of b.edges) {
    if (!seen.has(`${e.from}>${e.to}`)) continue;
    const de = g.edge(e.from, e.to) as { points?: { x: number; y: number }[] } | undefined;
    const a = byId.get(e.from)!;
    const z = byId.get(e.to)!;
    edges.push({ ...e, points: de?.points?.length ? de.points : [{ x: a.x, y: a.y + a.h / 2 }, { x: z.x, y: z.y - z.h / 2 }] });
  }
  for (const [from, to] of similar) {
    const a = byId.get(from);
    const z = byId.get(to);
    if (a && z) edges.push({ from, to, style: "similar", points: [{ x: a.x, y: a.y }, { x: z.x, y: z.y }] });
  }
  const gr = g.graph() as { width?: number; height?: number };
  return { items, groups, edges, width: Math.max(gr.width ?? 0, 1), height: Math.max(gr.height ?? 0, 1) };
}

export function layoutMap(cards: MapCard[], mode: "all" | "foundations" = "all", similar: [string, string][] = []): MapLayout {
  return layoutGraph(buildGraph(cards, mode), similar);
}

/** Everything a node rests on (upwards) and everything it supports (downwards), across answers. */
export function lineage(edges: { from: string; to: string; style: EdgeStyle }[], id: string): Set<string> {
  const out = new Set([id]);
  const walk = (start: string, dir: "up" | "down") => {
    const stack = [start];
    while (stack.length) {
      const x = stack.pop()!;
      for (const e of edges) {
        if (e.style === "similar") continue;
        const next = dir === "up" ? (e.to === x ? e.from : null) : e.from === x ? e.to : null;
        if (next && !out.has(next)) {
          out.add(next);
          stack.push(next);
        }
      }
    }
  };
  walk(id, "up");
  walk(id, "down");
  return out;
}
