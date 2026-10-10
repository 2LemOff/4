import { outlineText } from "../answer";
import { agreementLabel } from "../councilLogic";
import type { CouncilData } from "../types";
import { AnswerText } from "./AnswerText";
import { shortName } from "./ModelPicker";

const STAGE = { members: "Members answering", reviews: "Reviewing each other", chairman: "Chairman writing", checking: "Checking grounding", done: "Done", error: "Failed" } as const;
const NO_MARKS: never[] = [];

/**
 * How a council answer was made: agreement, the members' own answers (in full), peer reviews, and what the
 * final answer didn't use. Paragraphs the check couldn't find in the members' answers are folded here.
 */
export function CouncilPanel({ council, onContinue }: { council: CouncilData; onContinue: (model: string) => void }) {
  const done = council.members.filter((m) => m.status !== "running").length;
  const rank = new Map(council.aggregate.map((a) => [a.label, a.avgRank]));
  const text = !!council.textSources;
  return (
    <>
      {council.unverified && council.unverified.length > 0 && (
        <details className="group unverified">
          <summary className="small">
            {council.unverified.length} paragraph{council.unverified.length > 1 ? "s" : ""} not found in the members' answers
          </summary>
          {council.unverified.map((b, i) => (
            <div key={i} className="small unverified-p">
              <AnswerText cardId={`unv-${i}`} markdown={b.text} marks={NO_MARKS} selectable={false} />
              <span className="muted">{b.sources.length ? `Said to come from ${b.sources.join(", ")}` : "No source given"}</span>
            </div>
          ))}
        </details>
      )}
      <details className="group council" open={council.stage !== "done"}>
        <summary>
          Council · {council.stage === "members" ? `Members ${done}/${council.members.length}` : STAGE[council.stage]} · chairman {shortName(council.chairman)}
        </summary>
        {council.agreement !== undefined && (
          <div className="agree" aria-label={`Agreement ${Math.round(council.agreement * 100)}%`}>
            <span className="small">Agreement: {agreementLabel(council.agreement)}</span>
            <span className="agree-track">
              <span className="agree-bar" style={{ width: `${Math.round(council.agreement * 100)}%` }} />
            </span>
          </div>
        )}
        {!text && council.unsupported && council.unsupported.length > 0 && (
          <p className="badge-warn small" role="status">
            {council.removed
              ? `${council.unsupported.length} chairman point(s) weren't found in the council's answers and were removed.`
              : `${council.unsupported.length} chairman point(s) weren't found in the council's answers and are marked.`}
          </p>
        )}
        {council.stage === "done" && !council.unsupported?.length && <p className="muted small">Every point was found in the council's answers.</p>}
        {council.chairmanReasoning && (
          <details className="reasoning">
            <summary>Show the chairman's reasoning</summary>
            <p className="reasoning-text">{council.chairmanReasoning}</p>
          </details>
        )}
        {council.members.map((m) => (
          <details key={m.label} className="member">
            <summary>
              Response {m.label} · {shortName(m.model)}
              {rank.has(m.label) ? ` · average rank ${rank.get(m.label)}` : ""}
              {m.status === "error" ? " · failed" : m.status === "running" ? " · …" : ""}
            </summary>
            {m.error && <p className="error small">{m.error}</p>}
            {m.status === "done" &&
              (m.answer ? <pre className="prompt-pre">{outlineText(m.answer)}</pre> : <AnswerText cardId={`member-${m.label}`} markdown={m.content} marks={NO_MARKS} selectable={false} />)}
            {m.status === "done" && (
              <button className="btn chip" onClick={() => onContinue(m.model)}>
                Continue with this model
              </button>
            )}
          </details>
        ))}
        {council.leftOut && council.leftOut.length > 0 && (
          <details className="member">
            <summary>Not in the final answer ({council.leftOut.length})</summary>
            {council.leftOut.map((x, i) => (
              <p key={i} className="small">
                <strong>{x.label}:</strong> {x.sentence}
              </p>
            ))}
          </details>
        )}
        {council.reviews.length > 0 && (
          <details className="member">
            <summary>Peer reviews</summary>
            {council.reviews.map((r) => (
              <div key={r.label} className="small">
                <strong>Review by {r.label}</strong> ({shortName(r.model)}): ranking {r.ranking.join(" > ") || "none"}
                <p className="muted">{r.error ?? r.evaluation}</p>
              </div>
            ))}
          </details>
        )}
      </details>
    </>
  );
}
