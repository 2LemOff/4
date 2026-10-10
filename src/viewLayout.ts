/** Layouts for the drawn views: a radial mind map and a top-down concept map (dagre). Pure. */
import dagre from "@dagrejs/dagre";
import type { Arrangement } from "./arrange";
import type { ConceptSpec } from "./diagrams";

export interface Box {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "center" | "group" | "item";
  /** sentence ids (items) */
  sources: string[];
}
export interface Line {
  from: string;
  to: string;
  label?: string;
  sources?: string[];
}
export interface Drawing {
  boxes: Box[];
  lines: Line[];
  width: number;
  height: number;
}

const CHAR = 6.6;
/** Wrap a label into at most `max` lines of about `per` characters. */
export function wrap(label: string, per = 20, max = 3): string[] {
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= per) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > max) {
    const kept = lines.slice(0, max);
    kept[max - 1] = `${kept[max - 1].replace(/…$/, "")}…`;
    return kept;
  }
  return lines;
}
const size = (label: string, per: number) => {
  const ls = wrap(label, per);
  return { w: Math.max(...ls.map((l) => l.length)) * CHAR + 18, h: ls.length * 16 + 12 };
};

/** The big idea in the middle, groups around it, and each group's items fanned out beyond it. */
export function radialLayout(a: Arrangement): Drawing {
  const groups = a.groups.filter((g) => a.items.some((i) => i.group === g.id));
  const boxes: Box[] = [];
  const lines: Line[] = [];
  const c = size(a.title, 22);
  boxes.push({ id: "center", label: a.title, x: 0, y: 0, ...c, kind: "center", sources: [] });
  const G = Math.max(groups.length, 1);
  const r1 = 150 + G * 14;
  groups.forEach((g, gi) => {
    const angle = (gi / G) * Math.PI * 2 - Math.PI / 2;
    const gx = Math.cos(angle) * r1;
    const gy = Math.sin(angle) * r1;
    boxes.push({ id: `g:${g.id}`, label: g.title, x: gx, y: gy, ...size(g.title, 18), kind: "group", sources: [] });
    lines.push({ from: "center", to: `g:${g.id}` });
    const its = a.items.filter((i) => i.group === g.id);
    const spread = Math.min(Math.PI * 0.9, (Math.PI * 2) / G) * 0.9;
    its.forEach((it, k) => {
      const t = its.length === 1 ? 0 : k / (its.length - 1) - 0.5;
      const ang = angle + t * spread;
      const r2 = 120 + (k % 2) * 46 + Math.min(its.length, 10) * 4;
      boxes.push({ id: it.id, label: it.label, x: gx + Math.cos(ang) * r2, y: gy + Math.sin(ang) * r2, ...size(it.label, 16), kind: "item", sources: [it.id] });
      lines.push({ from: `g:${g.id}`, to: it.id });
    });
  });
  return normalize(boxes, lines);
}

/** A concept map laid out top-down. */
export function conceptLayout(spec: ConceptSpec): Drawing {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 26, ranksep: 54, marginx: 10, marginy: 10 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of spec.nodes) {
    const s = size(n.label, 18);
    g.setNode(n.id, { width: s.w, height: s.h });
  }
  for (const e of spec.edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const boxes: Box[] = spec.nodes.map((n) => {
    const p = g.node(n.id);
    return { id: n.id, label: n.label, x: p.x, y: p.y, w: p.width, h: p.height, kind: "item", sources: n.sources };
  });
  return normalize(boxes, spec.edges.map((e) => ({ from: e.from, to: e.to, label: e.label, sources: e.sources })));
}

/** Shift everything to positive coordinates with a margin. */
function normalize(boxes: Box[], lines: Line[]): Drawing {
  if (!boxes.length) return { boxes, lines, width: 0, height: 0 };
  const minX = Math.min(...boxes.map((b) => b.x - b.w / 2)) - 16;
  const minY = Math.min(...boxes.map((b) => b.y - b.h / 2)) - 16;
  const maxX = Math.max(...boxes.map((b) => b.x + b.w / 2)) + 16;
  const maxY = Math.max(...boxes.map((b) => b.y + b.h / 2)) + 16;
  return {
    boxes: boxes.map((b) => ({ ...b, x: b.x - minX, y: b.y - minY })),
    lines,
    width: maxX - minX,
    height: maxY - minY,
  };
}
