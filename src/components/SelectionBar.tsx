import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { makeAnchor, type TextAnchor } from "../anchors";
import { Icon } from "./Icon";

export interface SelectedText extends TextAnchor {
  cardId: string;
  /** the text read from a picture of the question ("img0"), not the answer */
  part?: string;
}

const elementOf = (n: Node) => (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement);

/** The current selection inside one finished answer, measured in that answer's rendered text. */
export function readSelection(): SelectedText | undefined {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return undefined;
  const range = sel.getRangeAt(0);
  const startBox = elementOf(range.startContainer)?.closest<HTMLElement>("[data-answer]");
  const box = startBox ?? elementOf(range.endContainer)?.closest<HTMLElement>("[data-answer]");
  if (!box?.dataset.answer) return undefined;
  const text = box.textContent ?? "";
  const at = (node: Node, offset: number) => {
    const r = document.createRange();
    r.setStart(box, 0);
    r.setEnd(node, offset);
    return r.toString().length;
  };
  // a selection that runs past the answer is clipped to it
  const start = startBox ? at(range.startContainer, range.startOffset) : 0;
  const end = box.contains(range.endContainer) ? at(range.endContainer, range.endOffset) : text.length;
  const a = makeAnchor(text, start, end);
  return a && { ...a, cardId: box.dataset.answer, ...(box.dataset.part ? { part: box.dataset.part } : {}) };
}

/**
 * Follows text selected in answers. Android clears the selection when a button is tapped, so the last
 * selection is kept while the bar is being pressed.
 */
export function useAnswerSelection() {
  const [sel, setSel] = useState<SelectedText>();
  const pressing = useRef(false);
  useEffect(() => {
    let timer: number | undefined;
    const onChange = () => {
      const info = readSelection();
      window.clearTimeout(timer);
      if (info) return setSel(info);
      if (pressing.current) return;
      timer = window.setTimeout(() => !pressing.current && setSel(undefined), 350);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      window.clearTimeout(timer);
    };
  }, []);
  const clear = useCallback(() => {
    pressing.current = false;
    window.getSelection()?.removeAllRanges();
    setSel(undefined);
  }, []);
  const press = useCallback(() => {
    pressing.current = true;
  }, []);
  const release = useCallback(() => {
    window.setTimeout(() => {
      pressing.current = false;
    }, 600);
  }, []);
  return { sel, clear, press, release };
}

/** One slim row above the question box while words in an answer are selected. */
export function SelectionBar({
  onMark,
  onAsk,
  onCopy,
  onClose,
  press,
  release,
  children,
}: {
  onMark: () => void;
  onAsk: () => void;
  onCopy: () => void;
  onClose: () => void;
  press: () => void;
  release: () => void;
  /** more actions (later: quick answer, check, council, visualize) */
  children?: ReactNode;
}) {
  return (
    <div
      className="selbar"
      role="toolbar"
      aria-label="Selected text"
      onPointerDown={(e) => {
        e.preventDefault();
        press();
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <button className="toolbtn" onClick={onMark}>
        <Icon name="highlight" size={17} />
        <span>Mark+</span>
      </button>
      <button className="toolbtn" onClick={onAsk}>
        <Icon name="up" size={17} />
        <span>Ask</span>
      </button>
      {children}
      <button className="toolbtn" onClick={onCopy}>
        <Icon name="copy" size={17} />
        <span>Copy</span>
      </button>
      <button className="toolbtn" aria-label="Close selection bar" onClick={onClose}>
        <Icon name="close" size={17} />
        <span aria-hidden>Close</span>
      </button>
    </div>
  );
}
