import { useEffect, useMemo, useState } from "react";
import { db } from "../db";
import { roleModel } from "../ai";
import { cardMarkdown } from "../answer";
import { ARRANGED_VIEWS, DIAGRAMS, VIEW_INFO, emptyDiagram, type ArrangedView, type DiagramType } from "../diagrams";
import { go, hrefChat, hrefVisual } from "../route";
import { streamStore, useLive, useStore } from "../store";
import { svgDataUri } from "../storyStyles";
import { highlightBranches } from "../tree";
import type { Card, Highlight, Visual } from "../types";
import { deleteVisual, ensureArrangement, ensureDiagram, ensureSketch, moreNeighbours, sentenceCard, setVisualNotes } from "../visuals";
import { AnswerText } from "../components/AnswerText";
import { Composer } from "../components/Composer";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { BigIdeaView, ChainView, LevelsView, MindMapView, OutlineList, StudyDoc, type Badge } from "../components/views/ArrangedViews";
import { DiagramView } from "../components/views/DiagramViews";

const NO_MARKS: never[] = [];

/** Badges per sentence: questions asked about words in it, council answers, saved answers. */
function sentenceBadges(v: Visual, cards: Card[], highlights: Highlight[], bookmarked: Set<string>): Map<string, Badge> {
  const counts = highlightBranches(cards);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out = new Map<string, Badge>();
  for (const s of v.sentences) {
    const cardId = sentenceCard(v, s, highlights);
    const c = byId.get(cardId);
    let branches = 0;
    if (v.scope.kind === "highlight" || v.scope.kind === "highlights") branches = counts.get(s.source) ?? 0;
    else
      for (const h of highlights)
        if (h.cardId === cardId && (s.text.includes(h.quote) || h.quote.includes(s.text))) branches += counts.get(h.id) ?? 0;
    out.set(s.id, { branches, council: c?.mode === "council", bookmarked: bookmarked.has(cardId) });
  }
  return out;
}

