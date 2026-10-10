import { useState } from "react";
import { short } from "../answer";
import { claimCounts, askQuick, checkQuickTurn, deleteCheck, deleteQuick, quickStreamKey, quickToBranch, retryQuickTurn, runClaimCheck, startQuick } from "../quick";
import { go, hrefChat } from "../route";
import { settingsStore, streamStore, updateSettings, useLive, useStore } from "../store";
import { db } from "../db";
import type { ClaimCheck, Quick, QuickTurn } from "../types";
import { AnswerText } from "./AnswerText";
import { Icon } from "./Icon";
import { shortName } from "./ModelPicker";
import { Sheet } from "./Sheet";
import { TaskEditor } from "./TaskEditor";

const NO_MARKS: never[] = [];
const VERDICT = { ok: { icon: "✓", label: "Checked: looks right", cls: "ok" }, unsure: { icon: "?", label: "Checked: unsure", cls: "unsure" }, wrong: { icon: "✗", label: "Checked: likely wrong", cls: "bad" } } as const;
const CLAIM = { supported: { icon: "✓", cls: "ok" }, uncertain: { icon: "?", cls: "unsure" }, disputed: { icon: "✗", cls: "bad" } } as const;
export const QUICK_CHIPS = ["Explain this", "Give an example", "Why is this true?", "Define the terms"];

function TurnView({ q, i, t }: { q: Quick; i: number; t: QuickTurn }) {
  const live = useStore(streamStore)[quickStreamKey(q.id, i)];
  return (
    <div className="quick-turn">
      <p className="quick-q small"><strong>{t.question}</strong></p>
      {t.status === "running" && !live?.content && <p className="muted pulse small" role="status">Answering…</p>}
      {(t.answer || live?.content) && <AnswerText cardId={`${q.id}-${i}`} markdown={t.status === "running" ? live?.content ?? "" : t.answer} marks={NO_MARKS} selectable={false} />}
      {t.status === "error" && (
        <p className="error small" role="alert">
          {t.error} <button className="btn chip" onClick={() => retryQuickTurn(q.id, i)}>Retry</button>
        </p>
      )}
      {t.status === "done" && (
        <div className="quick-meta small muted">
          {t.check?.status === "done" && t.check.verdict ? (
            <span className={`verdict ${VERDICT[t.check.verdict].cls}`} title={t.check.reason}>
              {VERDICT[t.check.verdict].icon} {VERDICT[t.check.verdict].label}
              {t.check.reason ? `: ${t.check.reason}` : ""}
            </span>
          ) : t.check?.status === "running" ? (
            <span className="pulse">Checking…</span>
          ) : (
            <button className="btn chip small-chip" onClick={() => checkQuickTurn(q.id, i)}>
              {t.check?.status === "error" ? "Check failed: try again" : "Check it"}
            </button>
          )}
          <span>{shortName(t.model)}{t.usage?.cost !== undefined ? ` · $${t.usage.cost.toFixed(4)}` : ""}</span>
        </div>
      )}
    </div>
  );
}

/** Quick side threads under an answer: the latest exchange of each, tap to continue. */
export function QuickNotes({ quicks, onOpen }: { quicks: Quick[]; onOpen: (id: string) => void }) {
  if (!quicks.length) return null;
  return (
    <div className="quick-notes">
      {quicks.map((q) => {
        const i = q.turns.length - 1;
        return (
          <section key={q.id} className="quick-note" aria-label="Quick answer">
            <button className="quick-head small" onClick={() => onOpen(q.id)}>
              <Icon name="bolt" size={14} /> Quick{q.quotes.length ? ` · “${short(q.quotes[0], 40)}”${q.quotes.length > 1 ? ` +${q.quotes.length - 1}` : ""}` : ""}
              {q.turns.length > 1 ? ` · ${q.turns.length} questions` : ""}
              <span className="grow" />
              <span className="muted">Open ›</span>
            </button>
            <TurnView q={q} i={i} t={q.turns[i]} />
          </section>
        );
      })}
    </div>
  );
}

