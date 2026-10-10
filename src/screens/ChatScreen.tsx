import { useEffect, useMemo, useRef, useState, type MouseEvent, type UIEvent } from "react";
import { db } from "../db";
import { cardPrefix, deleteBranch, roleModel, startFreshBranch } from "../ai";
import { outlineText, parseAnswer, short } from "../answer";
import { bookmarkKey, toggleBookmark } from "../bookmarks";
import { branchTokens } from "../context";
import { deleteHighlight, saveHighlight } from "../highlights";
import { usesPyramids } from "../prompts";
import { go, hrefChat, hrefMap } from "../route";
import { modelInfo, modelsStore, streamStore, useLive, useStore, type StreamView } from "../store";
import { synthesize } from "../synthesis";
import { highlightBranches, indexCards, leafFrom, pathToRoot, siblings, type CardIndex } from "../tree";
import { AnswerText, type AnswerMark } from "../components/AnswerText";
import { BranchSheet } from "../components/BranchSheet";
import { Composer } from "../components/Composer";
import { ContextMeter } from "../components/ContextMeter";
import { CouncilEditor } from "../components/CouncilEditor";
import { CouncilPanel } from "../components/CouncilPanel";
import { HighlightTray, type TrayItem } from "../components/HighlightTray";
import { Icon } from "../components/Icon";
import { shortName } from "../components/ModelPicker";
import { ReasoningPanel } from "../components/ReasoningPanel";
import { RetryNotice } from "../components/RetryNotice";
import { SearchSheet } from "../components/SearchSheet";
import { SelectionBar, useAnswerSelection } from "../components/SelectionBar";
import { Sheet } from "../components/Sheet";
import { StoryStartSheet } from "../components/StoryStartSheet";
import { VisualizeSheet } from "../components/VisualizeSheet";
import type { Anchor, Card, Highlight, VisualScope } from "../types";
import { scopeCards } from "../visuals";
import { hrefVisual } from "../route";

const NO_MARKS: AnswerMark[] = [];
const NO_CARDS: Card[] = [];
const NO_HIGHLIGHTS: Highlight[] = [];

const councilKey = (sid: string) => `fractal.council.${sid}`;
function readCouncil(sid: string): boolean {
  try {
    return localStorage.getItem(councilKey(sid)) === "1";
  } catch {
    return false;
  }
}

/** The text shown for an answer: exactly what the model wrote, or a pyramid answer as a readable outline. */
export function answerMarkdown(c: Card, live: StreamView | undefined, pyramid: boolean): string {
  if (c.status === "streaming") {
    if (!live) return "";
    return pyramid ? outlineText(parseAnswer(live.content, cardPrefix(c), { partial: true })) : live.content;
  }
  if (c.answer && !c.answer.converted) return outlineText(c.answer);
  return c.assistant?.content || c.blocks.join("\n\n");
}

/**
 * The main screen of a topic: a classic chat of one branch, from the first question to the latest answer.
 * Select words in an answer to highlight them; highlights collect in a tray and are asked about in one prompt,
 * which starts a branch under the answer they come from.
 */
