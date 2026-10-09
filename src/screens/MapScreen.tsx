import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../db";
import { cardAnswer, cardPrefix, deleteBranch, roleModel, startFreshBranch } from "../ai";
import { nodesInGroup, outlineText, parseAnswer, pyramids, short, subsetOutline, type Answer, type AnswerNode, type Pyramid } from "../answer";
import { layoutMap, lineage, type MapCard, type MapItem } from "../mapLayout";
import { branchTokens } from "../context";
import { cosine } from "../search";
import { bookmarkKey, toggleBookmark } from "../bookmarks";
import { go, hrefCard, hrefMap } from "../route";
import { modelInfo, modelsStore, streamStore, useLive, useStore } from "../store";
import { synthesize } from "../synthesis";
import { children, indexCards } from "../tree";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Composer } from "../components/Composer";
import { Icon } from "../components/Icon";
import { MapView, type MapHandle } from "../components/MapView";
import { NodePanel } from "../components/NodePanel";
import { OutlineView } from "../components/OutlineView";
import { QuestionPanel } from "../components/QuestionPanel";
import { SearchSheet } from "../components/SearchSheet";
import { Sheet } from "../components/Sheet";
import { SynthesisEditor } from "../components/SynthesisEditor";
import { CouncilEditor } from "../components/CouncilEditor";
import { settingsStore } from "../store";
import type { Anchor, Card } from "../types";

type Selection =
  | { type: "none" }
  | { type: "nodes"; ids: string[] }
  | { type: "question"; cardId: string }
  | { type: "group"; id: string; cardId: string }
  | { type: "pyramid"; cardId: string; pyramid: Pyramid };

const SIMILAR_MIN = 0.75;

