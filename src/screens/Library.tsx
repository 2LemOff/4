import { db } from "../db";
import { BookmarkList } from "../components/BookmarkList";
import { go, hrefCard } from "../route";
import { useLive } from "../store";
import type { Outline } from "../types";

export function Library() {
  const data = useLive(async () => ({
    outlines: await db.outlines.toArray(),
    sessions: await db.sessions.orderBy("updatedAt").reverse().toArray(),
  }), []);
  if (!data) return <div className="center muted">Loading…</div>;

  // newest version per session
  const latest = new Map<string, Outline>();
  for (const o of data.outlines) {
    const cur = latest.get(o.sessionId);
    if (!cur || o.version > cur.version) latest.set(o.sessionId, o);
  }
  const byCategory = new Map<string, Outline[]>();
  for (const o of latest.values()) {
    if (o.status === "error" && !o.title) continue;
    const key = o.status === "done" ? o.category || "General" : "In progress";
    byCategory.set(key, [...(byCategory.get(key) ?? []), o]);
  }
  const unsynthesized = data.sessions.filter((s) => !latest.has(s.id) || latest.get(s.id)!.status === "error");
  const categories = [...byCategory.keys()].filter((k) => k !== "In progress").sort();

  return (
    <div className="scroll pad">
      <h1>Library</h1>
      <p className="muted small">Concept outlines, grouped by subject.</p>
      <BookmarkList />

      {byCategory.has("In progress") && (
        <>
          <h2 className="section">Synthesizing…</h2>
          {byCategory.get("In progress")!.map((o) => (
            <button key={o.id} className="row-btn" onClick={() => go(`#/outline/${o.id}`)}>
              <strong>{data.sessions.find((s) => s.id === o.sessionId)?.title ?? "Session"}</strong>
              <span className="muted small">{o.status === "error" ? "Failed" : "Working in the background"}</span>
            </button>
          ))}
        </>
      )}

      {categories.map((cat) => (
        <details key={cat} className="category" open>
          <summary>
            {cat} <span className="muted small">({byCategory.get(cat)!.length})</span>
          </summary>
          {byCategory.get(cat)!.map((o) => (
            <button key={o.id} className="row-btn" onClick={() => go(`#/outline/${o.id}`)}>
              <strong>{o.title}</strong>
              <span className="muted small">{o.summary.slice(0, 110)}</span>
            </button>
          ))}
        </details>
      ))}

      {!categories.length && !byCategory.has("In progress") && <p className="muted">No outlines yet. Press ✦ Synthesize on any card stack to create one.</p>}

      {!!unsynthesized.length && (
        <details className="category" open>
          <summary>Not synthesized yet <span className="muted small">({unsynthesized.length})</span></summary>
          {unsynthesized.map((s) => (
            <button key={s.id} className="row-btn" onClick={() => go(hrefCard(s.id, s.lastCardId))}>
              <strong>{s.title}</strong>
              <span className="muted small">{new Date(s.updatedAt).toLocaleDateString()}</span>
            </button>
          ))}
        </details>
      )}
    </div>
  );
}