/** A visual of an answer or a selection, in any of its views. Tap anything to see the exact sentences. */
export function VisualScreen({ id, view }: { id: string; view: string }) {
  const v = useLive(() => db.visuals.get(id), [id]);
  const extra = useLive(
    async () =>
      v
        ? {
            cards: await db.cards.where("sessionId").equals(v.sessionId).toArray(),
            highlights: await db.highlights.where("sessionId").equals(v.sessionId).toArray(),
            bookmarks: await db.bookmarks.where("sessionId").equals(v.sessionId).toArray(),
          }
        : undefined,
    [v?.sessionId],
  );
  const streams = useStore(streamStore);
  const [detail, setDetail] = useState<{ title: string; ids: string[] }>();
  const [ghost, setGhost] = useState<{ name: string; level: string }>();
  const [diagramsOpen, setDiagramsOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const kind = VIEW_INFO[view as ArrangedView]?.kind ?? "arranged";

  // make what this view needs (once; it's saved)
  useEffect(() => {
    if (!v) return;
    if (kind === "arranged" && !v.arrangement) void ensureArrangement(v.id);
    if (kind === "diagram" && !v.diagrams[view as DiagramType]) void ensureDiagram(v.id, view as DiagramType);
    if (view === "sketch" && !v.sketch) void ensureSketch(v.id);
  }, [v?.id, view, kind, !!v]); // eslint-disable-line react-hooks/exhaustive-deps

  const badges = useMemo(
    () => (v && extra ? sentenceBadges(v, extra.cards, extra.highlights, new Set(extra.bookmarks.filter((b) => !b.nodeId).map((b) => b.cardId))) : new Map<string, Badge>()),
    [v, extra],
  );

  if (v === undefined) return <div className="center muted">Loading…</div>;
  if (!v) {
    return (
      <div className="center">
        <p>This visual no longer exists.</p>
        <a className="btn" href="#/">Home</a>
      </div>
    );
  }

  const sid = v.sessionId;
  const text = new Map(v.sentences.map((s) => [s.id, s]));
  const onOpen = (title: string, ids: string[]) => setDetail({ title, ids: ids.filter((x) => text.has(x)) });
  const askChat = (ask: string) => go(hrefChat(sid, { focus: v.cardId, ask }));
  const a = v.arrangement?.data;
  const diagram = kind === "diagram" ? v.diagrams[view as DiagramType] : undefined;
  const rebuild = () => {
    setMenu(false);
    if (kind === "arranged") void ensureArrangement(v.id, true);
    else if (kind === "diagram") void ensureDiagram(v.id, view as DiagramType, true);
    else if (view === "sketch") void ensureSketch(v.id, true);
  };
  const working = (s?: { status: string }) => !s || s.status === "running";
  const sideCards = (extra?.cards ?? []).filter((c) => c.fromVisual === v.id).sort((x, y) => x.createdAt - y.createdAt);

  const body = () => {
    if (kind === "arranged") {
      if (working(v.arrangement) && !a) return <p className="muted pulse center" role="status">Arranging {v.sentences.length} sentences…</p>;
      if (!a) return null;
      const props = { a, sentences: v.sentences, badges, onOpen };
      return (
        <>
          {v.arrangement?.error && (
            <div className="notice small" role="status">
              {a.fallback ? "Arranged from the headings only" : "Note"}: {v.arrangement.error}{" "}
              <button className="btn chip" onClick={rebuild}>Try again</button>
            </div>
          )}
          {view === "bigidea" && <BigIdeaView {...props} />}
          {view === "levels" && (
            <LevelsView
              {...props}
              onGhost={(name, level) => setGhost({ name, level })}
              onAskLevel={(name) => askChat(`How does this fit within ${name}?`)}
              onMore={(i) => moreNeighbours(v.id, i)}
              onCompare={(x, y) => askChat(`Compare ${x} and ${y}.`)}
            />
          )}
          {view === "mindmap" && <MindMapView {...props} />}
          {view === "chain" && <ChainView {...props} />}
          {view === "outline" && <OutlineList {...props} />}
          {view === "doc" && (
            <StudyDoc
              {...props}
              notes={v.notes ?? ""}
              onNotes={(t) => void setVisualNotes(v.id, t)}
              side={
                <section className="side-chat" aria-label="Side chat">
                  <h3 className="vgroup-title">Side chat</h3>
                  <p className="muted small">Questions asked here continue the topic as a branch, and the answers show here.</p>
                  {sideCards.map((c) => (
                    <div key={c.id} className="turn">
                      <div className="msg-user">
                        <div className="bubble">{c.question}</div>
                      </div>
                      <div className="msg-ai">
                        {c.status === "streaming" && !streams[c.id]?.content ? (
                          <p className="muted pulse small">Answering…</p>
                        ) : (
                          <AnswerText cardId={c.id} markdown={c.status === "streaming" ? streams[c.id]?.content ?? "" : cardMarkdown(c)} marks={NO_MARKS} selectable={false} />
                        )}
                      </div>
                    </div>
                  ))}
                  <Composer
                    sessionId={sid}
                    parentId={sideCards.at(-1)?.id ?? v.cardId}
                    placeholder="Ask about this doc…"
                    defaultModel={extra?.cards.find((c) => c.id === v.cardId)?.model ?? roleModel("answer")}
                    sendIcon
                    fromVisual={v.id}
                    onAsked={() => {}}
                  />
                </section>
              }
            />
          )}
        </>
      );
    }
    if (kind === "diagram") {
      if (working(diagram)) return <p className="muted pulse center" role="status">Drawing the {VIEW_INFO[view as DiagramType].label.toLowerCase()}…</p>;
      if (diagram?.status === "error") return <div className="notice error" role="alert"><p>{diagram.error}</p><button className="btn sm" onClick={rebuild}>Try again</button></div>;
      if (!diagram?.spec || emptyDiagram(diagram.spec)) return <div className="notice"><p>This text doesn't have what a {VIEW_INFO[view as DiagramType].label.toLowerCase()} needs.</p><button className="btn sm" onClick={rebuild}>Try again</button></div>;
      return <DiagramView type={view as DiagramType} spec={diagram.spec} sentences={v.sentences} onOpen={onOpen} />;
    }
    if (view === "sketch") {
      if (working(v.sketch)) return <p className="muted pulse center" role="status">Drawing…</p>;
      if (v.sketch?.status === "error" || !v.sketch?.svg) return <div className="notice error" role="alert"><p>{v.sketch?.error}</p><button className="btn sm" onClick={rebuild}>Try again</button></div>;
      return (
        <figure className="sketch">
          <img src={svgDataUri(v.sketch.svg)} alt={`A sketch of ${v.scope.label}`} />
        </figure>
      );
    }
    return null;
  };

  const ids = detail?.ids ?? [];
  const cardOf = (sidx: string) => (extra ? sentenceCard(v, text.get(sidx)!, extra.highlights) : v.cardId);

  return (
    <>
      <header className="chat-bar">
        <button className="btn icon sm" aria-label="Back to the chat" onClick={() => go(hrefChat(sid, { focus: v.cardId }))}>
          <Icon name="back" />
        </button>
        <span className="chat-title">{v.scope.label}</span>
        <button className="btn icon sm" aria-label="Visual menu" onClick={() => setMenu(true)}>
          <Icon name="more" />
        </button>
      </header>
      <div className="view-tabs" role="tablist" aria-label="Views">
        {ARRANGED_VIEWS.map((x) => (
          <button key={x} role="tab" aria-selected={view === x} className={`btn chip ${view === x ? "on" : ""}`} onClick={() => go(hrefVisual(v.id, x))}>
            {VIEW_INFO[x].label}
          </button>
        ))}
        <button role="tab" aria-selected={kind !== "arranged"} className={`btn chip ${kind !== "arranged" ? "on" : ""}`} onClick={() => setDiagramsOpen(true)}>
          {kind !== "arranged" ? VIEW_INFO[view as DiagramType].label : "Diagrams"} ▾
        </button>
      </div>
      <div className="scroll visual-body">{body()}</div>

      {detail && (
        <Sheet title={detail.title} onClose={() => setDetail(undefined)}>
          {ids.map((x) => (
            <blockquote key={x} className="quote-block">{text.get(x)!.text}</blockquote>
          ))}
          {!ids.length && <p className="muted small">No sentence was given for this.</p>}
          {ids.length > 0 && (
            <div className="chips">
              <button className="btn chip" onClick={() => go(hrefChat(sid, { focus: cardOf(ids[0]), quote: ids.map((x) => text.get(x)!.text).join(" ").slice(0, 800) }))}>
                Ask about this
              </button>
              <button className="btn chip" onClick={() => go(hrefChat(sid, { focus: cardOf(ids[0]), find: text.get(ids[0])!.text }))}>
                Show in the answer
              </button>
            </div>
          )}
        </Sheet>
      )}
      {ghost && (
        <Sheet title={ghost.name} onClose={() => setGhost(undefined)}>
          <p className="muted small">A neighbour of {ghost.level} that you haven't asked about yet.</p>
          <div className="chips">
            <button className="btn chip" onClick={() => askChat(`What is ${ghost.name}, and how does it relate to ${ghost.level}?`)}>Ask about it</button>
          </div>
        </Sheet>
      )}
      {diagramsOpen && (
        <Sheet title="Diagrams and pictures" onClose={() => setDiagramsOpen(false)}>
          {[...DIAGRAMS, "sketch" as const].map((d) => (
            <button key={d} className={`row-btn ${view === d ? "on" : ""}`} onClick={() => (setDiagramsOpen(false), go(hrefVisual(v.id, d)))}>
              <strong>{VIEW_INFO[d].label}</strong>
              <span className="muted small">
                {VIEW_INFO[d].about}
                {(d === "sketch" ? v.sketch?.status === "done" : v.diagrams[d]?.status === "done") ? " · saved" : ""}
              </span>
            </button>
          ))}
        </Sheet>
      )}
      {menu && (
        <Sheet title="Visual" onClose={() => setMenu(false)}>
          <button className="row-btn" onClick={rebuild}>Make this view again</button>
          <button
            className="row-btn danger"
            onClick={async () => {
              if (!confirm("Delete this visual and its diagrams? The answers stay.")) return;
              await deleteVisual(v.id);
              go(hrefChat(sid, { focus: v.cardId }));
            }}
          >
            Delete this visual
          </button>
        </Sheet>
      )}
    </>
  );
}