/** Start a quick thread (quote shown, one-tap questions), then continue it, check it, or make it a branch. */
export function QuickSheet({
  sessionId,
  quickId,
  draft,
  onClose,
}: {
  sessionId: string;
  quickId?: string;
  draft?: { cardId: string; highlightIds: string[]; quotes: string[] };
  onClose: () => void;
}) {
  const [id, setId] = useState(quickId);
  const [text, setText] = useState("");
  const [settings, setSettings] = useState(false);
  const { quickAutoCheck } = useStore(settingsStore);
  const q = useLive(() => (id ? db.quicks.get(id) : undefined), [id]);
  const quotes = q?.quotes ?? draft?.quotes ?? [];
  const send = async (question: string) => {
    const t = question.trim();
    if (!t) return;
    setText("");
    if (id) await askQuick(id, t);
    else if (draft) setId(await startQuick({ sessionId, ...draft, question: t }));
  };
  return (
    <Sheet title="Quick answer" onClose={onClose}>
      {quotes.map((x, k) => (
        <blockquote key={k} className="quote-block small">{x}</blockquote>
      ))}
      {q?.turns.map((t, i) => <TurnView key={i} q={q} i={i} t={t} />)}
      <div className="chips">
        {QUICK_CHIPS.map((c) => (
          <button key={c} className="btn chip" onClick={() => send(c)}>{c}</button>
        ))}
      </div>
      <form className="composer-row" onSubmit={(e) => (e.preventDefault(), void send(text))}>
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder={id ? "A follow-up…" : "Your quick question…"} aria-label="Quick question" />
        <button className="btn primary icon sm round" type="submit" aria-label="Ask quickly" disabled={!text.trim()}>
          <Icon name="up" />
        </button>
        <button type="button" className="btn icon sm" aria-label="Quick answer settings" onClick={() => setSettings(true)}>
          <Icon name="settings" />
        </button>
      </form>
      {q && (
        <div className="chips">
          <button
            className="btn chip"
            disabled={!q.turns.some((t) => t.status === "done")}
            onClick={async () => {
              const last = await quickToBranch(q.id);
              onClose();
              if (last) go(hrefChat(q.sessionId, { focus: last }));
            }}
          >
            <Icon name="branch" size={14} /> Make it a branch
          </button>
          <button className="btn chip danger" onClick={async () => (await deleteQuick(q.id), onClose())}>Delete</button>
        </div>
      )}
      <p className="muted small">Quick answers stay beside the chat; they aren't sent with later questions unless you make them a branch.</p>
      {settings && (
        <Sheet title="Quick answers" onClose={() => setSettings(false)}>
          <TaskEditor
            id="quick"
            extra={
              <label className="check">
                <input type="checkbox" checked={quickAutoCheck} onChange={(e) => updateSettings({ quickAutoCheck: e.target.checked })} />
                <span>Check every quick answer with a second model (Quick check)</span>
              </label>
            }
          />
          <button className="btn primary" onClick={() => setSettings(false)}>Done</button>
        </Sheet>
      )}
    </Sheet>
  );
}

/** Claim checks under an answer: counts, then each claim with its verdict and reason. */
export function CheckNotes({ checks }: { checks: ClaimCheck[] }) {
  if (!checks.length) return null;
  return (
    <div className="quick-notes">
      {checks.map((c) => {
        const n = claimCounts(c.claims);
        return (
          <section key={c.id} className="quick-note check-note" aria-label="Claim check">
            <div className="quick-head small">
              <Icon name="check" size={14} /> Claim check{c.web ? " (with web search)" : ""}
              {c.status === "done" && (
                <span className="muted">
                  {" "}
                  · {n.supported} ✓ · {n.uncertain} ? · {n.disputed} ✗
                </span>
              )}
              <span className="grow" />
              <button className="btn icon sm" aria-label="Delete claim check" onClick={() => deleteCheck(c.id)}>
                <Icon name="close" size={13} />
              </button>
            </div>
            {c.status === "running" && <p className="muted pulse small" role="status">Checking the claims…</p>}
            {c.status === "error" && (
              <p className="error small" role="alert">
                {c.error} <button className="btn chip" onClick={() => runClaimCheck(c.id)}>Retry</button>
              </p>
            )}
            {c.claims.map((cl, k) => (
              <div key={k} className={`claim ${CLAIM[cl.verdict].cls}`}>
                <span className="claim-v" aria-label={cl.verdict}>{CLAIM[cl.verdict].icon}</span>
                <div className="claim-body small">
                  <span>{cl.claim}</span>
                  {cl.reason && <span className="muted"> {cl.reason}</span>}
                </div>
              </div>
            ))}
            {c.status === "done" && <p className="muted small">{shortName(c.model)}{c.usage?.cost !== undefined ? ` · $${c.usage.cost.toFixed(4)}` : ""}</p>}
          </section>
        );
      })}
    </div>
  );
}