export function ChatScreen({ sid, focus, find, quote, ask }: { sid: string; focus?: string; find?: string; quote?: string; ask?: string }) {
  const data = useLive(async () => ({
    session: await db.sessions.get(sid),
    cards: await db.cards.where("sessionId").equals(sid).toArray(),
    highlights: await db.highlights.where("sessionId").equals(sid).toArray(),
    bookmarks: await db.bookmarks.where("sessionId").equals(sid).toArray(),
    visuals: await db.visuals.where("sessionId").equals(sid).toArray(),
  }), [sid]);
  const streams = useStore(streamStore);
  useStore(modelsStore);
  const [tray, setTray] = useState<string[]>([]);
  const [askQuote, setAskQuote] = useState(quote);
  useEffect(() => setAskQuote(quote), [quote]);
  const [flash, setFlash] = useState(find);
  useEffect(() => {
    setFlash(find);
    if (!find) return;
    const t = window.setTimeout(() => setFlash(undefined), 5000);
    return () => window.clearTimeout(t);
  }, [find]);
  const [barHidden, setBarHidden] = useState(false);
  const lastTop = useRef(0);
  const [menu, setMenu] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [answerMenu, setAnswerMenu] = useState<string>();
  const [openHighlight, setOpenHighlight] = useState<string>();
  const [storyFor, setStoryFor] = useState<string>();
  const [visualize, setVisualize] = useState<{ cardId: string; scope: VisualScope }>();
  const [visualsFor, setVisualsFor] = useState<string>();
  const [toast, setToast] = useState("");
  const [councilOn, setCouncilOn] = useState(() => readCouncil(sid));
  const [councilSheet, setCouncilSheet] = useState(false);
  const [forceModel, setForceModel] = useState<{ id: string; n: number }>();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { sel, clear: clearSel, press, release } = useAnswerSelection();

  const cards = data?.cards ?? NO_CARDS;
  const highlights = data?.highlights ?? NO_HIGHLIGHTS;
  const session = data?.session;
  const idx = useMemo(() => indexCards(cards), [cards]);
  const start = focus && idx.has(focus) ? focus : session && idx.has(session.lastCardId) ? session.lastCardId : cards[cards.length - 1]?.id;
  const leafId = start ? leafFrom(idx, start, session?.lastCardId) : undefined;
  const path = useMemo(() => (leafId ? pathToRoot(idx, leafId) : []), [idx, leafId]);
  const pathIndex = useMemo(() => new Map(path.map((c, i) => [c.id, i])), [path]);

  // remember the branch on screen, so the topic reopens here
  useEffect(() => {
    if (session && leafId && session.lastCardId !== leafId) void db.sessions.update(sid, { lastCardId: leafId });
  }, [session, leafId, sid]);

  // open at the asked-about answer (or the latest one), its question at the top
  const target = focus && idx.has(focus) ? focus : leafId;
  const scrolledTo = useRef<string>(undefined);
  useEffect(() => {
    if (!target || scrolledTo.current === target) return;
    const el = document.querySelector(`[data-card-id="${CSS.escape(target)}"]`);
    if (!el) return;
    scrolledTo.current = target;
    el.scrollIntoView({ block: "start" });
  });

  const counts = useMemo(() => highlightBranches(cards), [cards]);
  const hlById = useMemo(() => new Map(highlights.map((h) => [h.id, h])), [highlights]);
  const trayIds = useMemo(() => new Set(tray), [tray]);
  const marksByCard = useMemo(() => {
    const m = new Map<string, AnswerMark[]>();
    for (const h of highlights) {
      const n = counts.get(h.id) ?? 0;
      const list = m.get(h.cardId) ?? [];
      list.push({ ...h, className: trayIds.has(h.id) ? "picked" : undefined, badge: n ? `↳ ${n}` : undefined });
      m.set(h.cardId, list);
    }
    return m;
  }, [highlights, counts, trayIds]);

  if (!data) return <div className="center muted">Loading…</div>;
  if (!session || !leafId) {
    return (
      <div className="center">
        <p>This topic no longer exists.</p>
        <a className="btn" href="#/">Home</a>
      </div>
    );
  }
  const pyramid = usesPyramids(session.systemPrompt);

  // what the next question is about: the highlights in the tray (on this branch) and a quote passed in
  const trayHs = tray.map((id) => hlById.get(id)).filter((h): h is Highlight => !!h && pathIndex.has(h.cardId));
  const quoteCard = askQuote && focus && pathIndex.has(focus) ? focus : undefined;
  const quotes = [...trayHs.map((h) => h.quote), ...(askQuote ? [askQuote] : [])];
  let anchor: Anchor | undefined;
  let parentId: string = leafId;
  if (quotes.length) {
    anchor = { text: quotes.join(" / "), quotes, scope: "highlights", highlightIds: trayHs.length ? trayHs.map((h) => h.id) : undefined };
    const owners = [...trayHs.map((h) => h.cardId), ...(quoteCard ? [quoteCard] : [])];
    if (owners.length) parentId = owners.reduce((a, b) => (pathIndex.get(b)! > pathIndex.get(a)! ? b : a));
  }
  const trayItems: TrayItem[] = [...trayHs.map((h) => ({ key: h.id, quote: h.quote })), ...(askQuote ? [{ key: "quote", quote: askQuote }] : [])];

  const setCouncil = (on: boolean) => {
    setCouncilOn(on);
    try {
      localStorage.setItem(councilKey(sid), on ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const addSelection = async (thenAsk: boolean) => {
    if (!sel) return;
    // let go of the selection at once (so the next one can start) and open the keyboard within the tap
    const picked = sel;
    clearSel();
    if (thenAsk) inputRef.current?.focus();
    const h = await saveHighlight({ ...picked, sessionId: sid });
    setTray((t) => (t.includes(h.id) ? t : [...t, h.id]));
  };

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    const d = top - lastTop.current;
    if (d > 6 && top > 48) setBarHidden(true);
    else if (d < -6 || top < 8) setBarHidden(false);
    lastTop.current = top;
  };

  // tapping a highlight opens it (not while selecting text)
  const onThreadClick = (e: MouseEvent<HTMLDivElement>) => {
    const mark = (e.target as Element).closest?.("mark[data-h]") as HTMLElement | null;
    if (!mark || window.getSelection()?.isCollapsed === false) return;
    const found = (mark.dataset.h ?? "").split(" ").map((id) => hlById.get(id)).filter((h): h is Highlight => !!h);
    if (found.length) setOpenHighlight(found.sort((a, b) => a.quote.length - b.quote.length)[0].id);
  };

  const fresh = async (cid: string) => {
    setAnswerMenu(undefined);
    setToast("Summarizing this branch…");
    try {
      const id = await startFreshBranch(cid);
      setToast("");
      go(hrefChat(sid, { focus: id }));
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
  };

  const sideBranch = [...path].reverse().find((c) => {
    const s = siblings(idx, c.id);
    return s.length > 1 && s[0].id !== c.id;
  });
  const title = sideBranch
    ? `↳ ${sideBranch.anchor?.quotes?.[0] ? `“${short(sideBranch.anchor.quotes[0], 48)}”` : short(sideBranch.question, 48)}`
    : session.title;
  const bookmarkKeys = new Set(data.bookmarks.map((b) => bookmarkKey(b.cardId, b.nodeId)));
  const menuCard = answerMenu ? idx.get(answerMenu) : undefined;
  const hl = openHighlight ? hlById.get(openHighlight) : undefined;

  return (
    <>
      <div className="chat" onScroll={onScroll}>
        <header className={`chat-bar ${barHidden ? "hide" : ""}`}>
          <button className="btn icon sm" aria-label="Home" onClick={() => go("#/")}>
            <Icon name="back" />
          </button>
          <button className="chat-title" onClick={() => setBranchesOpen(true)} title="Branches">
            {title}
          </button>
          <button className="btn icon sm" aria-label="Topic menu" onClick={() => setMenu(true)}>
            <Icon name="more" />
          </button>
        </header>
        <div className="thread" onClick={onThreadClick}>
          {path.map((c) => (
            <Turn
              key={c.id}
              card={c}
              idx={idx}
              sid={sid}
              live={streams[c.id]}
              pyramid={pyramid}
              marks={marksByCard.get(c.id) ?? NO_MARKS}
              find={c.id === focus ? flash : undefined}
              onMenu={setAnswerMenu}
              visuals={data.visuals.filter((x) => x.cardId === c.id).length}
              onVisualize={() => setVisualize({ cardId: c.id, scope: { kind: "answer", cardIds: [c.id], label: short(c.question, 60) } })}
              onVisuals={() => setVisualsFor(c.id)}
              onContinue={(m) => {
                setCouncil(false);
                setForceModel({ id: m, n: Date.now() });
              }}
            />
          ))}
        </div>
      </div>

      <div className="dock chat-dock">
        {toast && <p className="muted small" role="status">{toast}</p>}
        {sel ? (
          <SelectionBar
            onMark={() => void addSelection(false)}
            onAsk={() => void addSelection(true)}
            onCopy={() => {
              void navigator.clipboard?.writeText(sel.quote);
              clearSel();
            }}
            onClose={clearSel}
            press={press}
            release={release}
          >
            <button
              className="btn chip"
              onClick={async () => {
                const picked = sel;
                clearSel();
                const h = await saveHighlight({ ...picked, sessionId: sid });
                setVisualize({ cardId: h.cardId, scope: { kind: "highlight", cardIds: [h.cardId], highlightIds: [h.id], label: `“${short(h.quote, 50)}”` } });
              }}
            >
              <Icon name="visualize" size={15} /> Visualize
            </button>
          </SelectionBar>
        ) : (
          <HighlightTray
            items={trayItems}
            onShow={(key) => {
              const el = key === "quote" ? document.querySelector(`[data-card-id="${CSS.escape(focus ?? leafId)}"]`) : document.querySelector(`mark[data-h~="${CSS.escape(key)}"]`);
              el?.scrollIntoView({ block: "center", behavior: "smooth" });
            }}
            onRemove={(key) => (key === "quote" ? setAskQuote(undefined) : setTray((t) => t.filter((x) => x !== key)))}
            onClear={() => (setTray([]), setAskQuote(undefined))}
          >
            {trayHs.length > 0 && (
              <button
                className="btn chip"
                onClick={() => {
                  const owner = trayHs.reduce((x, y) => (pathIndex.get(y.cardId)! > pathIndex.get(x.cardId)! ? y : x)).cardId;
                  setVisualize({
                    cardId: owner,
                    scope: { kind: trayHs.length > 1 ? "highlights" : "highlight", cardIds: [...new Set(trayHs.map((h) => h.cardId))], highlightIds: trayHs.map((h) => h.id), label: trayHs.length > 1 ? `${trayHs.length} highlights` : `“${short(trayHs[0].quote, 50)}”` },
                  });
                }}
              >
                <Icon name="visualize" size={15} /> Visualize
              </button>
            )}
          </HighlightTray>
        )}
        <Composer
          sessionId={sid}
          parentId={parentId}
          anchor={anchor}
          placeholder={quotes.length > 1 ? "Ask about these…" : quotes.length ? "Ask about this…" : "Ask anything…"}
          sendIcon
          initialText={ask}
          defaultModel={idx.get(parentId)?.model ?? roleModel("answer")}
          inputRef={inputRef}
          council={councilOn}
          onCouncilToggle={() => setCouncil(!councilOn)}
          onCouncilSettings={() => setCouncilSheet(true)}
          forceModel={forceModel}
          onAsked={(r) => {
            setTray([]);
            setAskQuote(undefined);
            go(hrefChat(r.sessionId, { focus: r.cardId }));
          }}
        />
      </div>

      {menu && (
        <Sheet title="Topic" onClose={() => setMenu(false)}>
          <button className="row-btn" onClick={() => (setMenu(false), setBranchesOpen(true))}>
            <span className="row-line"><Icon name="branch" size={16} /> Branches</span>
          </button>
          <button className="row-btn" onClick={() => (setMenu(false), setSearchOpen(true))}>
            <span className="row-line"><Icon name="search" size={16} /> Search by concept</span>
          </button>
          <button
            className="row-btn"
            onClick={() => (setMenu(false), setVisualize({ cardId: leafId, scope: { kind: "branch", cardIds: scopeCards("branch", cards, leafId), label: "This branch" } }))}
          >
            <span className="row-line"><Icon name="visualize" size={16} /> Visualize this branch</span>
          </button>
          <button
            className="row-btn"
            onClick={() => (setMenu(false), setVisualize({ cardId: leafId, scope: { kind: "topic", cardIds: scopeCards("topic", cards, leafId), label: `The whole topic: ${short(session.title, 40)}` } }))}
          >
            <span className="row-line"><Icon name="visualize" size={16} /> Visualize the whole topic</span>
          </button>
          <button
            className="row-btn"
            onClick={async () => {
              setMenu(false);
              await synthesize(sid);
              setToast("Synthesizing in the background. See Library.");
              window.setTimeout(() => setToast(""), 5000);
            }}
          >
            <span className="row-line"><Icon name="sparkle" size={16} /> Synthesize this topic</span>
          </button>
          <button className="row-btn" onClick={() => go(hrefMap(sid, { focus: leafId }))}>
            <span className="row-line"><Icon name="map" size={16} /> Open the old map</span>
          </button>
          <details className="row-btn">
            <summary>System prompt used by this topic</summary>
            <pre className="prompt-pre">{session.systemPrompt}</pre>
          </details>
          <button className="row-btn" onClick={() => go("#/settings")}>
            <span className="row-line"><Icon name="settings" size={16} /> Settings</span>
          </button>
        </Sheet>
      )}
      {branchesOpen && (
        <BranchSheet
          idx={idx}
          path={new Set(path.map((c) => c.id))}
          onPick={(id) => {
            setBranchesOpen(false);
            go(hrefChat(sid, { focus: id }));
          }}
          onClose={() => setBranchesOpen(false)}
        />
      )}
      {menuCard && (
        <AnswerSheet
          card={menuCard}
          idx={idx}
          bookmarked={bookmarkKeys.has(bookmarkKey(menuCard.id))}
          onFresh={() => fresh(menuCard.id)}
          onStory={() => (setStoryFor(menuCard.id), setAnswerMenu(undefined))}
          onClose={() => setAnswerMenu(undefined)}
        />
      )}
      {hl && (
        <HighlightSheet
          h={hl}
          inTray={trayIds.has(hl.id)}
          branches={cards.filter((c) => c.anchor?.highlightIds?.includes(hl.id))}
          onToggle={() => setTray((t) => (t.includes(hl.id) ? t.filter((x) => x !== hl.id) : [...t, hl.id]))}
          onOpen={(id) => (setOpenHighlight(undefined), go(hrefChat(sid, { focus: id })))}
          onDelete={async () => {
            setOpenHighlight(undefined);
            setTray((t) => t.filter((x) => x !== hl.id));
            await deleteHighlight(hl.id);
          }}
          onClose={() => setOpenHighlight(undefined)}
        />
      )}
      {storyFor && <StoryStartSheet sessionId={sid} cardId={storyFor} onClose={() => setStoryFor(undefined)} />}
      {visualize && <VisualizeSheet sessionId={sid} cardId={visualize.cardId} scope={visualize.scope} onClose={() => setVisualize(undefined)} />}
      {visualsFor && (
        <Sheet title="Visuals of this answer" onClose={() => setVisualsFor(undefined)}>
          {data.visuals
            .filter((x) => x.cardId === visualsFor)
            .map((x) => (
              <button key={x.id} className="row-btn" onClick={() => go(hrefVisual(x.id, x.arrangement ? "bigidea" : Object.keys(x.diagrams)[0] ?? "bigidea"))}>
                <strong>{x.scope.label}</strong>
                <span className="muted small">{new Date(x.createdAt).toLocaleDateString()} · {x.sentences.length} sentences</span>
              </button>
            ))}
        </Sheet>
      )}
      {searchOpen && (
        <SearchSheet
          onClose={() => setSearchOpen(false)}
          onPick={(r, card) => go(hrefChat(card.sessionId, { focus: card.id, find: r.text }))}
        />
      )}
      {councilSheet && (
        <Sheet title="LLM Council" onClose={() => setCouncilSheet(false)}>
          <CouncilEditor />
          <button className="btn primary" onClick={() => setCouncilSheet(false)}>Done</button>
        </Sheet>
      )}
    </>
  );
}

/** One question and its answer. */
function Turn({
  card,
  idx,
  sid,
  live,
  pyramid,
  marks,
  find,
  onMenu,
  visuals,
  onVisualize,
  onVisuals,
  onContinue,
}: {
  card: Card;
  idx: CardIndex;
  sid: string;
  live?: StreamView;
  pyramid: boolean;
  marks: AnswerMark[];
  find?: string;
  onMenu: (id: string) => void;
  visuals: number;
  onVisualize: () => void;
  onVisuals: () => void;
  onContinue: (model: string) => void;
}) {
  const sibs = siblings(idx, card.id);
  const i = sibs.findIndex((s) => s.id === card.id);
  const quotes = card.anchor?.quotes?.length ? card.anchor.quotes : card.anchor ? [card.anchor.text] : [];
  const streaming = card.status === "streaming";
  const md = answerMarkdown(card, live, pyramid);
  return (
    <section className="turn">
      <div className="msg-user" data-card-id={card.id}>
        {quotes.map((q, k) => (
          <p key={k} className="quote-line">{q}</p>
        ))}
        <div className="bubble">{card.question}</div>
        {sibs.length > 1 && (
          <div className="sibs" role="group" aria-label="Other questions asked here">
            <button className="btn icon sm" aria-label="Previous branch" disabled={i <= 0} onClick={() => go(hrefChat(sid, { focus: sibs[i - 1].id }))}>
              <Icon name="prev" size={15} />
            </button>
            <span className="small muted">{i + 1}/{sibs.length}</span>
            <button className="btn icon sm" aria-label="Next branch" disabled={i >= sibs.length - 1} onClick={() => go(hrefChat(sid, { focus: sibs[i + 1].id }))}>
              <Icon name="next" size={15} />
            </button>
          </div>
        )}
      </div>
      <div className="msg-ai">
        {streaming && <ReasoningPanel assistant={card.assistant} live={live?.reasoning} />}
        {md ? (
          <AnswerText cardId={card.id} markdown={md} marks={marks} find={find} selectable={!streaming} />
        ) : streaming ? (
          <p className="muted pulse" role="status">Answering…</p>
        ) : null}
        <RetryNotice card={card} />
        {card.council && <CouncilPanel council={card.council} onContinue={onContinue} />}
        {!streaming && (
          <div className="answer-foot">
            <button className="btn icon sm" aria-label="Visualize this answer" onClick={onVisualize}>
              <Icon name="visualize" size={16} />
            </button>
            {visuals > 0 && (
              <button className="btn chip small-chip" onClick={onVisuals}>
                Visuals ({visuals})
              </button>
            )}
            <button className="btn icon sm" aria-label="Copy answer" onClick={() => void navigator.clipboard?.writeText(md)}>
              <Icon name="copy" size={16} />
            </button>
            <button className="btn icon sm" aria-label="Answer details" onClick={() => onMenu(card.id)}>
              <Icon name="more" size={16} />
            </button>
            <span className="muted small ellipsis">
              {shortName(card.model)}
              {card.usage?.cost !== undefined ? ` · $${card.usage.cost.toFixed(4)}` : ""}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function AnswerSheet({
  card,
  idx,
  bookmarked,
  onFresh,
  onStory,
  onClose,
}: {
  card: Card;
  idx: CardIndex;
  bookmarked: boolean;
  onFresh: () => void;
  onStory: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Answer" onClose={onClose}>
      <p className="small muted">
        {shortName(card.model)}
        {card.usage?.cost !== undefined ? ` · $${card.usage.cost.toFixed(4)}` : ""}
        {card.usage?.reasoning ? ` · ${card.usage.reasoning.toLocaleString()} reasoning tokens` : ""}
      </p>
      <ReasoningPanel assistant={card.assistant} />
      <ContextMeter used={branchTokens(idx, card.id)} limit={modelInfo(card.model).context_length ?? 0} onFresh={onFresh} />
      <button
        className="row-btn"
        aria-pressed={bookmarked}
        onClick={() => void toggleBookmark({ sessionId: card.sessionId, cardId: card.id, label: (card.tag ?? card.question).slice(0, 140) })}
      >
        <span className="row-line">
          <Icon name="bookmark" filled={bookmarked} size={16} /> {bookmarked ? "Remove bookmark" : "Bookmark this answer"}
        </span>
      </button>
      <button className="row-btn" onClick={onStory}>
        <span className="row-line"><Icon name="story" size={16} /> Learn as a story…</span>
      </button>
      <button className="row-btn" onClick={() => go(hrefMap(card.sessionId, { focus: card.id }))}>
        <span className="row-line"><Icon name="map" size={16} /> Open in the old map</span>
      </button>
      <button
        className="row-btn danger"
        onClick={async () => {
          if (!confirm("Delete this question, its answer and every question below it?")) return;
          const r = await deleteBranch(card.id);
          onClose();
          go(r.next ? hrefChat(r.sessionId, { focus: r.next }) : "#/");
        }}
      >
        Delete this answer and its branches
      </button>
    </Sheet>
  );
}

function HighlightSheet({
  h,
  inTray,
  branches,
  onToggle,
  onOpen,
  onDelete,
  onClose,
}: {
  h: Highlight;
  inTray: boolean;
  branches: Card[];
  onToggle: () => void;
  onOpen: (cardId: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Highlight" onClose={onClose}>
      <blockquote className="quote-block">{h.quote}</blockquote>
      <button className="row-btn" onClick={() => (onToggle(), onClose())}>
        {inTray ? "Remove from the question" : "Add to the question"}
      </button>
      {branches.length > 0 && (
        <>
          <p className="muted small">Asked about it</p>
          {branches.map((c) => (
            <button key={c.id} className="row-btn compact" onClick={() => onOpen(c.id)}>
              <span className="row-line"><Icon name="branch" size={14} /> {short(c.question, 80)}</span>
            </button>
          ))}
        </>
      )}
      <button
        className="row-btn danger"
        onClick={() => {
          if (branches.length && !confirm("Delete this highlight? The questions asked about it stay.")) return;
          onDelete();
        }}
      >
        Delete highlight
      </button>
    </Sheet>
  );
}
