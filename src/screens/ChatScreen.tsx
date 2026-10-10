import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type UIEvent } from "react";
import { db } from "../db";
import { cardPrefix, deleteBranch, roleModel, startFreshBranch } from "../ai";
import { outlineText, parseAnswer, short } from "../answer";
import { bookmarkKey, toggleBookmark } from "../bookmarks";
import { branchTokens } from "../context";
import { deleteHighlight, saveHighlight } from "../highlights";
import { usesPyramids } from "../prompts";
import { go, hrefChat, hrefMap } from "../route";
import { modelInfo, modelsStore, settingsStore, streamStore, updateSettings, useLive, useStore, type StreamView } from "../store";
import { synthesize } from "../synthesis";
import { branchLabel, circled, indexCards, lineBranches, linePath, lineRoot, parentLine, pathToRoot, siblings, startsBranch, type CardIndex } from "../tree";
import { keepInView, splitHeight } from "../panes";
import { useKeyboard } from "../keyboard";
import { BranchHost, type BranchTab } from "../components/BranchHost";
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
import { CheckNotes, QuickNotes, QuickSheet } from "../components/QuickViews";
import { ImageTexts, MessageThumbs, PictureSheet } from "../components/MessageImages";
import type { Box } from "../components/Attachments";
import { startClaimCheck } from "../quick";
import type { ClaimCheck, Quick } from "../types";
import type { Anchor, Card, Highlight, QuoteFrom, VisualScope } from "../types";
import { scopeCards } from "../visuals";
import { hrefVisual } from "../route";

const NO_MARKS: AnswerMark[] = [];
const NO_CARDS: Card[] = [];
const NO_HIGHLIGHTS: Highlight[] = [];
/** marks are kept per text: an answer, or the text read from one of its question's pictures */
const markKey = (cardId: string, part?: string) => (part ? `${cardId}|${part}` : cardId);

