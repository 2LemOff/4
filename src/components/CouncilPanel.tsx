import { outlineText } from "../answer";
import type { CouncilData } from "../types";
import { shortName } from "./ModelPicker";

const STAGE = { members: "Members answering", reviews: "Reviewing each other", chairman: "Chairman writing", checking: "Checking grounding", done: "Done", error: "Failed" } as const;

export function CouncilPanel({ council, onContinue }: { council: CouncilData; onContinue: (model: string) => void }) {
  const done = council.members.filter((m) => m.status !== "running").length;
  const rank = new Map(council.aggregate.map((a) => [a.label, a.avgRank]));
  return (
    <details className="group council" open={council.stage !== "done"}>
      <summary>
        Council · {council.stage === "members" ? `Members ${done}/${council.members.length}` : STAGE[council.stage]} · chairman {shortName(council.chairman)}
      </summary>
      {council.unsupported && council.unsupported.length > 0 && (
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
          {m.status === "done" && <pre className="prompt-pre">{m.answer ? outlineText(m.answer) : m.content}</pre>}
          {m.status === "done" && (
            <button className="btn chip" onClick={() => onContinue(m.model)}>
              Continue with this model
            </button>
          )}
        </details>
      ))}
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
  );
}
