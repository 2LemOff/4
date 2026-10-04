import { db } from "../db";
import { go, hrefCard } from "../route";
import { useLive } from "../store";
import { outlineToMarkdown } from "../prompts";
import { runOutline, synthesize } from "../synthesis";

export function OutlineScreen({ id }: { id: string }) {
  const data = useLive(async () => {
    const outline = await db.outlines.get(id);
    if (!outline) return { outline: undefined, versions: [], session: undefined };
    return {
      outline,
      versions: (await db.outlines.where("sessionId").equals(outline.sessionId).toArray()).sort((a, b) => b.version - a.version),
      session: await db.sessions.get(outline.sessionId),
    };
  }, [id]);
  if (!data) return <div className="center muted">Loading…</div>;
  const { outline, versions, session } = data;
  if (!outline) return <div className="center"><p>This outline no longer exists.</p><a className="btn" href="#/library">Library</a></div>;

  const working = outline.status === "pending" || outline.status === "running";
  return (
    <div className="scroll pad">
      <div className="navrow">
        <button className="btn" onClick={() => go("#/library")}>↑ Library</button>
        {session && <button className="btn" onClick={() => go(hrefCard(session.id, session.lastCardId))}>Continue learning</button>}
      </div>
      {working && <p className="muted pulse" role="status">Synthesizing in the background…</p>}
      {outline.status === "error" && (
        <div className="notice error" role="alert">
          <p>{outline.error ?? "Synthesis failed."}</p>
          <button className="btn" onClick={() => runOutline(outline.id)}>Retry</button>
        </div>
      )}
      {outline.status === "done" && (
        <>
          <span className="btn chip on">{outline.category}</span>
          <h1>{outline.title}</h1>
          <p>{outline.summary}</p>
          {outline.sections.map((s, i) => (
            <section key={i}>
              <h2 className="section">{s.heading}</h2>
              <ul className="points">
                {s.points.map((p, j) => (
                  <li key={j}>
                    {p.text}{" "}
                    {p.cardIds.map((cid) => (
                      <button key={cid} className="btn chip src" aria-label="Open the card this came from" onClick={() => go(hrefCard(outline.sessionId, cid))}>
                        ↗
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="chips">
            <button className="btn" onClick={async () => go(`#/outline/${await synthesize(outline.sessionId)}`)}>Re-synthesize</button>
            <button className="btn" onClick={() => navigator.clipboard?.writeText(outlineToMarkdown(outline.title, outline.summary, outline.sections))}>Copy as Markdown</button>
          </div>
        </>
      )}
      {versions.length > 1 && (
        <label className="field">
          <span className="field-label">Version</span>
          <select className="input" value={outline.id} onChange={(e) => go(`#/outline/${e.target.value}`)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} · {new Date(v.createdAt).toLocaleString()} · {v.status}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
