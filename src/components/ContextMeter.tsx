import { meter } from "../context";

export function ContextMeter({ used, limit, onFresh }: { used: number; limit: number; onFresh: () => void }) {
  const m = meter(used, limit);
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <div className={`meter ${m.level}`} aria-label={`Context used: ${m.label}`}>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
        <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${Math.min(1, m.ratio) * c} ${c}`} transform="rotate(-90 12 12)" />
      </svg>
      <span className="small">{m.label}</span>
      {m.level === "warn" && (
        <button className="btn chip" onClick={onFresh}>
          Continue in a fresh branch
        </button>
      )}
    </div>
  );
}
