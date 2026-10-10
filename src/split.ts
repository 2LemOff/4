/**
 * Splitting happens only when something is visualized, and only for the text chosen: the chat never cuts an
 * answer. Every non-space character of the chosen text lands in exactly one sentence, so a view can always
 * show everything; the arranger only places sentences by id and never rewrites them.
 */

export interface Sentence {
  /** "s1", "s2", … in reading order */
  id: string;
  text: string;
  /** what it came from: an answer (card id) or a highlight id */
  source: string;
  /** a markdown heading (kept as its own sentence) */
  heading?: boolean;
  /** which line (paragraph, list item, row) of the source it is in, so views can keep paragraphs together */
  para?: number;
  /** a list item */
  list?: boolean;
}

export interface SourceText {
  key: string;
  /** markdown (answers) or plain text (highlights) */
  text: string;
}

/** Markdown to plain lines: headings, list items, table rows and paragraphs, with the syntax removed. */
export function plainLines(markdown: string): { text: string; heading: boolean; list?: boolean }[] {
  const out: { text: string; heading: boolean; list?: boolean }[] = [];
  let para: string[] = [];
  let fence = false;
  const flush = () => {
    const t = para.join(" ").replace(/\s+/g, " ").trim();
    if (t) out.push({ text: t, heading: false });
    para = [];
  };
  const inline = (s: string) =>
    s
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[^*_\w])[*_]([^*_\n]+)[*_](?=[^*_\w]|$)/g, "$1$2")
      .replace(/`([^`]*)`/g, "$1");
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      flush();
      fence = !fence;
      continue;
    }
    if (fence) {
      if (raw.trim()) out.push({ text: raw.trim(), heading: false });
      continue;
    }
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line)) continue; // table separator row
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      flush();
      out.push({ text: inline(h[1]).replace(/#+$/, "").trim(), heading: true });
      continue;
    }
    if (/^\|.*\|$/.test(line)) {
      flush();
      out.push({ text: inline(line.slice(1, -1).split("|").map((c) => c.trim()).join(" | ")), heading: false });
      continue;
    }
    const li = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      out.push({ text: inline(li[1]), heading: false, list: true });
      continue;
    }
    para.push(inline(line.replace(/^>\s?/, "")));
  }
  flush();
  return out.filter((l) => l.text);
}

/** Sentences of one line (Intl.Segmenter), with very short fragments ("e.g.") glued back on. */
export function sentencesOf(line: string): string[] {
  const seg = new Intl.Segmenter("en", { granularity: "sentence" });
  const parts: string[] = [];
  for (const { segment } of seg.segment(line)) {
    const s = segment.trim();
    if (!s) continue;
    if (parts.length && (s.length < 4 || /^[a-z]/.test(s))) parts[parts.length - 1] += " " + s;
    else parts.push(s);
  }
  return parts;
}

/** All sentences of the chosen texts, in order, with stable ids. */
export function splitSources(sources: SourceText[]): Sentence[] {
  const out: Sentence[] = [];
  let para = 0;
  for (const src of sources) {
    for (const line of plainLines(src.text)) {
      para++;
      const parts = line.heading ? [line.text] : sentencesOf(line.text);
      for (const text of parts) out.push({ id: `s${out.length + 1}`, text, source: src.key, heading: line.heading || undefined, para, list: line.list || undefined });
    }
  }
  return out;
}

/** Sentences regrouped into their lines (paragraphs, list items, headings), in order. */
export function paragraphs(ss: Sentence[]): { para: number; heading: boolean; list: boolean; ids: string[]; text: string }[] {
  const out: { para: number; heading: boolean; list: boolean; ids: string[]; text: string }[] = [];
  for (const s of ss) {
    const last = out[out.length - 1];
    if (last && last.para === s.para && s.para !== undefined) {
      last.ids.push(s.id);
      last.text += ` ${s.text}`;
    } else out.push({ para: s.para ?? -out.length, heading: !!s.heading, list: !!s.list, ids: [s.id], text: s.text });
  }
  return out;
}

/** Numbered lines for the arranger and diagram prompts. */
export const numbered = (ss: Sentence[]) => ss.map((s) => `[${s.id}]${s.heading ? " (heading)" : ""} ${s.text}`).join("\n");
