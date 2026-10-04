/** Split a streamed answer into blocks (premises): paragraphs separated by blank lines.
 *  Fenced code blocks and list runs stay in one piece. */
export function splitBlocks(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  const flush = () => {
    const text = cur.join("\n").trim();
    if (text) blocks.push(text);
    cur = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "" ) {
      // a blank line ends the block unless we are inside a list continuing below
      flush();
      continue;
    }
    cur.push(line);
  }
  flush();
  return blocks;
}

const isList = (b: string) => /^\s*([-*+]|\d+[.)])\s/.test(b);
const isCode = (b: string) => /^\s*(```|~~~)/.test(b);

/** Split one block into tappable sentences. Lists and code are returned whole. */
export function splitSentences(block: string): string[] {
  if (isCode(block) || isList(block)) return [block];
  const seg = new Intl.Segmenter("en", { granularity: "sentence" });
  const out: string[] = [];
  for (const { segment } of seg.segment(block)) {
    const s = segment.replace(/\s+/g, " ").trim();
    if (s) out.push(s);
  }
  // glue very short fragments (e.g. "e.g." splits) onto the previous sentence
  const merged: string[] = [];
  for (const s of out) {
    if (merged.length && (s.length < 4 || /^[a-z]/.test(s))) merged[merged.length - 1] += " " + s;
    else merged.push(s);
  }
  return merged;
}
