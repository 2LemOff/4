import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { db } from "../db";
import { deleteBranch, retry, startFreshBranch } from "../ai";
import { splitBlocks } from "../blocks";
import { BlockView } from "../components/BlockView";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Composer } from "../components/Composer";
import { ContextMeter } from "../components/ContextMeter";
import { ReasoningPanel } from "../components/ReasoningPanel";
import { SearchSheet } from "../components/SearchSheet";
import { Sheet } from "../components/Sheet";
import { shortName } from "../components/ModelPicker";
import { SynthesizeButton } from "../components/SynthesizeButton";
import { branchTokens, shouldOfferFresh, meter } from "../context";
import { go, hrefCard, hrefDraft } from "../route";
import { modelInfo, modelsStore, streamStore, useLive, useStore } from "../store";
import { children, drillCounts, indexCards, siblings } from "../tree";

export function CardScreen({ sid, cid, hl }: { sid: string; cid: string; hl?: number }) {
  const data = useLive(async () => ({ session: await db.sessions.get(sid), cards: await db.cards.where("sessionId").equals(sid).toArray() }), [sid]);
  const streams = useStore(streamStore);
  useStore(modelsStore);
  const reduce = useReducedMotion();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [busy, setBusy] = useState("");
  const idx = useMemo(() => indexCards(data?.cards ?? []), [data]);

  if (!data) return <div className="center muted">Loading…</div>;
  const card = idx.get(cid);
  if (!card || !data.session) {
    return (
      <div className="center">
        <p>This card no longer exists.</p>
        <a className="btn" href="#/">Home</a>
      </div>
    );
  }

  const live = streams[cid];
  const streaming = card.status === "streaming";
  const blocks = streaming ? splitBlocks(live?.content ?? "") : card.blocks;
  const sibs = siblings(idx, cid);
  const pos = sibs.findIndex((c) => c.id === cid);
  const kids = children(idx, cid);
  const counts = drillCounts(idx, cid);
  const continued = [...idx.values()].find((c) => c.portalFrom === cid);
  const parentHref = card.parentId ? hrefCard(sid, card.parentId) : card.portalFrom ? hrefCard(sid, card.portalFrom) : null;
  const limit = modelInfo(card.model).context_length ?? 0;
  const m = meter(branchTokens(idx, cid), limit);
  const exhausted = card.error?.startsWith("Ran out of room");

  const fresh = async () => {
    setBusy("Summarizing this branch…");
    setMenu(false);
    try {
      const id = await startFreshBranch(cid);
      go(hrefCard(sid, id));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <div className="topbar">
        <Breadcrumbs idx={idx} sid={sid} cid={cid} />
        <button className="btn icon" aria-label="Search" onClick={() => setSearch(true)}>🔍</button>
      </div>
      <div className="navrow">
        <button className="btn" disabled={!parentHref} onClick={() => parentHref && go(parentHref)}>
          ↑ {card.parentId ? "Parent" : card.portalFrom ? "Original" : "Parent"}
        </button>
        <div className="sib" aria-label="Sibling questions">
          <button className="btn icon" aria-label="Previous question" disabled={pos <= 0} onClick={() => go(hrefCard(sid, sibs[pos - 1].id))}>◀</button>
          <span className="small" aria-live="polite">{sibs.length ? `${pos + 1} / ${sibs.length}` : "1 / 1"}</span>
          <button className="btn icon" aria-label="Next question" disabled={pos < 0 || pos >= sibs.length - 1} onClick={() => go(hrefCard(sid, sibs[pos + 1].id))}>▶</button>
        </div>
        <button className="btn icon" aria-label="Card menu" onClick={() => setMenu(true)}>⋯</button>
      </div>

      <motion.main key={cid} className="scroll pad" initial={reduce ? false : { x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.18 }}>
        <header className="card-head">
          {card.anchor ? (
            <>
              <blockquote className="anchor">{card.anchor.text}</blockquote>
              <p className="question">Q: {card.question}</p>
            </>
          ) : (
            <h1 className="question">{card.question}</h1>
          )}
        </header>

        {card.portalFrom && <p className="muted small">Continued from an earlier branch. This answer summarizes it.</p>}
        <BlockView blocks={blocks} counts={counts} highlight={hl} disabled={streaming} onTap={(b, s) => go(hrefDraft(sid, cid, b, s))} />

        {streaming && <p className="muted pulse" role="status">{blocks.length ? "Answering…" : "Thinking…"}</p>}
        {card.status === "error" && !exhausted && (
          <div className="notice error" role="alert">
            <p>{card.error ?? "Something went wrong."}</p>
            <button className="btn" onClick={() => retry(cid)}>Retry</button>
          </div>
        )}
        {(card.status === "length" || exhausted) && (
          <div className="notice error" role="alert">
            <p>{exhausted ? "Ran out of room while thinking." : "The answer was cut off at the token limit."}</p>
            <div className="chips">
              <button className="btn chip" onClick={() => retry(cid, "more")}>More tokens</button>
              <button className="btn chip" onClick={() => retry(cid, "lower")}>Lower effort</button>
              <button className="btn chip" onClick={() => retry(cid)}>Retry</button>
            </div>
          </div>
        )}
        {card.status === "refused" && (
          <div className="notice error" role="alert">
            <p>The model declined to answer this.</p>
            <button className="btn" onClick={() => retry(cid)}>Retry</button>
          </div>
        )}

        <ReasoningPanel assistant={card.assistant} live={streaming ? live?.reasoning : undefined} />

        {continued && (
          <button className="row-btn" onClick={() => go(hrefCard(sid, continued.id))}>
            Continued in a fresh branch ▸
          </button>
        )}

        {!!kids.length && (
          <section aria-label="Questions on this card">
            <h2 className="section">Questions on this card ({kids.length})</h2>
            {kids.map((k) => (
              <button key={k.id} className="row-btn" onClick={() => go(hrefCard(sid, k.id))}>
                <strong>{k.tag ?? k.question}</strong>
                {k.anchor && <span className="muted small">on “{k.anchor.text.slice(0, 70)}”</span>}
              </button>
            ))}
          </section>
        )}

        <footer className="meta small muted">
          {shortName(card.model)}
          {card.usage?.cost !== undefined ? ` · $${card.usage.cost.toFixed(4)}` : ""}
          {card.usage?.reasoning ? ` · ${card.usage.reasoning.toLocaleString()} reasoning tokens` : ""}
        </footer>
      </motion.main>

      <div className="dock">
        {busy && <p className="muted small" role="status">{busy}</p>}
        <ContextMeter used={m.used} limit={limit} onFresh={fresh} />
        <Composer sessionId={sid} parentId={cid} placeholder="Ask about this whole card…" defaultModel={card.model} />
        <SynthesizeButton sessionId={sid} sessionModel={data.session.answerModel} />
      </div>

      {menu && (
        <Sheet title="Card menu" onClose={() => setMenu(false)}>
          <button className="row-btn" onClick={fresh}>Continue in a fresh branch{shouldOfferFresh(m) ? " (recommended)" : ""}</button>
          <button className="row-btn" onClick={() => { void navigator.clipboard?.writeText(card.assistant?.content ?? ""); setMenu(false); }}>Copy answer</button>
          <details className="row-btn">
            <summary>System prompt used by this session</summary>
            <pre className="prompt-pre">{data.session.systemPrompt}</pre>
          </details>
          <button
            className="row-btn danger"
            onClick={async () => {
              if (!confirm("Delete this card and every question below it?")) return;
              const r = await deleteBranch(cid);
              setMenu(false);
              go(r.next ? hrefCard(r.sessionId, r.next) : "#/");
            }}
          >
            Delete this card and its branches
          </button>
        </Sheet>
      )}
      {search && <SearchSheet onClose={() => setSearch(false)} />}
    </>
  );
}
