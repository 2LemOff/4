import type { ReactNode } from "react";
import { short } from "../answer";
import { Icon } from "./Icon";

export interface TrayItem {
  key: string;
  quote: string;
}

/** Highlights collected for one question, shown above the question box only while there are any. */
export function HighlightTray({
  items,
  onShow,
  onRemove,
  onClear,
  children,
}: {
  items: TrayItem[];
  onShow: (key: string) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  /** more actions for the whole tray (later phases) */
  children?: ReactNode;
}) {
  if (!items.length) return null;
  return (
    <div className="tray" role="group" aria-label="Highlights in your question">
      <div className="tray-items">
        {items.map((it, i) => (
          <span key={it.key} className="tray-chip">
            <button className="btn chip" onClick={() => onShow(it.key)} title={it.quote}>
              <span className="tray-n">{i + 1}</span> {short(it.quote, 26)}
            </button>
            <button className="btn icon sm" aria-label={`Remove highlight ${i + 1} from the question`} onClick={() => onRemove(it.key)}>
              <Icon name="close" size={13} />
            </button>
          </span>
        ))}
      </div>
      <div className="tray-actions">
        {children}
        <button className="toolbtn" onClick={onClear}>
          <Icon name="close" size={17} />
          <span>Clear</span>
        </button>
      </div>
    </div>
  );
}
