import { useMemo } from "react";
import { barScale, uncovered, type AnyDiagram, type CauseSpec, type CompareSpec, type ConceptSpec, type DiagramType, type FlowSpec, type ScaleSpec, type TimelineSpec, type VennSpec } from "../../diagrams";
import type { Sentence } from "../../split";
import { conceptLayout, wrap } from "../../viewLayout";
import { PanZoom } from "./PanZoom";

type Open = (title: string, ids: string[]) => void;

/** One AI diagram; every element opens the exact sentences it came from. */
export function DiagramView({ type, spec, sentences, onOpen }: { type: DiagramType; spec: AnyDiagram; sentences: Sentence[]; onOpen: Open }) {
  const left = useMemo(() => uncovered(spec, sentences), [spec, sentences]);
  return (
    <div className="vview diagram">
      {type === "concept" && <Concept spec={spec as ConceptSpec} onOpen={onOpen} />}
      {type === "compare" && <Compare spec={spec as CompareSpec} onOpen={onOpen} />}
      {type === "venn" && <Venn spec={spec as VennSpec} onOpen={onOpen} />}
      {type === "flow" && <Flow spec={spec as FlowSpec} onOpen={onOpen} />}
      {type === "cause" && <Cause spec={spec as CauseSpec} onOpen={onOpen} />}
      {type === "timeline" && <Timeline spec={spec as TimelineSpec} onOpen={onOpen} />}
      {(type === "scale" || type === "chart") && <Bars spec={spec as ScaleSpec} ladder={type === "scale"} onOpen={onOpen} />}
      {left.length > 0 && (
        <details className="group">
          <summary className="small">Not in this diagram ({left.length})</summary>
          {left.map((s) => (
            <button key={s.id} className="vrow" onClick={() => onOpen("Not in this diagram", [s.id])}>
              <span className="small">{s.text}</span>
            </button>
          ))}
        </details>
      )}
    </div>
  );
}

