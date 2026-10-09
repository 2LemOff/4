import { db } from "../db";
import { go, hrefMap } from "../route";
import { useLive } from "../store";
import { Icon } from "./Icon";

/** Compact list of saved places; tapping one opens the map with that point selected. */
export function BookmarkList() {
  const data = useLive(async () => ({ bookmarks: await db.bookmarks.orderBy("createdAt").reverse().toArray(), sessions: await db.sessions.toArray() }), []);
  if (!data?.bookmarks.length) return null;
  const title = new Map(data.sessions.map((s) => [s.id, s.title]));
  return (
    <section aria-label="Bookmarks">
      <h2 className="section">Bookmarks</h2>
      {data.bookmarks.map((b) => (
        <div key={b.id} className="bookmark-row">
          <button className="row-btn compact grow" onClick={() => go(hrefMap(b.sessionId, { focus: b.cardId, node: b.nodeId }))}>
            <span className="row-line">
              <Icon name="bookmark" filled size={13} /> <strong>{b.label}</strong>
            </span>
            <span className="muted small">{title.get(b.sessionId) ?? ""}</span>
          </button>
          <button className="btn icon sm" aria-label={`Remove bookmark ${b.label}`} onClick={() => db.bookmarks.delete(b.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </section>
  );
}
