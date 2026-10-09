import { toggleBookmark } from "../bookmarks";
import { Icon } from "./Icon";

export function BookmarkButton({ on, sessionId, cardId, nodeId, label }: { on: boolean; sessionId: string; cardId: string; nodeId?: string; label: string }) {
  return (
    <button
      className={`btn icon sm ${on ? "on-plain" : ""}`}
      aria-label={on ? "Remove bookmark" : "Bookmark"}
      aria-pressed={on}
      onClick={() => toggleBookmark({ sessionId, cardId, nodeId, label: label.slice(0, 140) })}
    >
      <Icon name="bookmark" filled={on} />
    </button>
  );
}
