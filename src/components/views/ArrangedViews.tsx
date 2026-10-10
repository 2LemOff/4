import { useMemo, useState, type ReactNode } from "react";
import { itemsIn, type Arrangement, type ArrangedItem, type ItemKind } from "../../arrange";
import { paragraphs, type Sentence } from "../../split";
import { radialLayout, wrap } from "../../viewLayout";
import { Clamp } from "./Clamp";
import { PanZoom } from "./PanZoom";

export interface Badge {
  branches: number;
  council?: boolean;
  bookmarked?: boolean;
  disputed?: boolean;
}

export interface ViewProps {
  a: Arrangement;
  sentences: Sentence[];
  badges: Map<string, Badge>;
  /** show these sentences (exact words) with Ask / Show in the answer */
  onOpen: (title: string, ids: string[]) => void;
}

const KIND_LABEL: Record<ItemKind, string> = { foundation: "Foundation", step: "Step", conclusion: "Conclusion", detail: "Detail", example: "Example" };

function useText(sentences: Sentence[]) {
  return useMemo(() => new Map(sentences.map((s) => [s.id, s.text])), [sentences]);
}

function Badges({ ids, badges }: { ids: string[]; badges: Map<string, Badge> }) {
  const n = ids.reduce((m, id) => m + (badges.get(id)?.branches ?? 0), 0);
  const council = ids.some((id) => badges.get(id)?.council);
  const bookmarked = ids.some((id) => badges.get(id)?.bookmarked);
  const disputed = ids.some((id) => badges.get(id)?.disputed);
  if (!n && !council && !bookmarked && !disputed) return null;
  return (
    <span className="vbadges">
      {n > 0 && <span className="vbadge" title="Questions asked about it">↳ {n}</span>}
      {council && <span className="vbadge">Council</span>}
      {disputed && <span className="vbadge bad">Disputed</span>}
      {bookmarked && <span className="vbadge">Saved</span>}
    </span>
  );
}

// ── Big idea → details ───────────────────────────────────────────────────────

export function BigIdeaView({ a, sentences, badges, onOpen }: ViewProps) {
  const text = useText(sentences);
  const [detail, setDetail] = useState<"big" | "mid" | "fine">("mid");
  const [order, setOrder] = useState<"idea" | "principles">("idea");
  const kinds: ItemKind[] = order === "idea" ? ["conclusion", "step", "foundation", "detail", "example"] : ["foundation", "step", "conclusion", "detail", "example"];
  const conclusions = a.items.filter((i) => i.kind === "conclusion");
  const headline = conclusions.length ? conclusions : a.items.slice(0, 1);
  const groups = a.groups.filter((g) => a.items.some((i) => i.group === g.id));
  const byKind = (items: ArrangedItem[]) => [...items].sort((x, y) => kinds.indexOf(x.kind) - kinds.indexOf(y.kind));
  return (
    <div className="vview bigidea">
      <div className="vbar">
        <div className="seg" role="group" aria-label="Detail">
          {(["big", "mid", "fine"] as const).map((d) => (
            <button key={d} className={detail === d ? "on" : ""} aria-pressed={detail === d} onClick={() => setDetail(d)}>
              {d === "big" ? "Big" : d === "mid" ? "Mid" : "Fine"}
            </button>
          ))}
        </div>
        <button className="btn chip" onClick={() => setOrder(order === "idea" ? "principles" : "idea")}>
          {order === "idea" ? "Big idea first" : "First principles first"} ⇄
        </button>
      </div>
      {order === "idea" && <h2 className="big-title">{a.title}</h2>}
      <div className="big-cards">
        {headline.map((it) => (
          <button key={it.id} className="vcard concl" onClick={() => onOpen(it.label, [it.id])}>
            <strong>{it.label}</strong>
            {detail !== "big" && <Clamp text={text.get(it.id) ?? ""} lines={3} />}
            <Badges ids={[it.id]} badges={badges} />
          </button>
        ))}
      </div>
      {detail !== "big" &&
        groups.map((g) => {
          const items = byKind(a.items.filter((i) => i.group === g.id && !headline.includes(i)));
          if (!items.length) return null;
          return (
            <section key={g.id} className="vgroup">
              <h3 className="vgroup-title">{g.title}</h3>
              {detail === "mid" ? (
                <div className="chips">
                  {items.map((it) => (
                    <button key={it.id} className={`btn chip kind-${it.kind}`} onClick={() => onOpen(it.label, [it.id])}>
                      {it.label}
                      {(badges.get(it.id)?.branches ?? 0) > 0 ? ` ↳${badges.get(it.id)!.branches}` : ""}
                    </button>
                  ))}
                </div>
              ) : (
                items.map((it) => (
                  <button key={it.id} className={`vrow kind-${it.kind}`} onClick={() => onOpen(it.label, [it.id])}>
                    <span className="kind-badge">{KIND_LABEL[it.kind]}</span>
                    <Clamp text={text.get(it.id) ?? ""} />
                    <Badges ids={[it.id]} badges={badges} />
                  </button>
                ))
              )}
            </section>
          );
        })}
      {order === "principles" && <h2 className="big-title bottom">{a.title}</h2>}
    </div>
  );
}

