import { useLayoutEffect, useRef, useState } from "react";
import { settingsStore, useStore } from "../../store";

/**
 * Read more for the views (never the chat): long text is cut to a set number of lines with a fade, and
 * "Read more" shows the rest in place.
 */
export function Clamp({ text, lines, className }: { text: string; lines?: number; className?: string }) {
  const { readMoreLines } = useStore(settingsStore);
  const n = lines ?? readMoreLines ?? 4;
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 2);
  }, [text, n, open]);
  return (
    <div className={`clamp-box ${className ?? ""}`}>
      <p ref={ref} className={`clamp-text ${open ? "" : "cut"}`} style={open ? undefined : { WebkitLineClamp: n }}>
        {text}
      </p>
      {(long || open) && (
        <button
          className="link-btn small"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}
