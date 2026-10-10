import { memo, useMemo, type ComponentProps } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { findLoose, resolveAnchor } from "../anchors";
import { rehypeMarks, type MarkSpan } from "../rehypeMarks";

export interface AnswerMark {
  id: string;
  quote: string;
  start: number;
  end: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  badge?: string;
  /** find `quote` ignoring spacing and markdown (for marks placed from model text, like council sources) */
  loose?: boolean;
}

const REMARK = [remarkGfm];
const COMPONENTS: ComponentProps<typeof Markdown>["components"] = {
  // links open outside the app; the node prop isn't a DOM attribute
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};
// no remote images inside answers
const NO_IMAGES = ["img"];

/**
 * An answer shown whole, as the model wrote it (markdown), with highlights drawn on top. `data-answer` marks the
 * text a selection is measured in; it is set only once the answer is finished.
 */
export const AnswerText = memo(function AnswerText({
  cardId,
  markdown,
  marks,
  find,
  selectable,
}: {
  cardId: string;
  markdown: string;
  marks: AnswerMark[];
  /** words to mark briefly (a search hit) */
  find?: string;
  selectable: boolean;
}) {
  const plugins = useMemo(() => {
    const resolve = (text: string): MarkSpan[] => {
      const out: MarkSpan[] = [];
      for (const m of marks) {
        const at = m.loose ? findLoose(text, m.quote, 400) : resolveAnchor(text, m);
        if (at) out.push({ id: m.id, ...at, className: m.className, badge: m.badge });
      }
      if (find) {
        const at = findLoose(text, find);
        if (at) out.push({ id: "find", ...at, className: "flash" });
      }
      return out;
    };
    return [[rehypeMarks, { resolve }]] as unknown as ComponentProps<typeof Markdown>["rehypePlugins"];
  }, [marks, find]);
  return (
    <div className="answer-text" data-answer={selectable ? cardId : undefined}>
      <Markdown remarkPlugins={REMARK} rehypePlugins={plugins} components={COMPONENTS} disallowedElements={NO_IMAGES} unwrapDisallowed>
        {markdown}
      </Markdown>
    </div>
  );
});