/** Where each line (the main chat, each branch) was scrolled to, for this visit of the app. */
const scrollMemory = new Map<string, number>();

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
export function ChatScreen({ sid, focus, find, quote, ask, branch }: { sid: string; focus?: string; find?: string; quote?: string; ask?: string; branch?: string }) {
  const data = useLive(async () => ({
    session: await db.sessions.get(sid),
    cards: await db.cards.where("sessionId").equals(sid).toArray(),
    highlights: await db.highlights.where("sessionId").equals(sid).toArray(),
    bookmarks: await db.bookmarks.where("sessionId").equals(sid).toArray(),
    visuals: await db.visuals.where("sessionId").equals(sid).toArray(),
    quicks: await db.quicks.where("sessionId").equals(sid).toArray(),
    checks: await db.checks.where("sessionId").equals(sid).toArray(),
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
  const [quickOpen, setQuickOpen] = useState<{ id?: string; draft?: { cardId: string; highlightIds: string[]; quotes: string[]; quoteFrom?: QuoteFrom[] } }>();
  const [toast, setToast] = useState("");
  const [councilOn, setCouncilOn] = useState(() => readCouncil(sid));
  const [councilSheet, setCouncilSheet] = useState(false);
  const [forceModel, setForceModel] = useState<{ id: string; n: number }>();
  const [picture, setPicture] = useState<{ cardId: string; i: number }>();
  const [addPicture, setAddPicture] = useState<{ blob: Blob; box: Box; n: number }>();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { sel, clear: clearSel, press, release } = useAnswerSelection();
  const { branchMode: mode, followUp } = useStore(settingsStore);
  const [follow, setFollow] = useState(followUp);
  useEffect(() => setFollow(followUp), [followUp]);
  const [draftOpen, setDraftOpen] = useState(false);
  const [max, setMax] = useState<"none" | "branch" | "original">("none");
  const [splitH, setSplitH] = useState(0);
  const [anchorBox, setAnchorBox] = useState<{ top: number; bottom: number }>();
  const kbOpen = useKeyboard();
  const wrapRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  // the original's scroll before the split (or the keyboard) made room, put back afterwards
  const restoreTop = useRef<number | undefined>(undefined);
  const kbRestore = useRef<number | undefined>(undefined);
  const anchorEl = useRef<Element | null>(null);

  const cards = data?.cards ?? NO_CARDS;
  const highlights = data?.highlights ?? NO_HIGHLIGHTS;
  const session = data?.session;
  const idx = useMemo(() => indexCards(cards), [cards]);
  const hlById = useMemo(() => new Map(highlights.map((h) => [h.id, h])), [highlights]);
  const inBranch = (id: string | undefined) => !!id && idx.has(id) && startsBranch(idx.get(lineRoot(idx, id))!);

  // reopening a topic opens the branch you were in; closing it (✕) leaves you in the original
  const initial = useRef<string | null | undefined>(undefined);
  if (initial.current === undefined && session) initial.current = !focus && !branch && inBranch(session.lastCardId) ? session.lastCardId : null;
  const target = focus && idx.has(focus) ? focus : session && idx.has(session.lastCardId) ? session.lastCardId : cards[cards.length - 1]?.id;
  const routeBranch = branch && idx.has(branch) ? branch : inBranch(focus) ? focus : initial.current && idx.has(initial.current) ? initial.current : undefined;

  // the branch open beside the original (if any), and the original it was asked from
  const lowerRoot = routeBranch ? lineRoot(idx, routeBranch) : undefined;
  const lowerCards = useMemo(() => (lowerRoot ? linePath(idx, lowerRoot, routeBranch) : NO_CARDS), [idx, lowerRoot, routeBranch]);
  const lowerLeaf = lowerCards[lowerCards.length - 1];
  const base = useMemo(() => {
    if (lowerRoot) {
      const up = parentLine(idx, lowerRoot)!;
      return { root: up, prefer: idx.get(lowerRoot)?.parentId ?? undefined };
    }
    // the main chat: climb out of any branch the target is in
    let prefer: string | undefined = target;
    let root = target ? lineRoot(idx, target) : undefined;
    for (let guard = 0; root && guard < 100 && startsBranch(idx.get(root)!); guard++) {
      prefer = idx.get(root)!.parentId ?? undefined;
      root = prefer ? lineRoot(idx, prefer) : undefined;
    }
    return { root, prefer };
  }, [idx, lowerRoot, target]);

  // what the next question is about: the highlights in the tray and a quote passed in
  const trayHs = tray.map((id) => hlById.get(id)).filter((h): h is Highlight => !!h && idx.has(h.cardId));
  const quotes = [...trayHs.map((h) => h.quote), ...(askQuote ? [askQuote] : [])];
  const baseCards = useMemo(() => (base.root ? linePath(idx, base.root, base.prefer) : NO_CARDS), [idx, base]);
  // asked under the latest answer the words come from, on the branch's path if they're all on it, else the original's
  let draftParent: string | undefined;
  {
    const owners = [...trayHs.map((h) => h.cardId), ...(askQuote && focus && idx.has(focus) ? [focus] : [])];
    const paths = [lowerLeaf ? pathToRoot(idx, lowerLeaf.id) : [], baseCards.length ? pathToRoot(idx, baseCards[baseCards.length - 1].id) : []];
    let best = -1;
    for (const p of paths) {
      const at = new Map(p.map((c, i) => [c.id, i]));
      const on = owners.filter((o) => at.has(o));
      if (on.length > best && on.length) {
        best = on.length;
        draftParent = on.reduce((a, b) => (at.get(b)! > at.get(a)! ? b : a));
      }
      if (on.length === owners.length && owners.length) break;
    }
  }
  const drafting = draftOpen && quotes.length > 0 && !!draftParent;
  const upperRoot = drafting ? lineRoot(idx, draftParent!) : base.root;
  const upperCards = useMemo(() => (drafting ? linePath(idx, upperRoot!, draftParent) : baseCards), [drafting, idx, upperRoot, draftParent, baseCards]);
  const upperLeaf = upperCards[upperCards.length - 1];
  const showLower = drafting || !!lowerRoot;
  const currentLeaf = !drafting && lowerLeaf ? lowerLeaf : upperLeaf;

  // remember where you are, so the topic reopens here
  useEffect(() => {
    if (session && currentLeaf && session.lastCardId !== currentLeaf.id) void db.sessions.update(sid, { lastCardId: currentLeaf.id });
  }, [session, currentLeaf, sid]);

  // branch numbers: ①, ② for branches of the main chat, "1.2" inside a branch
  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cards) if (startsBranch(c)) m.set(c.id, branchLabel(idx, c.id));
    return m;
  }, [cards, idx]);
  const shown = (label: string) => (/^\d+$/.test(label) ? circled(Number(label)) : label);

  const open = (id: string) => (inBranch(id) ? go(hrefChat(sid, { focus: inBranch(focus) ? undefined : focus, branch: id })) : go(hrefChat(sid, { focus: id })));
  const closeBranch = () => {
    initial.current = null;
    setDraftOpen(false);
    if (routeBranch) go(hrefChat(sid, { focus: inBranch(focus) ? undefined : focus }));
  };

  // the original opens at the asked-about answer (or the latest one), its question at the top; returning to a line
  // puts it back where you left it
  const placed = useRef<{ root?: string; focus?: string }>({});
  useLayoutEffect(() => {
    const pane = mainRef.current;
    if (!pane || !upperRoot || !upperLeaf) return;
    const prev = placed.current;
    if (prev.root === upperRoot && prev.focus === focus) return;
    const focusMoved = !!focus && focus !== prev.focus && upperCards.some((c) => c.id === focus);
    if (prev.root !== undefined && !focusMoved) {
      placed.current = { root: upperRoot, focus };
      const mem = scrollMemory.get(upperRoot);
      if (mem !== undefined && prev.root !== upperRoot) pane.scrollTop = mem;
      return;
    }
    const t = focusMoved || (focus && upperCards.some((c) => c.id === focus)) ? focus! : upperLeaf.id;
    const el = pane.querySelector(`[data-card-id="${CSS.escape(t)}"]`);
    if (!el) return;
    placed.current = { root: upperRoot, focus };
    const mem = prev.root === undefined && !focus ? scrollMemory.get(upperRoot) : undefined;
    if (mem !== undefined) pane.scrollTop = mem;
    else el.scrollIntoView({ block: "start" });
  });

  // the branch pane: back where you left it, and a new question at its top
  const lowerPlaced = useRef<{ root?: string; leaf?: string }>({});
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane || !lowerRoot || !lowerLeaf) {
      if (!lowerRoot) lowerPlaced.current = {};
      return;
    }
    const prev = lowerPlaced.current;
    if (prev.root === lowerRoot && prev.leaf === lowerLeaf.id) return;
    const el = pane.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(lowerLeaf.id)}"]`);
    if (!el) return;
    lowerPlaced.current = { root: lowerRoot, leaf: lowerLeaf.id };
    const mem = scrollMemory.get(lowerRoot);
    if (prev.root !== lowerRoot && mem !== undefined) pane.scrollTop = mem;
    else pane.scrollTop = Math.max(0, el.offsetTop - 4);
  });

  // the split ends just under the paragraph asked about, so the original doesn't move
  const splitKey = showLower ? `${mode}:${drafting ? `d:${draftParent}:${tray.join(",")}` : lowerRoot}` : "";
  const lastSplit = useRef("");
  useLayoutEffect(() => {
    const pane = mainRef.current;
    const wrap = wrapRef.current;
    if (!showLower) {
      lastSplit.current = "";
      if (restoreTop.current !== undefined && pane) pane.scrollTop = restoreTop.current;
      restoreTop.current = undefined;
      anchorEl.current = null;
      return;
    }
    if (!pane || !wrap || lastSplit.current === splitKey) return;
    lastSplit.current = splitKey;
    const ids = drafting ? trayHs.map((h) => h.id) : idx.get(lowerRoot!)?.anchor?.highlightIds ?? [];
    const mark = ids.map((id) => pane.querySelector(`mark[data-h~="${CSS.escape(id)}"]`)).filter((x): x is Element => !!x).pop();
    const src = drafting ? draftParent : idx.get(lowerRoot!)?.parentId;
    const block = mark?.closest("p,li,tr,h1,h2,h3,h4,h5,h6,blockquote,pre,.img-text") ?? mark ?? (src ? pane.querySelector(`[data-card-id="${CSS.escape(src)}"]`) : null);
    anchorEl.current = block;
    const pr = pane.getBoundingClientRect();
    if (block) {
      const r = block.getBoundingClientRect();
      setAnchorBox({ top: r.top - pr.top, bottom: r.bottom - pr.top });
    }
    if (mode !== "split") return;
    const s = splitHeight({ paneHeight: wrap.clientHeight, blockBottom: block ? block.getBoundingClientRect().bottom - pr.top : wrap.clientHeight * 0.5 });
    setSplitH(s.height);
    if (s.scrollBy > 0) {
      if (restoreTop.current === undefined) restoreTop.current = pane.scrollTop;
      pane.scrollTop += s.scrollBy;
    }
  });

  // the keyboard took space: keep the asked-about words visible, then put the original back exactly
  useEffect(() => {
    const pane = mainRef.current;
    if (!pane) return;
    if (!kbOpen) {
      if (kbRestore.current !== undefined) pane.scrollTop = kbRestore.current;
      kbRestore.current = undefined;
      return;
    }
    const raf = requestAnimationFrame(() => {
      const el = anchorEl.current;
      if (!el || !pane.contains(el)) return;
      const pr = pane.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const by = keepInView({ top: r.top - pr.top, bottom: r.bottom - pr.top, paneHeight: pane.clientHeight });
      if (by) {
        kbRestore.current = pane.scrollTop;
        pane.scrollTop += by;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [kbOpen]);

  const counts = useMemo(() => {
    const m = new Map<string, string[]>();
    // in the order the branches were asked (① before ②)
    for (const c of [...cards].sort((a, b) => a.createdAt - b.createdAt)) if (startsBranch(c)) for (const h of c.anchor?.highlightIds ?? []) m.set(h, [...(m.get(h) ?? []), shown(labels.get(c.id) ?? "")]);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, labels]);
  // highlights a claim check found something disputed in
  const disputed = useMemo(() => {
    const out = new Set<string>();
    for (const c of data?.checks ?? []) if (c.claims.some((x) => x.verdict === "disputed")) c.highlightIds.forEach((h) => out.add(h));
    return out;
  }, [data?.checks]);
  const trayIds = useMemo(() => new Set(tray), [tray]);
  const marksByCard = useMemo(() => {
    const m = new Map<string, AnswerMark[]>();
    for (const h of highlights) {
      const n = counts.get(h.id);
      const key = markKey(h.cardId, h.part);
      const list = m.get(key) ?? [];
      const cls = [trayIds.has(h.id) ? "picked" : "", disputed.has(h.id) ? "disputed" : ""].filter(Boolean).join(" ");
      list.push({ ...h, className: cls || undefined, badge: n?.length ? n.join(" ") : undefined });
      m.set(key, list);
    }
    // a council answer shows which members each paragraph came from
    for (const c of cards) {
      const blocks = c.council?.textSources;
      if (!blocks?.length) continue;
      const list = m.get(c.id) ?? [];
      blocks.forEach((b, i) => {
        if (!b.sources.length) return;
        const words = b.text.replace(/\s+/g, " ").trim();
        const tail = words.slice(-Math.min(40, words.length));
        list.push({ id: `src:${c.id}:${i}`, quote: tail, start: 0, end: 0, loose: true, className: "src", badge: b.sources.join("·") });
      });
      m.set(c.id, list);
    }
    return m;
  }, [highlights, counts, trayIds, disputed, cards]);

  if (!data) return <div className="center muted">Loading…</div>;
  if (!session || !upperLeaf) {
    return (
      <div className="center">
        <p>This topic no longer exists.</p>
        <a className="btn" href="#/">Home</a>
      </div>
    );
  }
  const pyramid = usesPyramids(session.systemPrompt);

  // what the question box asks: about the tray's words (a new branch), in the open branch, or in the main chat
  const lowerFirst = lowerRoot ? idx.get(lowerRoot) : undefined;
  let anchor: Anchor | undefined;
  let parentId: string = upperLeaf.id;
  let target2: "draft" | "thread" | "branch" | "main" = "main";
  if (quotes.length && draftParent) {
    anchor = { text: quotes.join(" / "), quotes, scope: "highlights", highlightIds: trayHs.length ? trayHs.map((h) => h.id) : undefined };
    // words highlighted in the text read from the learner's own picture are asked about as such
    const from: QuoteFrom[] = [...trayHs.map((h): QuoteFrom => (h.part ? "picture" : "answer")), ...(askQuote ? ["answer" as const] : [])];
    if (from.includes("picture")) anchor.quoteFrom = from;
    parentId = draftParent;
    target2 = "draft";
  } else if (lowerLeaf && lowerFirst) {
    if (follow === "branch" && lowerFirst.parentId) {
      // a new branch from the same words: only the original, the quote and this question are sent
      parentId = lowerFirst.parentId;
      anchor = lowerFirst.anchor ? { ...lowerFirst.anchor } : undefined;
      target2 = "branch";
    } else {
      parentId = lowerLeaf.id;
      target2 = "thread";
    }
  }
  const trayItems: TrayItem[] = [...trayHs.map((h) => ({ key: h.id, quote: h.quote })), ...(askQuote ? [{ key: "quote", quote: askQuote }] : [])];
  const lowerLabel = lowerRoot ? shown(labels.get(lowerRoot) ?? "") : "";

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
    if (thenAsk) {
      setDraftOpen(true);
      inputRef.current?.focus();
    }
    const h = await saveHighlight({ ...picked, sessionId: sid });
    setTray((t) => (t.includes(h.id) ? t : [...t, h.id]));
  };

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (upperRoot) scrollMemory.set(upperRoot, top);
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

  const bookmarkKeys = new Set(data.bookmarks.map((b) => bookmarkKey(b.cardId, b.nodeId)));
  const menuCard = answerMenu ? idx.get(answerMenu) : undefined;
  const hl = openHighlight ? hlById.get(openHighlight) : undefined;

  const turns = (list: Card[]) =>
    list.map((c) => (
      <Turn
        key={c.id}
        card={c}
        idx={idx}
        live={streams[c.id]}
        pyramid={pyramid}
        marks={marksByCard.get(c.id) ?? NO_MARKS}
        partMarks={(part) => marksByCard.get(markKey(c.id, part)) ?? NO_MARKS}
        onPicture={(i) => setPicture({ cardId: c.id, i })}
        onOpen={open}
        find={c.id === focus ? flash : undefined}
        onMenu={setAnswerMenu}
        visuals={data.visuals.filter((x) => x.cardId === c.id).length}
        quicks={data.quicks.filter((x) => x.cardId === c.id)}
        checks={data.checks.filter((x) => x.cardId === c.id)}
        onQuick={(id) => setQuickOpen({ id })}
        onVisualize={() => setVisualize({ cardId: c.id, scope: { kind: "answer", cardIds: [c.id], label: short(c.question, 60) } })}
        onVisuals={() => setVisualsFor(c.id)}
        onContinue={(m) => {
          setCouncil(false);
          setForceModel({ id: m, n: Date.now() });
        }}
      />
    ));

  // tabs: every branch asked from the original shown above (plus the one being asked)
  const upperLabel = upperRoot ? labels.get(upperRoot) ?? "" : "";
  const tabs: BranchTab[] = lineBranches(idx, upperCards).map((b) => ({
    id: b.id,
    label: shown(labels.get(b.id) ?? ""),
    title: short(b.anchor?.quotes?.[0] ?? b.question, 22),
    active: !drafting && b.id === lowerRoot,
    onClick: () => {
      setDraftOpen(false);
      open(linePath(idx, b.id).pop()!.id);
    },
  }));
  if (drafting) tabs.push({ id: "draft", label: "+", title: short(quotes[0], 22), active: true });
  const chain: string[] = [];
  for (let r: string | undefined = drafting ? undefined : lowerRoot, g = 0; r && g < 50; r = parentLine(idx, r), g++) if (startsBranch(idx.get(r)!)) chain.unshift(shown(labels.get(r) ?? ""));
  if (drafting) for (let r: string | undefined = upperRoot, g = 0; r && g < 50; r = parentLine(idx, r), g++) if (startsBranch(idx.get(r)!)) chain.unshift(shown(labels.get(r) ?? ""));
  const crumbs = upperLabel ? ["Main", ...chain, ...(drafting ? ["+"] : [])].join(" › ") : undefined;
  const onUp = upperLabel
    ? () => {
        setDraftOpen(false);
        open(upperLeaf.id);
      }
    : undefined;

  return (
    <>
      <div
        ref={wrapRef}
        className={`chat-wrap mode-${mode} ${showLower ? "has-branch" : ""} max-${showLower ? max : "none"} ${kbOpen ? "kb-open" : ""}`}
        style={{ ["--split-h" as string]: `${splitH}px` }}
      >
        <div className="chat" ref={mainRef} onScroll={onScroll}>
          <header className={`chat-bar ${barHidden ? "hide" : ""}`}>
            <button className="btn icon sm" aria-label="Home" onClick={() => go("#/")}>
              <Icon name="back" />
            </button>
            <button className="chat-title" onClick={() => setBranchesOpen(true)} title="Branches">
              {upperLabel ? `${shown(upperLabel)} ${short(idx.get(upperRoot!)?.question ?? "", 40)}` : session.title}
            </button>
            <button className="btn icon sm" aria-label="Topic menu" onClick={() => setMenu(true)}>
              <Icon name="more" />
            </button>
          </header>
          <div className="thread" onClick={onThreadClick}>
            {turns(upperCards)}
          </div>
        </div>
        {showLower && (
          <BranchHost
            mode={mode}
            onMode={(m) => updateSettings({ branchMode: m })}
            tabs={tabs}
            crumbs={crumbs}
            onUp={onUp}
            onClose={closeBranch}
            title={drafting ? `New branch about “${short(quotes[0], 30)}”` : ""}
            splitHeight={splitH}
            max={max}
            onMax={() => setMax((m) => (m === "none" ? "branch" : m === "branch" ? "original" : "none"))}
            anchor={anchorBox}
            paneRef={paneRef}
            onPaneScroll={(e) => lowerRoot && !drafting && scrollMemory.set(lowerRoot, e.currentTarget.scrollTop)}
          >
            {drafting ? (
              <div className="draft-branch">
                {quotes.map((q, k) => (
                  <blockquote key={k} className="quote-block small">{q}</blockquote>
                ))}
                <p className="muted small">Ask about {quotes.length > 1 ? "these words" : "these words"} below. The original stays where it is.</p>
              </div>
            ) : (
              <div className="thread" onClick={onThreadClick}>
                {turns(lowerCards)}
              </div>
            )}
          </BranchHost>
        )}
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
              className="toolbtn"
              onClick={async () => {
                const picked = sel;
                clearSel();
                const h = await saveHighlight({ ...picked, sessionId: sid });
                setQuickOpen({ draft: { cardId: h.cardId, highlightIds: [h.id], quotes: [h.quote], ...(h.part ? { quoteFrom: ["picture" as const] } : {}) } });
              }}
            >
              <Icon name="bolt" size={17} />
              <span>Quick</span>
            </button>
            <button
              className="toolbtn"
              onClick={async () => {
                const picked = sel;
                clearSel();
                const h = await saveHighlight({ ...picked, sessionId: sid });
                await startClaimCheck({ sessionId: sid, cardId: h.cardId, highlightIds: [h.id], quotes: [h.quote] });
              }}
            >
              <Icon name="check" size={17} />
              <span>Check</span>
            </button>
            <button
              className="toolbtn"
              onClick={async () => {
                const picked = sel;
                clearSel();
                const h = await saveHighlight({ ...picked, sessionId: sid });
                setVisualize({ cardId: h.cardId, scope: { kind: "highlight", cardIds: [h.cardId], highlightIds: [h.id], label: `“${short(h.quote, 50)}”` } });
              }}
            >
              <Icon name="visualize" size={17} />
              <span>Visualize</span>
            </button>
          </SelectionBar>
        ) : (
          <HighlightTray
            items={trayItems}
            onShow={(key) => {
              const el = key === "quote" ? document.querySelector(`[data-card-id="${CSS.escape(focus ?? upperLeaf.id)}"]`) : document.querySelector(`mark[data-h~="${CSS.escape(key)}"]`);
              el?.scrollIntoView({ block: "center", behavior: "smooth" });
            }}
            onRemove={(key) => (key === "quote" ? setAskQuote(undefined) : setTray((t) => t.filter((x) => x !== key)))}
            onClear={() => (setTray([]), setAskQuote(undefined), setDraftOpen(false))}
          >
            {quotes.length > 0 && (
              <>
                <button
                  className="toolbtn"
                  aria-pressed={councilOn}
                  onClick={() => {
                    setCouncil(true);
                    inputRef.current?.focus();
                  }}
                >
                  <Icon name="council" size={17} />
                  <span>Council</span>
                </button>
                <button className="toolbtn" onClick={() => setQuickOpen({ draft: { cardId: parentId, highlightIds: trayHs.map((h) => h.id), quotes, quoteFrom: anchor?.quoteFrom } })}>
                  <Icon name="bolt" size={17} />
                  <span>Quick</span>
                </button>
                <button
                  className="toolbtn"
                  onClick={async () => {
                    await startClaimCheck({ sessionId: sid, cardId: parentId, highlightIds: trayHs.map((h) => h.id), quotes });
                    setTray([]);
                    setAskQuote(undefined);
                  }}
                >
                  <Icon name="check" size={17} />
                  <span>Check</span>
                </button>
              </>
            )}
            {trayHs.length > 0 && (
              <button
                className="toolbtn"
                onClick={() => {
                  setVisualize({
                    cardId: draftParent ?? trayHs[trayHs.length - 1].cardId,
                    scope: { kind: trayHs.length > 1 ? "highlights" : "highlight", cardIds: [...new Set(trayHs.map((h) => h.cardId))], highlightIds: trayHs.map((h) => h.id), label: trayHs.length > 1 ? `${trayHs.length} highlights` : `“${short(trayHs[0].quote, 50)}”` },
                  });
                }}
              >
                <Icon name="visualize" size={17} />
                <span>Visualize</span>
              </button>
            )}
          </HighlightTray>
        )}
        <Composer
          sessionId={sid}
          parentId={parentId}
          anchor={anchor}
          placeholder={
            target2 === "draft"
              ? quotes.length > 1
                ? "Ask about these…"
                : "Ask about this…"
              : target2 === "thread"
                ? `Ask in ${lowerLabel}…`
                : target2 === "branch"
                  ? `New branch from “${short(lowerFirst?.anchor?.quotes?.[0] ?? "", 20)}”…`
                  : "Ask anything…"
          }
          above={
            target2 === "thread" || target2 === "branch" ? (
              <div className="follow-switch" role="group" aria-label="Your next question">
                <button className={`btn chip small-chip ${follow === "thread" ? "on" : ""}`} aria-pressed={follow === "thread"} onClick={() => setFollow("thread")}>
                  <Icon name="thread" size={13} /> Same thread
                </button>
                <button className={`btn chip small-chip ${follow === "branch" ? "on" : ""}`} aria-pressed={follow === "branch"} onClick={() => setFollow("branch")}>
                  <Icon name="branch" size={13} /> New branch
                </button>
              </div>
            ) : undefined
          }
          sendIcon
          initialText={ask}
          defaultModel={idx.get(parentId)?.model ?? roleModel("answer")}
          voice
          inputRef={inputRef}
          council={councilOn}
          onCouncilToggle={() => setCouncil(!councilOn)}
          onCouncilSettings={() => setCouncilSheet(true)}
          forceModel={forceModel}
          attach
          addPicture={addPicture}
          onAsked={(r) => {
            setTray([]);
            setAskQuote(undefined);
            setAddPicture(undefined);
            setDraftOpen(false);
            initial.current = null;
            // a question about words (or in a branch) opens beside the original, which stays where it is
            if (target2 === "main") go(hrefChat(r.sessionId, { focus: r.cardId }));
            else go(hrefChat(r.sessionId, { focus: inBranch(focus) ? undefined : focus, branch: r.cardId }));
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
            onClick={() => (setMenu(false), setVisualize({ cardId: currentLeaf.id, scope: { kind: "branch", cardIds: scopeCards("branch", cards, currentLeaf.id), label: "This branch" } }))}
          >
            <span className="row-line"><Icon name="visualize" size={16} /> Visualize this branch</span>
          </button>
          <button
            className="row-btn"
            onClick={() => (setMenu(false), setVisualize({ cardId: currentLeaf.id, scope: { kind: "topic", cardIds: scopeCards("topic", cards, currentLeaf.id), label: `The whole topic: ${short(session.title, 40)}` } }))}
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
          <button className="row-btn" onClick={() => go(hrefMap(sid, { focus: currentLeaf.id }))}>
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
          path={new Set(pathToRoot(idx, currentLeaf.id).map((c) => c.id))}
          onPick={(id) => {
            setBranchesOpen(false);
            open(id);
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
          onOpen={(id) => (setOpenHighlight(undefined), open(id))}
          onDelete={async () => {
            setOpenHighlight(undefined);
            setTray((t) => t.filter((x) => x !== hl.id));
            await deleteHighlight(hl.id);
          }}
          onClose={() => setOpenHighlight(undefined)}
        />
      )}
      {picture && idx.get(picture.cardId) && (
        <PictureSheet
          card={idx.get(picture.cardId)!}
          i={picture.i}
          onPart={(blob, box) => {
            setAddPicture({ blob, box, n: Date.now() });
            inputRef.current?.focus();
          }}
          onClose={() => setPicture(undefined)}
        />
      )}
      {storyFor && <StoryStartSheet sessionId={sid} cardId={storyFor} onClose={() => setStoryFor(undefined)} />}
      {quickOpen && <QuickSheet sessionId={sid} quickId={quickOpen.id} draft={quickOpen.draft} onClose={() => setQuickOpen(undefined)} />}
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
  onOpen,
  live,
  pyramid,
  marks,
  partMarks,
  onPicture,
  find,
  onMenu,
  visuals,
  quicks,
  checks,
  onQuick,
  onVisualize,
  onVisuals,
  onContinue,
}: {
  card: Card;
  idx: CardIndex;
  /** open a card: in the original, or as a branch beside it */
  onOpen: (id: string) => void;
  live?: StreamView;
  pyramid: boolean;
  marks: AnswerMark[];
  /** highlights in the text read from the question's pictures */
  partMarks: (part: string) => AnswerMark[];
  onPicture: (i: number) => void;
  find?: string;
  onMenu: (id: string) => void;
  visuals: number;
  quicks: Quick[];
  checks: ClaimCheck[];
  onQuick: (id: string) => void;
  onVisualize: () => void;
  onVisuals: () => void;
  onContinue: (model: string) => void;
}) {
  // other questions asked at the same point (branches from words have their own tabs instead)
  const sibs = startsBranch(card) ? [card] : siblings(idx, card.id).filter((c) => !startsBranch(c));
  const i = sibs.findIndex((s) => s.id === card.id);
  const quotes = card.anchor?.quotes?.length ? card.anchor.quotes : card.anchor ? [card.anchor.text] : [];
  const streaming = card.status === "streaming";
  const md = answerMarkdown(card, live, pyramid);
  return (
    <section className="turn">
      <div className="msg-user" data-card-id={card.id}>
        {card.images?.length ? <MessageThumbs card={card} onOpen={onPicture} /> : null}
        {quotes.map((q, k) => (
          <p key={k} className="quote-line">{q}</p>
        ))}
        <div className="bubble">{card.question}</div>
        {sibs.length > 1 && (
          <div className="sibs" role="group" aria-label="Other questions asked here">
            <button className="btn icon sm" aria-label="Previous branch" disabled={i <= 0} onClick={() => onOpen(sibs[i - 1].id)}>
              <Icon name="prev" size={15} />
            </button>
            <span className="small muted">{i + 1}/{sibs.length}</span>
            <button className="btn icon sm" aria-label="Next branch" disabled={i >= sibs.length - 1} onClick={() => onOpen(sibs[i + 1].id)}>
              <Icon name="next" size={15} />
            </button>
          </div>
        )}
      </div>
      {card.images?.length ? <ImageTexts card={card} marks={partMarks} /> : null}
      <div className="msg-ai">
        {streaming && <ReasoningPanel assistant={card.assistant} live={live?.reasoning} />}
        {md ? (
          <AnswerText cardId={card.id} markdown={md} marks={marks} find={find} selectable={!streaming} />
        ) : streaming ? (
          <p className="muted pulse" role="status">Answering…</p>
        ) : null}
        <RetryNotice card={card} />
        {card.council && <CouncilPanel council={card.council} onContinue={onContinue} />}
        <QuickNotes quicks={quicks} onOpen={onQuick} />
        <CheckNotes checks={checks} />
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
