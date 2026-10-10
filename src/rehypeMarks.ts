/**
 * Highlights drawn while an answer renders (a rehype plugin for react-markdown), so the page is never patched
 * behind React's back. Offsets count the characters of the rendered text, which is exactly what the browser's
 * Range.toString() reports for a selection inside the answer.
 */

interface HText { type: "text"; value: string }
interface HRaw { type: "raw"; value: string }
interface HElement { type: "element"; tagName: string; properties: Record<string, unknown>; children: HNode[] }
interface HOther { type: "comment" | "doctype"; value?: string }
type HNode = HText | HRaw | HElement | HOther;
export interface HRoot { type: "root"; children: HNode[] }
type HParent = HRoot | HElement;

export interface MarkSpan {
  /** highlight id (several marks may cover the same words) */
  id: string;
  start: number;
  end: number;
  /** extra classes, e.g. "tray" or "flash" */
  className?: string;
  /** small label drawn after the mark with CSS (not part of the text), e.g. "↳ 2" */
  badge?: string;
}

/** react-markdown drops whitespace between table rows and shows raw HTML as text; do the same so offsets match. */
const TABLE = new Set(["table", "thead", "tbody", "tfoot", "tr"]);

export function normalizeTree(tree: HRoot): void {
  const walk = (p: HParent) => {
    const table = p.type === "element" && TABLE.has(p.tagName);
    p.children = p.children.flatMap((c): HNode[] => {
      if (c.type === "raw") return [{ type: "text", value: c.value }];
      if (table && c.type === "text" && !c.value.trim()) return [];
      if (c.type === "element") walk(c);
      return [c];
    });
  };
  walk(tree);
}

/** Every text node in document order with its offset in the rendered text. */
function textNodes(tree: HRoot): { node: HText; parent: HParent; start: number }[] {
  const out: { node: HText; parent: HParent; start: number }[] = [];
  let pos = 0;
  const walk = (p: HParent) => {
    for (const c of p.children) {
      if (c.type === "text") {
        out.push({ node: c, parent: p, start: pos });
        pos += c.value.length;
      } else if (c.type === "element") walk(c);
    }
  };
  walk(tree);
  return out;
}

export function hastText(tree: HRoot): string {
  return textNodes(tree).map((t) => t.node.value).join("");
}

/** Wrap the marked words in <mark data-h="ids"> elements, splitting text nodes at mark edges. */
export function applyMarks(tree: HRoot, marks: MarkSpan[]): void {
  const spans = marks.filter((m) => m.end > m.start);
  if (!spans.length) return;
  const nodes = textNodes(tree);
  const replaced = new Map<HText, HNode[]>();
  for (const { node, start } of nodes) {
    const end = start + node.value.length;
    const here = spans.filter((m) => m.start < end && m.end > start);
    if (!here.length) continue;
    const cuts = new Set([start, end]);
    for (const m of here) {
      if (m.start > start) cuts.add(m.start);
      if (m.end < end) cuts.add(m.end);
    }
    const points = [...cuts].sort((a, b) => a - b);
    const parts: HNode[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const value = node.value.slice(a - start, b - start);
      const cover = here.filter((m) => m.start <= a && m.end >= b);
      if (!cover.length) {
        parts.push({ type: "text", value });
        continue;
      }
      const classes = ["hl", ...new Set(cover.flatMap((m) => (m.className ? m.className.split(" ") : [])))];
      const badges = cover.filter((m) => m.end === b && m.badge).map((m) => m.badge);
      const properties: Record<string, unknown> = { dataH: cover.map((m) => m.id).join(" "), className: classes };
      if (badges.length) properties.dataN = badges.join(" ");
      parts.push({ type: "element", tagName: "mark", properties, children: [{ type: "text", value }] });
    }
    replaced.set(node, parts);
  }
  const walk = (p: HParent) => {
    p.children = p.children.flatMap((c) => {
      if (c.type === "text") return replaced.get(c) ?? [c];
      if (c.type === "element") walk(c);
      return [c];
    });
  };
  walk(tree);
}

/**
 * The plugin. `resolve` receives the rendered text and returns the marks to draw, so stored anchors can be
 * matched against the text actually shown.
 */
export function rehypeMarks(options: { resolve?: (text: string) => MarkSpan[] } = {}) {
  return (tree: HRoot) => {
    normalizeTree(tree);
    if (!options.resolve) return;
    const marks = options.resolve(hastText(tree));
    if (marks.length) applyMarks(tree, marks);
  };
}
