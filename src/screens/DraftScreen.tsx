import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { db } from "../db";
import { splitSentences } from "../blocks";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Composer } from "../components/Composer";
import { go, hrefCard } from "../route";
import { useLive } from "../store";
import { children, indexCards } from "../tree";

/** The card that slides in when a sentence is tapped: that sentence is its header, with an input for the question. */
export function DraftScreen({ sid, cid, block, sentence }: { sid: string; cid: string; block?: number; sentence?: number }) {
  const data = useLive(async () => ({ session: await db.sessions.get(sid), cards: await db.cards.where("sessionId").equals(sid).toArray() }), [sid]);
  const reduce = useReducedMotion();
  const idx = useMemo(() => indexCards(data?.cards ?? []), [data]);
  if (!data) return <div className="center muted">Loading…</div>;
  const parent = idx.get(cid);
  if (!parent) return <div className="center"><p>This card no longer exists.</p><a className="btn" href="#/">Home</a></div>;

  const whole = block === undefined || sentence === undefined;
  const text = whole ? undefined : splitSentences(parent.blocks[block!] ?? "")[sentence!];
  const anchor = text !== undefined ? { text, blockIdx: block!, sentenceIdx: sentence! } : undefined;
  const existing = children(idx, cid).filter((c) => (anchor ? c.anchor?.blockIdx === anchor.blockIdx && c.anchor?.sentenceIdx === anchor.sentenceIdx : !c.anchor));

  return (
    <>
      <div className="topbar">
        <Breadcrumbs idx={idx} sid={sid} cid={cid} />
      </div>
      <div className="navrow">
        <button className="btn" onClick={() => go(hrefCard(sid, cid))}>↑ Back to card</button>
      </div>
      <motion.main className="scroll pad" initial={reduce ? false : { x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.18 }}>
        <header className="card-head">
          {anchor ? <blockquote className="anchor big">{anchor.text}</blockquote> : <h1 className="question">Ask about this whole card</h1>}
          <p className="muted">What do you want to ask about this?</p>
        </header>
        {!!existing.length && (
          <section aria-label="Existing questions">
            <h2 className="section">Already asked ({existing.length})</h2>
            {existing.map((c) => (
              <button key={c.id} className="row-btn" onClick={() => go(hrefCard(sid, c.id))}>
                <strong>{c.tag ?? c.question}</strong>
                <span className="muted small">{c.question}</span>
              </button>
            ))}
          </section>
        )}
        <Composer sessionId={sid} parentId={cid} anchor={anchor} placeholder="Type your question…" defaultModel={parent.model} autoFocus />
      </motion.main>
    </>
  );
}
