/**
 * Text anchors for highlights. An answer is never cut into pieces: a highlight is the quoted words plus where
 * they sit in the answer's rendered text, with a little context on each side so it can be found again.
 */

export interface TextAnchor {
  quote: string;
  start: number;
  end: number;
  prefix: string;
  suffix: string;
}

const CONTEXT = 32;
const SPACE = /\s/;

/** Shrink [start, end) so it neither begins nor ends with whitespace. */
export function trimSpan(text: string, start: number, end: number): [number, number] {
  let s = Math.max(0, Math.min(start, text.length));
  let e = Math.max(s, Math.min(end, text.length));
  while (s < e && SPACE.test(text[s])) s++;
  while (e > s && SPACE.test(text[e - 1])) e--;
  return [s, e];
}

/** The anchor for text[start, end), or undefined when only whitespace is selected. */
export function makeAnchor(text: string, start: number, end: number): TextAnchor | undefined {
  const [s, e] = trimSpan(text, Math.min(start, end), Math.max(start, end));
  if (e <= s) return undefined;
  return {
    quote: text.slice(s, e),
    start: s,
    end: e,
    prefix: text.slice(Math.max(0, s - CONTEXT), s),
    suffix: text.slice(e, e + CONTEXT),
  };
}

function sameTail(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function sameHead(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Where an anchor is in the text: its stored position while the quote is still there, otherwise the occurrence
 * whose surroundings match best (ties go to the one nearest the old position). Undefined if the quote is gone.
 */
export function resolveAnchor(text: string, a: Pick<TextAnchor, "quote" | "start" | "end"> & Partial<TextAnchor>): { start: number; end: number } | undefined {
  if (!a.quote) return undefined;
  if (text.slice(a.start, a.end) === a.quote) return { start: a.start, end: a.end };
  let best: { at: number; score: number } | undefined;
  for (let i = text.indexOf(a.quote); i >= 0; i = text.indexOf(a.quote, i + 1)) {
    const before = text.slice(Math.max(0, i - CONTEXT), i);
    const after = text.slice(i + a.quote.length, i + a.quote.length + CONTEXT);
    const score = sameTail(before, a.prefix ?? "") + sameHead(after, a.suffix ?? "") - Math.abs(i - a.start) / 1e7;
    if (!best || score > best.score) best = { at: i, score };
  }
  return best ? { start: best.at, end: best.at + a.quote.length } : undefined;
}

/** Plain words of a markdown block: no heading, list or quote markers, emphasis or link syntax. */
export function plainWords(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find `needle` in `text` ignoring differences in whitespace (for search hits, whose text is markdown source).
 * Only the first `max` characters of the needle are matched. Returns positions in the original text.
 */
export function findLoose(text: string, needle: string, max = 80): { start: number; end: number } | undefined {
  const want = plainWords(needle).slice(0, max).trim();
  if (!want) return undefined;
  // collapse whitespace runs in the text, remembering where each kept character came from
  let flat = "";
  const from: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (SPACE.test(text[i])) {
      if (flat.endsWith(" ") || !flat) continue;
      flat += " ";
    } else flat += text[i];
    from.push(i);
  }
  const at = flat.indexOf(want);
  if (at < 0) return undefined;
  return { start: from[at], end: from[at + want.length - 1] + 1 };
}
