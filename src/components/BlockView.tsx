import { useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { splitSentences } from "../blocks";

const inline = { p: ({ children }: { children?: React.ReactNode }) => <>{children}</> };

export function BlockView({
  blocks,
  counts,
  highlight,
  disabled,
  onTap,
}: {
  blocks: string[];
  /** "block:sentence" → number of questions already asked about it */
  counts: Map<string, number>;
  highlight?: number;
  disabled?: boolean;
  onTap: (block: number, sentence: number, text: string) => void;
}) {
  const sentences = useMemo(() => blocks.map(splitSentences), [blocks]);
  const hlRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    hlRef.current?.scrollIntoView?.({ block: "center" });
  }, [highlight]);

  return (
    <div className="blocks">
      {sentences.map((sents, b) => {
        const whole = sents.length === 1 && /^\s*(```|~~~|[-*+]\s|\d+[.)]\s)/.test(blocks[b]);
        return (
          <div key={b} className={`block ${highlight === b ? "hl" : ""}`} ref={highlight === b ? hlRef : undefined} data-block={b}>
            {whole ? (
              <div
                className="sent whole"
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-disabled={disabled}
                onClick={() => !disabled && onTap(b, 0, blocks[b])}
                onKeyDown={(e) => e.key === "Enter" && !disabled && onTap(b, 0, blocks[b])}
              >
                <ReactMarkdown>{blocks[b]}</ReactMarkdown>
              </div>
            ) : (
              <p>
                {sents.map((s, i) => {
                  const n = counts.get(`${b}:${i}`) ?? 0;
                  return (
                    <span key={i}>
                      <span
                        className={`sent ${n ? "asked" : ""}`}
                        role="button"
                        tabIndex={disabled ? -1 : 0}
                        aria-disabled={disabled}
                        data-sentence={`${b}:${i}`}
                        onClick={() => !disabled && onTap(b, i, s)}
                        onKeyDown={(e) => e.key === "Enter" && !disabled && onTap(b, i, s)}
                      >
                        <ReactMarkdown components={inline}>{s}</ReactMarkdown>
                        {n > 0 && <sup className="count">{n}</sup>}
                      </span>{" "}
                    </span>
                  );
                })}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