export function MapScreen({ sid, focus, node, hl, view }: { sid: string; focus?: string; node?: string; hl?: number; view: "map" | "outline" }) {
  const data = useLive(async () => {
    const cards = await db.cards.where("sessionId").equals(sid).toArray();
    return {
      session: await db.sessions.get(sid),
      cards,
      bookmarks: await db.bookmarks.where("sessionId").equals(sid).toArray(),
      vectors: await db.vectors.where("cardId").anyOf(cards.map((c) => c.id)).toArray(),
      outlines: await db.outlines.where("sessionId").equals(sid).count(),
    };
  }, [sid]);
  const streams = useStore(streamStore);
  useStore(modelsStore);
  const [focusId, setFocusId] = useState<string | undefined>(focus);
  const [sel, setSel] = useState<Selection>({ type: "none" });
  const [selectMode, setSelectMode] = useState(false);
  const [filter, setFilter] = useState<"all" | "foundations">("all");
  const [menu, setMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [synthOpen, setSynthOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [councilOn, setCouncilOn] = useState(() => {
    try {
      return localStorage.getItem(`fractal.council.${sid}`) === "1";
    } catch {
      return false;
    }
  });
  const [councilSheet, setCouncilSheet] = useState(false);
  const [forceModel, setForceModel] = useState<{ id: string; n: number } | undefined>();
  const setCouncil = (on: boolean) => {
    setCouncilOn(on);
    try {
      localStorage.setItem(`fractal.council.${sid}`, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  const mapRef = useRef<MapHandle>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setFocusId(focus), [focus]);

  const cards = data?.cards ?? [];
  const idx = useMemo(() => indexCards(cards), [cards]);

  // answers, including ones still streaming in
  const answers = useMemo(() => {
    const m = new Map<string, Answer | undefined>();
    for (const c of cards) {
      const live = streams[c.id];
      m.set(c.id, c.status === "streaming" && live ? parseAnswer(live.content, cardPrefix(c), { partial: true }) : cardAnswer(c));
    }
    return m;
  }, [cards, streams]);
  const allNodes = useMemo(() => {
    const m = new Map<string, { node: AnswerNode; card: Card }>();
    for (const c of cards) for (const n of answers.get(c.id)?.nodes ?? []) m.set(n.id, { node: n, card: c });
    return m;
  }, [cards, answers]);

  // dotted "similar" links for answers that declared no link to earlier answers
  const similar = useMemo(() => {
    const out: [string, string][] = [];
    const vecs = data?.vectors ?? [];
    const sorted = [...cards].sort((a, b) => a.createdAt - b.createdAt);
    sorted.forEach((c, i) => {
      const ans = answers.get(c.id);
      if (!ans || i === 0) return;
      const own = new Set(ans.nodes.map((n) => n.id));
      if (ans.nodes.some((n) => n.from.some((f) => !own.has(f)))) return;
      const top = ans.nodes.findIndex((n) => n.kind === "conclusion");
      const mine = vecs.find((v) => v.cardId === c.id && v.blockIdx === (top >= 0 ? top : 0));
      if (!mine) return;
      const earlier = new Set(sorted.slice(0, i).map((x) => x.id));
      const scored = vecs
        .filter((v) => earlier.has(v.cardId) && v.blockIdx >= 0)
        .map((v) => ({ v, s: cosine(mine.vector, v.vector) }))
        .filter((x) => x.s >= SIMILAR_MIN)
        .sort((a, b) => b.s - a.s)
        .slice(0, 2);
      for (const { v } of scored) {
        const target = answers.get(v.cardId)?.nodes[v.blockIdx];
        const from = ans.nodes[top >= 0 ? top : 0];
        if (target && from) out.push([target.id, from.id]);
      }
    });
    return out;
  }, [cards, answers, data?.vectors]);

  const mapCards: MapCard[] = useMemo(
    () => cards.map((c) => ({ id: c.id, parentId: c.parentId, question: c.question, anchorNodeIds: c.anchor?.nodeIds, answer: answers.get(c.id), status: c.status, createdAt: c.createdAt })),
    [cards, answers],
  );
  const deferred = useDeferredValue(mapCards);
  const layout = useMemo(() => layoutMap(deferred, filter, filter === "all" ? similar : []), [deferred, filter, similar]);

  const session = data?.session;
  const focusCard = (focusId && idx.get(focusId)) || (session && idx.get(session.lastCardId)) || cards[cards.length - 1];

  // route ?node= / ?hl= selects a point
  useEffect(() => {
    if (!data) return;
    let target = node;
    if (!target && hl !== undefined && focusCard) target = answers.get(focusCard.id)?.nodes[hl]?.id;
    if (target && allNodes.has(target)) setSel({ type: "nodes", ids: [target] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, hl, !!data]);

  // frame the focused answer when it changes or first gets content
  const focusItems = useMemo(() => (focusCard ? [`q:${focusCard.id}`, ...(answers.get(focusCard.id)?.nodes.map((n) => n.id) ?? [])] : []), [focusCard, answers]);
  const framed = useRef("");
  useEffect(() => {
    if (!focusCard || view !== "map") return;
    const key = `${focusCard.id}:${filter}:${focusItems.length > 1}`;
    if (framed.current === key) return;
    framed.current = key;
    requestAnimationFrame(() => (filter === "all" ? mapRef.current?.focus(focusItems) : mapRef.current?.fit()));
  }, [focusCard, focusItems, filter, view, layout]);

  const bookmarked = useMemo(() => new Set((data?.bookmarks ?? []).map((b) => b.nodeId ?? `q:${b.cardId}`)), [data?.bookmarks]);
  const bookmarkKeys = useMemo(() => new Set((data?.bookmarks ?? []).map((b) => bookmarkKey(b.cardId, b.nodeId))), [data?.bookmarks]);

  if (!data) return <div className="center muted">Loading…</div>;
  if (!session || !focusCard) {
    return (
      <div className="center">
        <p>This topic no longer exists.</p>
        <a className="btn" href="#/">Home</a>
      </div>
    );
  }

  const selectedIds = new Set<string>(
    sel.type === "nodes" ? sel.ids : sel.type === "question" ? [`q:${sel.cardId}`] : sel.type === "group" ? [sel.id] : sel.type === "pyramid" ? sel.pyramid.nodeIds : [],
  );
  const primary = sel.type === "nodes" && sel.ids.length === 1 ? sel.ids[0] : sel.type === "question" ? `q:${sel.cardId}` : undefined;
  const highlight = primary ? lineage(layout.edges, primary) : sel.type === "pyramid" ? new Set(sel.pyramid.nodeIds) : undefined;

  const focusOn = (cid: string) => {
    setFocusId(cid);
    framed.current = "";
  };

  const tapItem = (item: MapItem) => {
    if (item.type === "question") {
      setSel({ type: "question", cardId: item.cardId });
      setSelectMode(false);
      focusOn(item.cardId);
      return;
    }
    if (selectMode && sel.type === "nodes") {
      const ids = sel.ids.includes(item.id) ? sel.ids.filter((x) => x !== item.id) : [...sel.ids, item.id];
      setSel(ids.length ? { type: "nodes", ids } : { type: "none" });
      return;
    }
    setSel({ type: "nodes", ids: [item.id] });
    setFocusId(item.cardId);
  };
  const tapGroup = (gid: string) => {
    const owner = cards.find((c) => answers.get(c.id)?.groups.some((g) => g.id === gid));
    if (owner) setSel({ type: "group", id: gid, cardId: owner.id });
  };

  // what the next question is about
  let anchor: Anchor | undefined;
  let anchorLabel: string | undefined;
  let parentId: string = focusCard.id;
  if (sel.type === "nodes" && sel.ids.length) {
    const picked = sel.ids.map((id) => allNodes.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    if (picked.length) {
      const owner = picked.reduce((a, b) => (b.card.createdAt > a.card.createdAt ? b : a)).card;
      parentId = owner.id;
      anchor = { text: picked.map((p) => p.node.text).join(" / "), nodeIds: picked.map((p) => p.node.id), quotes: picked.map((p) => p.node.text), scope: "points" };
      anchorLabel = picked.length === 1 ? `“${short(picked[0].node.text, 60)}”` : `${picked.length} points`;
    }
  } else if (sel.type === "group") {
    const ans = answers.get(sel.cardId);
    if (ans) {
      const ids = nodesInGroup(ans, sel.id);
      parentId = sel.cardId;
      anchor = { text: subsetOutline(ans, ids), nodeIds: ids, scope: "category" };
      anchorLabel = `category “${ans.groups.find((g) => g.id === sel.id)?.title ?? ""}”`;
    }
  } else if (sel.type === "pyramid") {
    const ans = answers.get(sel.cardId);
    if (ans) {
      parentId = sel.cardId;
      anchor = { text: subsetOutline(ans, sel.pyramid.nodeIds), nodeIds: sel.pyramid.nodeIds, scope: "pyramid" };
      anchorLabel = `pyramid “${sel.pyramid.title}”`;
    }
  } else if (sel.type === "question") {
    parentId = sel.cardId;
  }

  const fresh = async (cid = focusCard.id) => {
    setMenu(false);
    setToast("Summarizing this branch…");
    try {
      const id = await startFreshBranch(cid);
      setToast("");
      go(hrefCard(sid, id));
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
  };

  const selCard = sel.type === "question" ? idx.get(sel.cardId) : undefined;
  const panelNodes =
    sel.type === "nodes"
      ? sel.ids.map((id) => allNodes.get(id)).filter((x): x is NonNullable<typeof x> => !!x)
      : [];
  const pyramidOf = (nodeId: string) => {
    const owner = allNodes.get(nodeId);
    const ans = owner && answers.get(owner.card.id);
    return ans ? pyramids(ans).find((p) => p.nodeIds.includes(nodeId)) : undefined;
  };

  return (
    <>
      <div className="topbar">
        <Breadcrumbs idx={idx} sid={sid} cid={focusCard.id} onPick={(id) => (focusOn(id), setSel({ type: "question", cardId: id }))} />
        <button className="btn icon sm" aria-label="Search" onClick={() => setSearchOpen(true)}><Icon name="search" /></button>
        <button
          className="btn icon sm"
          aria-label="Synthesize"
          onClick={async () => {
            await synthesize(sid);
            setToast("Synthesizing in the background. See Library.");
            setTimeout(() => setToast(""), 5000);
          }}
        >
          <Icon name="sparkle" />
        </button>
        <button className="btn icon sm" aria-label="Menu" onClick={() => setMenu(true)}><Icon name="more" /></button>
      </div>

      <div className="viewbar">
        <div className="seg" role="group" aria-label="View">
          <button className={view === "map" ? "on" : ""} aria-pressed={view === "map"} onClick={() => go(hrefMap(sid, { focus: focusCard.id }))}>
            <Icon name="map" size={14} /> Map
          </button>
          <button className={view === "outline" ? "on" : ""} aria-pressed={view === "outline"} onClick={() => go(hrefMap(sid, { focus: focusCard.id, view: "outline" }))}>
            <Icon name="outline" size={14} /> Outline
          </button>
        </div>
        {view === "map" && (
          <>
            <div className="seg" role="group" aria-label="Show">
              <button className={filter === "all" ? "on" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
              <button className={filter === "foundations" ? "on" : ""} aria-pressed={filter === "foundations"} onClick={() => setFilter("foundations")}>Foundations</button>
            </div>
            <button className="btn icon sm" aria-label="Focus on this answer" onClick={() => mapRef.current?.focus(focusItems)}>
              <Icon name="focus" />
            </button>
          </>
        )}
        <button className={`btn icon sm ${selectMode ? "on" : ""}`} aria-label="Select several points" aria-pressed={selectMode} onClick={() => setSelectMode((m) => !m)}>
          <Icon name="select" />
        </button>
      </div>

      {view === "map" ? (
        <MapView
          layout={layout}
          selected={selectedIds}
          highlight={highlight}
          bookmarked={bookmarked}
          onTapItem={tapItem}
          onTapGroup={tapGroup}
          onTapBackground={() => (setSel({ type: "none" }), setSelectMode(false))}
          handleRef={mapRef}
        />
      ) : (
        <OutlineView
          card={focusCard}
          answer={answers.get(focusCard.id)}
          childCards={children(idx, focusCard.id)}
          selected={selectedIds}
          bookmarked={bookmarked}
          onTapNode={(id) => tapItem({ id, type: "node", cardId: focusCard.id } as MapItem)}
          onTapGroup={tapGroup}
          onFocusCard={(id) => go(hrefMap(sid, { focus: id, view: "outline" }))}
        />
      )}

      <div className="dock">
        {toast && <p className="muted small" role="status">{toast}</p>}
        {panelNodes.length > 0 && (
          <NodePanel
            sessionId={sid}
            nodes={panelNodes}
            answerOf={(id) => answers.get(id)}
            pyramidOf={pyramidOf}
            allNodes={allNodes}
            bookmarked={bookmarked}
            selectMode={selectMode}
            onSelectNode={(id) => setSel({ type: "nodes", ids: [id] })}
            onAskPyramid={(p, c) => setSel({ type: "pyramid", cardId: c.id, pyramid: p })}
            onToggleSelectMode={() => setSelectMode((m) => !m)}
            onClose={() => (setSel({ type: "none" }), setSelectMode(false))}
          />
        )}
        {sel.type === "group" && idx.get(sel.cardId) && (
          <NodePanel
            sessionId={sid}
            nodes={[]}
            groupId={{ id: sel.id, card: idx.get(sel.cardId)! }}
            answerOf={(id) => answers.get(id)}
            pyramidOf={pyramidOf}
            allNodes={allNodes}
            bookmarked={bookmarked}
            selectMode={selectMode}
            onSelectNode={(id) => setSel({ type: "nodes", ids: [id] })}
            onAskPyramid={() => {}}
            onToggleSelectMode={() => setSelectMode((m) => !m)}
            onClose={() => setSel({ type: "none" })}
          />
        )}
        {selCard && (
          <QuestionPanel
            card={selCard}
            live={streams[selCard.id]}
            used={branchTokens(idx, selCard.id)}
            limit={modelInfo(selCard.model).context_length ?? 0}
            bookmarked={bookmarkKeys.has(bookmarkKey(selCard.id))}
            childCards={children(idx, selCard.id)}
            onFresh={() => fresh(selCard.id)}
            onContinue={(m) => {
              setCouncil(false);
              setForceModel({ id: m, n: Date.now() });
            }}
            onFocusCard={(id) => (focusOn(id), setSel({ type: "question", cardId: id }))}
            onClose={() => setSel({ type: "none" })}
          />
        )}
        <Composer
          sessionId={sid}
          parentId={parentId}
          anchor={anchor}
          anchorLabel={anchorLabel}
          onClearAnchor={anchor ? () => (setSel({ type: "none" }), setSelectMode(false)) : undefined}
          placeholder={anchor ? "Your question about this…" : "Ask about this answer…"}
          defaultModel={idx.get(parentId)?.model ?? roleModel("answer")}
          inputRef={inputRef}
          council={councilOn}
          onCouncilToggle={() => setCouncil(!councilOn)}
          onCouncilSettings={() => setCouncilSheet(true)}
          forceModel={forceModel}
          onAsked={(r) => {
            setSel({ type: "none" });
            setSelectMode(false);
            go(hrefCard(r.sessionId, r.cardId));
          }}
        />
      </div>

      {menu && (
        <Sheet title="Menu" onClose={() => setMenu(false)}>
          <button className="row-btn" onClick={() => fresh()}>Continue in a fresh branch</button>
          <button
            className="row-btn"
            onClick={() => toggleBookmark({ sessionId: sid, cardId: focusCard.id, label: focusCard.tag ?? focusCard.question }).then(() => setMenu(false))}
          >
            {bookmarkKeys.has(bookmarkKey(focusCard.id)) ? "Remove bookmark from this answer" : "Bookmark this answer"}
          </button>
          <button className="row-btn" onClick={() => (setSynthOpen(true), setMenu(false))}>Synthesize with options…</button>
          <button
            className="row-btn"
            onClick={() => {
              void navigator.clipboard?.writeText(`${focusCard.question}\n\n${outlineText(answers.get(focusCard.id))}`);
              setMenu(false);
            }}
          >
            Copy this answer as an outline
          </button>
          <details className="row-btn">
            <summary>System prompt used by this topic</summary>
            <pre className="prompt-pre">{session.systemPrompt}</pre>
          </details>
          <button
            className="row-btn danger"
            onClick={async () => {
              if (!confirm("Delete this question, its answer and every question below it?")) return;
              const r = await deleteBranch(focusCard.id);
              setMenu(false);
              go(r.next ? hrefCard(r.sessionId, r.next) : "#/");
            }}
          >
            Delete this answer and its branches
          </button>
        </Sheet>
      )}
      {synthOpen && <SynthSheet sid={sid} model={session.answerModel} onClose={() => setSynthOpen(false)} onStarted={() => setToast("Synthesizing in the background. See Library.")} />}
      {searchOpen && <SearchSheet onClose={() => setSearchOpen(false)} />}
      {councilSheet && (
        <Sheet title="LLM Council" onClose={() => setCouncilSheet(false)}>
          <CouncilEditor />
          <button className="btn primary" onClick={() => setCouncilSheet(false)}>Done</button>
        </Sheet>
      )}
    </>
  );
}

function SynthSheet({ sid, model, onClose, onStarted }: { sid: string; model: string; onClose: () => void; onStarted: () => void }) {
  const [local, setLocal] = useState(settingsStore.get().synthesis);
  return (
    <Sheet title="Synthesize this topic" onClose={onClose}>
      <p className="muted small">These options apply to this run only. Change the defaults in Settings › Synthesis.</p>
      <SynthesisEditor value={local} onChange={setLocal} fallbackModel={model} />
      <button className="btn primary" onClick={async () => (await synthesize(sid, local), onStarted(), onClose())}>
        Synthesize with these settings
      </button>
    </Sheet>
  );
}