// ── Levels ───────────────────────────────────────────────────────────────────

export function LevelsView({
  a,
  sentences,
  badges,
  onOpen,
  onGhost,
  onAskLevel,
  onMore,
  onCompare,
}: ViewProps & {
  onGhost: (name: string, level: string) => void;
  onAskLevel: (name: string) => void;
  onMore: (level: number) => Promise<void>;
  onCompare: (x: string, y: string) => void;
}) {
  const text = useText(sentences);
  const [focus, setFocus] = useState<number | undefined>(undefined);
  const [showAll, setShowAll] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number>();
  const [q, setQ] = useState("");
  const [compare, setCompare] = useState<string[] | null>(null);
  const match = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  const pick = (name: string) => {
    if (!compare) return false;
    setCompare(compare.includes(name) ? compare.filter((x) => x !== name) : [...compare, name].slice(-2));
    return true;
  };
  const groups = a.groups.filter((g) => !g.parent && itemsIn(a, g.id).length);
  const explored = (gid: string) => itemsIn(a, gid).some((i) => (badges.get(i.id)?.branches ?? 0) > 0);
  const here = a.levels.length;

  return (
    <div className="vview levels">
      <div className="vbar">
        <input className="input grow" placeholder="Search the levels…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the levels" />
        <button className={`btn chip ${compare ? "on" : ""}`} aria-pressed={!!compare} onClick={() => setCompare(compare ? null : [])}>
          Compare 2
        </button>
      </div>
      {compare && (
        <p className="small muted">
          {compare.length < 2 ? `Tap two topics to compare (${compare.length}/2).` : `${compare[0]} vs ${compare[1]}`}{" "}
          {compare.length === 2 && <button className="btn chip" onClick={() => onCompare(compare[0], compare[1])}>Compare in the chat</button>}
        </p>
      )}
      {!a.levels.length && <p className="muted small">No wider levels were found for this; only its own parts are shown.</p>}
      {a.levels.map((l, i) => {
        const open = focus === i;
        const all = showAll.has(i) || open;
        const sibs = l.siblings.filter(match);
        const shown = all ? sibs : sibs.slice(0, 4);
        const more = sibs.length - shown.length;
        return (
          <section key={`${l.name}-${i}`} className={`band ${open ? "open" : ""} ${match(l.name) || sibs.length ? "" : "dim"}`} aria-label={`Level ${i + 1}: ${l.name}`} style={{ marginInline: `${Math.min(i, 5) * 4}px` }}>
            <div className="band-head">
              <button className={`btn chip here ${compare?.includes(l.name) ? "picked" : ""}`} onClick={() => pick(l.name) || setFocus(open ? undefined : i)} aria-expanded={open}>
                {l.name}
              </button>
              <span className="grow" />
              <button className="btn icon sm" aria-label={`What else is on the level of ${l.name}?`} disabled={busy === i} onClick={async () => { setBusy(i); try { await onMore(i); } finally { setBusy(undefined); } }}>
                {busy === i ? "…" : "＋"}
              </button>
              <button className="btn chip" onClick={() => onAskLevel(l.name)}>Question it ↓</button>
            </div>
            {l.about && (open ? <p className="small band-about">{l.about}</p> : <Clamp text={l.about} lines={1} className="small band-about" />)}
            <div className="ghosts">
              {shown.map((s) => (
                <button key={s} className={`ghost ${compare?.includes(s) ? "picked" : ""}`} onClick={() => pick(s) || onGhost(s, l.name)}>
                  {s}
                </button>
              ))}
              {more > 0 && <button className="btn chip" onClick={() => setShowAll(new Set(showAll).add(i))}>+{more}</button>}
            </div>
          </section>
        );
      })}
      <section className="band here-band" aria-label="This answer">
        <div className="band-head">
          <span className="btn chip here on">{a.title}</span>
        </div>
        <div className="level-groups">
          {groups.map((g) => {
            const items = itemsIn(a, g.id).filter((it) => match(it.label) || match(text.get(it.id) ?? "") || match(g.title));
            if (!items.length) return null;
            return (
              <div key={g.id} className={`lgroup ${explored(g.id) ? "explored" : ""} ${compare?.includes(g.title) ? "picked" : ""}`}>
                <button className="lgroup-title" onClick={() => pick(g.title) || onOpen(g.title, items.map((x) => x.id))}>
                  {g.title}
                  <Badges ids={items.map((x) => x.id)} badges={badges} />
                </button>
                <div className="chips">
                  {items.map((it) => (
                    <button key={it.id} className={`btn chip kind-${it.kind}`} onClick={() => onOpen(it.label, [it.id])}>
                      {it.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="muted small">{here ? `${here} wider level${here > 1 ? "s" : ""} above. ` : ""}Dashed topics are neighbours you haven't asked about yet.</p>
      </section>
    </div>
  );
}

// ── Mind map ─────────────────────────────────────────────────────────────────

export function MindMapView({ a, badges, onOpen }: ViewProps) {
  const d = useMemo(() => radialLayout(a), [a]);
  const at = new Map(d.boxes.map((b) => [b.id, b]));
  const groupItems = (gid: string) => a.items.filter((i) => i.group === gid).map((i) => i.id);
  return (
    <PanZoom width={d.width} height={d.height} label={`Mind map of ${a.title}`}>
      <svg className="vlines" width={d.width} height={d.height} aria-hidden>
        {d.lines.map((l) => {
          const f = at.get(l.from)!;
          const t = at.get(l.to)!;
          return <line key={`${l.from}>${l.to}`} x1={f.x} y1={f.y} x2={t.x} y2={t.y} />;
        })}
      </svg>
      {d.boxes.map((b) => (
        <button
          key={b.id}
          className={`vnode ${b.kind}`}
          style={{ left: b.x - b.w / 2, top: b.y - b.h / 2, width: b.w, minHeight: b.h }}
          onClick={() => (b.kind === "item" ? onOpen(b.label, b.sources) : b.kind === "group" ? onOpen(b.label, groupItems(b.id.slice(2))) : onOpen(a.title, a.items.filter((i) => i.kind === "conclusion").map((i) => i.id)))}
        >
          <span className="vnode-text">{wrap(b.label, b.kind === "item" ? 16 : 18).join("\n")}</span>
          {b.kind === "item" && (badges.get(b.id)?.branches ?? 0) > 0 && <span className="vbadge">↳ {badges.get(b.id)!.branches}</span>}
        </button>
      ))}
    </PanZoom>
  );
}

// ── Argument chain ───────────────────────────────────────────────────────────

export function ChainView({ a, sentences, badges, onOpen }: ViewProps) {
  const text = useText(sentences);
  const label = new Map(a.items.map((i) => [i.id, i.label]));
  const sections: [string, ItemKind[]][] = [
    ["Foundations", ["foundation"]],
    ["Steps", ["step"]],
    ["Conclusions", ["conclusion"]],
    ["Also", ["detail", "example"]],
  ];
  return (
    <div className="vview chain">
      {sections.map(([title, ks]) => {
        const items = a.items.filter((i) => ks.includes(i.kind));
        if (!items.length) return null;
        return (
          <section key={title} className="vgroup">
            <h3 className="vgroup-title">{title}</h3>
            {items.map((it) => (
              <button key={it.id} className={`vrow kind-${it.kind}`} onClick={() => onOpen(it.label, [it.id])}>
                <strong className="small">{it.label}</strong>
                <Clamp text={text.get(it.id) ?? ""} />
                {it.from.length > 0 && <span className="small muted">builds on: {it.from.map((f) => label.get(f) ?? f).join(" · ")}</span>}
                <Badges ids={[it.id]} badges={badges} />
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// ── Outline ──────────────────────────────────────────────────────────────────

export function OutlineList({ a, sentences, badges, onOpen }: ViewProps) {
  const text = useText(sentences);
  const walk = (parent: string | null, depth: number): ReactNode =>
    a.groups
      .filter((g) => g.parent === parent)
      .map((g) => (
        <li key={g.id} style={{ paddingLeft: Math.min(depth, 4) * 12 }}>
          <button className="outline-group" onClick={() => onOpen(g.title, itemsIn(a, g.id).map((i) => i.id))}>{g.title}</button>
          <ul className="outline">
            {a.items.filter((i) => i.group === g.id).map((it) => (
              <li key={it.id}>
                <button className="vrow" onClick={() => onOpen(it.label, [it.id])}>
                  <Clamp text={text.get(it.id) ?? ""} />
                  <Badges ids={[it.id]} badges={badges} />
                </button>
              </li>
            ))}
          </ul>
          <ul className="outline">{walk(g.id, depth + 1)}</ul>
        </li>
      ));
  return (
    <div className="vview">
      <h2 className="big-title">{a.title}</h2>
      <ul className="outline">{walk(null, 0)}</ul>
    </div>
  );
}

// ── Study doc ────────────────────────────────────────────────────────────────

export function StudyDoc({ a, sentences, badges, onOpen, notes, onNotes, side }: ViewProps & { notes: string; onNotes: (t: string) => void; side: ReactNode }) {
  const sections = a.groups.filter((g) => a.items.some((i) => i.group === g.id));
  return (
    <div className="vview doc">
      <h2 className="big-title">{a.title}</h2>
      {sections.map((g) => {
        const ids = new Set(a.items.filter((i) => i.group === g.id).map((i) => i.id));
        const paras = paragraphs(sentences.filter((s) => ids.has(s.id)));
        return (
          <section key={g.id} className="doc-section">
            <h3 className="vgroup-title">
              {g.title} <Badges ids={[...ids]} badges={badges} />
            </h3>
            {paras.map((p) =>
              p.heading ? (
                <h4 key={p.ids[0]} className="doc-sub">{p.text}</h4>
              ) : (
                <button key={p.ids[0]} className={`vrow plain ${p.list ? "doc-li" : ""}`} onClick={() => onOpen(g.title, p.ids)}>
                  <Clamp text={p.text} />
                </button>
              ),
            )}
          </section>
        );
      })}
      <label className="field">
        <span className="field-label">My notes</span>
        <textarea className="input" rows={4} defaultValue={notes} onBlur={(e) => onNotes(e.target.value)} aria-label="My notes" placeholder="Your own words, kept with this doc." />
      </label>
      {side}
    </div>
  );
}
