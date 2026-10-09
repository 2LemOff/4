import { useState } from "react";
import { db } from "../db";
import { createStory } from "../stories";
import { LOOKS, STORY_STYLES, type LookId, type StyleId } from "../storyStyles";
import type { StoryScope } from "../storyTypes";
import { go, hrefStory } from "../route";
import { settingsStore, updateSettings, useLive, useStore } from "../store";
import { Sheet } from "./Sheet";

/** Start a story on demand: what it covers, its storytelling style, picture look and length. */
export function StoryStartSheet({
  sessionId,
  cardId,
  pyramid,
  onClose,
}: {
  sessionId: string;
  cardId: string;
  /** offered when a point is selected */
  pyramid?: { title: string; nodeIds: string[] };
  onClose: () => void;
}) {
  const { story: cfg, apiKey } = useStore(settingsStore);
  const [scope, setScope] = useState<StoryScope>(pyramid ? "pyramid" : "answer");
  const [style, setStyle] = useState<StyleId>(cfg.style);
  const [err, setErr] = useState("");
  const earlier = useLive(() => db.stories.where("cardId").equals(cardId).reverse().sortBy("createdAt"), [cardId]);
  const set = (p: Partial<typeof cfg>) => updateSettings((s) => ({ story: { ...s.story, ...p } }));

  const start = async () => {
    if (!apiKey) return setErr("Connect OpenRouter in Settings first.");
    const id = await createStory({ sessionId, cardId, scope, nodeIds: scope === "pyramid" ? pyramid?.nodeIds : undefined, style });
    onClose();
    go(hrefStory(id));
  };

  const scopes: [StoryScope, string][] = [
    ["answer", "This answer"],
    ...(pyramid ? ([["pyramid", `Pyramid “${pyramid.title}”`]] as [StoryScope, string][]) : []),
    ["branch", "The whole branch to here"],
  ];

  return (
    <Sheet title="Learn as a story" onClose={onClose}>
      <p className="muted small">A few narrated slides with AI-drawn pictures. Nothing is generated until you start.</p>
      <div className="field">
        <span className="field-label">Covers</span>
        <div className="chips" role="radiogroup" aria-label="Covers">
          {scopes.map(([id, label]) => (
            <button key={id} role="radio" aria-checked={scope === id} className={`btn chip ${scope === id ? "on" : ""}`} onClick={() => setScope(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Style</span>
        <div className="chips" role="radiogroup" aria-label="Style">
          {(Object.keys(STORY_STYLES) as StyleId[]).map((id) => (
            <button key={id} role="radio" aria-checked={style === id} className={`btn chip ${style === id ? "on" : ""}`} onClick={() => setStyle(id)}>
              {STORY_STYLES[id].label}
            </button>
          ))}
        </div>
        {style === "custom" && !cfg.rules.custom?.trim() && <span className="muted small">Describe your custom style in Settings › Story.</span>}
      </div>
      <label className="field">
        <span className="field-label">Picture look</span>
        <select className="input" value={cfg.look} onChange={(e) => set({ look: e.target.value as LookId })}>
          {(Object.keys(LOOKS) as LookId[]).map((id) => (
            <option key={id} value={id}>{LOOKS[id].label}</option>
          ))}
        </select>
      </label>
      <div className="field">
        <span className="field-label">Slides</span>
        <div className="seg" role="group" aria-label="Slides">
          {([3, 4] as const).map((n) => (
            <button key={n} className={cfg.slides === n ? "on" : ""} aria-pressed={cfg.slides === n} onClick={() => set({ slides: n })}>{n}</button>
          ))}
        </div>
      </div>
      {err && <p className="error small">{err}</p>}
      <button className="btn primary wide" onClick={start}>Make the story</button>
      {!!earlier?.length && (
        <>
          <h2 className="section">Stories for this answer</h2>
          {earlier.map((s) => (
            <button key={s.id} className="row-btn compact" onClick={() => (onClose(), go(hrefStory(s.id)))}>
              <span>{s.title || "Story in progress"}</span>
              <span className="muted small">{STORY_STYLES[s.style as StyleId]?.label ?? s.style} · {s.slides.length} slides · {new Date(s.createdAt).toLocaleDateString()}</span>
            </button>
          ))}
        </>
      )}
    </Sheet>
  );
}