function Concept({ spec, onOpen }: { spec: ConceptSpec; onOpen: Open }) {
  const d = useMemo(() => conceptLayout(spec), [spec]);
  const at = new Map(d.boxes.map((b) => [b.id, b]));
  if (!d.boxes.length) return <p className="muted">Nothing to draw.</p>;
  return (
    <PanZoom width={d.width} height={d.height} label="Concept map">
      <svg className="vlines" width={d.width} height={d.height}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="currentColor" />
          </marker>
        </defs>
        {d.lines.map((l, i) => {
          const f = at.get(l.from)!;
          const t = at.get(l.to)!;
          const y1 = f.y + f.h / 2;
          const y2 = t.y - t.h / 2;
          return (
            <g key={i}>
              <line x1={f.x} y1={y1} x2={t.x} y2={y2} markerEnd="url(#arrow)" />
              {l.label && (
                <text x={(f.x + t.x) / 2} y={(y1 + y2) / 2} className="vline-label" textAnchor="middle" onClick={() => onOpen(l.label!, l.sources ?? [])}>
                  {l.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {d.boxes.map((b) => (
        <button key={b.id} className="vnode item" style={{ left: b.x - b.w / 2, top: b.y - b.h / 2, width: b.w, minHeight: b.h }} onClick={() => onOpen(b.label, b.sources)}>
          <span className="vnode-text">{wrap(b.label, 18).join("\n")}</span>
        </button>
      ))}
    </PanZoom>
  );
}

function Compare({ spec, onOpen }: { spec: CompareSpec; onOpen: Open }) {
  if (!spec.columns.length) return <p className="muted">Nothing to compare.</p>;
  return (
    <div className="table-wrap">
      <table className="vtable">
        <thead>
          <tr>
            <th />
            {spec.columns.map((c) => (
              <th key={c.id}>
                <button className="link-btn" onClick={() => onOpen(c.title, c.sources)}>{c.title}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((r, i) => (
            <tr key={i}>
              <th scope="row">{r.label}</th>
              {spec.columns.map((c) => {
                const cell = r.cells.find((x) => x.column === c.id);
                return (
                  <td key={c.id}>
                    {cell && (
                      <button className="link-btn" onClick={() => onOpen(`${r.label} · ${c.title}`, cell.sources)}>
                        {cell.text}
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Venn({ spec, onOpen }: { spec: VennSpec; onOpen: Open }) {
  const col = (title: string, items: { text: string; sources: string[] }[], cls: string) => (
    <section className={`venn-col ${cls}`}>
      <h3 className="vgroup-title">{title}</h3>
      {items.map((it, i) => (
        <button key={i} className="vrow" onClick={() => onOpen(title, it.sources)}>
          <span className="small">{it.text}</span>
        </button>
      ))}
      {!items.length && <p className="muted small">Nothing here.</p>}
    </section>
  );
  return (
    <>
      <svg className="venn" viewBox="0 0 240 120" role="img" aria-label={`${spec.a.title} and ${spec.b.title}`}>
        <circle cx="90" cy="60" r="52" className="venn-a" />
        <circle cx="150" cy="60" r="52" className="venn-b" />
        <text x="62" y="64" textAnchor="middle">{spec.a.items.length}</text>
        <text x="120" y="64" textAnchor="middle">{spec.both.length}</text>
        <text x="178" y="64" textAnchor="middle">{spec.b.items.length}</text>
      </svg>
      {col(`Only ${spec.a.title || "A"}`, spec.a.items, "a")}
      {col("Both", spec.both, "both")}
      {col(`Only ${spec.b.title || "B"}`, spec.b.items, "b")}
    </>
  );
}

function Flow({ spec, onOpen }: { spec: FlowSpec; onOpen: Open }) {
  return (
    <ol className="flow">
      {spec.steps.map((s, i) => (
        <li key={i}>
          <button className="vcard" onClick={() => onOpen(s.label, s.sources)}>
            <strong>
              {i + 1}. {s.label}
            </strong>
            {s.detail && <span className="small">{s.detail}</span>}
          </button>
          {i < spec.steps.length - 1 && <span className="flow-arrow" aria-hidden>↓</span>}
        </li>
      ))}
    </ol>
  );
}

function Cause({ spec, onOpen }: { spec: CauseSpec; onOpen: Open }) {
  return (
    <div className="causes">
      {spec.links.map((l, i) => (
        <button key={i} className="vrow cause" onClick={() => onOpen(`${l.cause} → ${l.effect}`, l.sources)}>
          <span className="cause-a">{l.cause}</span>
          <span aria-hidden>→</span>
          <span className="cause-b">{l.effect}</span>
        </button>
      ))}
    </div>
  );
}

function Timeline({ spec, onOpen }: { spec: TimelineSpec; onOpen: Open }) {
  return (
    <ol className="timeline">
      {spec.events.map((e, i) => (
        <li key={i}>
          <button className="vrow" onClick={() => onOpen(`${e.when} · ${e.label}`, e.sources)}>
            <strong className="small">{e.when}</strong>
            <span>{e.label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Bars({ spec, ladder, onOpen }: { spec: ScaleSpec; ladder: boolean; onOpen: Open }) {
  const s = barScale(spec.items.map((i) => i.value));
  const fmt = (v: number) => (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : String(+v.toPrecision(4)));
  return (
    <div className={`bars ${ladder ? "ladder" : ""}`}>
      {s.log && <p className="muted small">Log scale: the values differ more than 100 times.</p>}
      {spec.items.map((it, i) => (
        <button key={i} className="bar-row" onClick={() => onOpen(it.label, it.sources)}>
          <span className="bar-label small">{it.label}</span>
          <span className="bar-track">
            <span className="bar" style={{ width: `${Math.round(s.at(it.value) * 100)}%` }} />
          </span>
          <span className="bar-value small">
            {fmt(it.value)} {it.unit}
          </span>
        </button>
      ))}
    </div>
  );
}
