import { useRef, useState } from "react";
import { drawModel, previewVoice, styleFromScreenshots, visionModel, voiceModel } from "../stories";
import { LOOKS, STORY_STYLES, type LookId, type StorySettings as Cfg, type StyleId } from "../storyStyles";
import { modelsStore, settingsStore, updateSettings, useStore } from "../store";
import { ModelPicker } from "../components/ModelPicker";

/** Common text-to-speech voice names, offered as suggestions; any name the voice model accepts can be typed. */
const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];

/** Shrink a screenshot to at most 768px wide as JPEG, so the vision request stays small. */
async function toDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 768 / bmp.width);
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

export function StorySettings() {
  const { story: s } = useStore(settingsStore);
  const { speechModels = [] } = useStore(modelsStore);
  const set = (p: Partial<Cfg>) => updateSettings((x) => ({ story: { ...x.story, ...p } }));
  const [styleId, setStyleId] = useState<StyleId>(s.style);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const files = useRef<HTMLInputElement>(null);
  const player = useRef<HTMLAudioElement>(null);

  const rules = s.rules[styleId] ?? STORY_STYLES[styleId].rules;

  const fromScreenshots = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy("Reading your screenshots…");
    setMsg("");
    try {
      const urls = await Promise.all([...list].slice(0, 4).map(toDataUrl));
      const text = await styleFromScreenshots(urls);
      set({ notes: { ...s.notes, [styleId]: text } });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
      if (files.current) files.current.value = "";
    }
  };

  const preview = async () => {
    setBusy("Recording a sample…");
    setMsg("");
    try {
      const blob = await previewVoice();
      const a = player.current!;
      a.src = URL.createObjectURL(blob);
      a.playbackRate = s.playbackRate;
      await a.play().catch(() => {});
      setMsg("Playing a sample.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <section>
      <h2 className="section">Storytelling style</h2>
      <p className="muted small">Stories are made only when you ask (“Learn as a story” on an answer or a point).</p>
      <div className="chips" role="radiogroup" aria-label="Storytelling style">
        {(Object.keys(STORY_STYLES) as StyleId[]).map((id) => (
          <button key={id} role="radio" aria-checked={styleId === id} className={`btn chip ${styleId === id ? "on" : ""}`} onClick={() => setStyleId(id)}>
            {STORY_STYLES[id].label}
            {s.style === id ? " (default)" : ""}
          </button>
        ))}
      </div>
      {s.style !== styleId && (
        <button className="btn sm" onClick={() => set({ style: styleId, look: STORY_STYLES[styleId].look })}>Use {STORY_STYLES[styleId].label} by default</button>
      )}
      <label className="field">
        <span className="field-label">How {STORY_STYLES[styleId].label} stories are told</span>
        <textarea
          className="input"
          rows={7}
          value={rules}
          placeholder="Describe how the story should be told and how it should look."
          onChange={(e) => set({ rules: { ...s.rules, [styleId]: e.target.value } })}
          aria-label="Style rules"
        />
      </label>
      {s.rules[styleId] !== undefined && styleId !== "custom" && (
        <button className="btn sm" onClick={() => { const r = { ...s.rules }; delete r[styleId]; set({ rules: r }); }}>Reset to the preset</button>
      )}

      <div className="field">
        <span className="field-label">Refine with screenshots</span>
        <span className="muted small">Add frames you like. A vision model ({visionModel().split("/").pop() || "none"}) describes their style, and the description is added to this style.</span>
        <input ref={files} type="file" accept="image/*" multiple hidden onChange={(e) => fromScreenshots(e.target.files)} aria-label="Style screenshots" />
        <button className="btn sm" disabled={!!busy} onClick={() => files.current?.click()}>Add screenshots…</button>
        {s.notes[styleId] !== undefined && (
          <>
            <textarea className="input" rows={4} value={s.notes[styleId]} onChange={(e) => set({ notes: { ...s.notes, [styleId]: e.target.value } })} aria-label="Style notes from screenshots" />
            <div className="chips">
              <button className="btn chip" onClick={() => set({ look: "custom", customLook: s.notes[styleId] ?? "" })}>Use as the picture look</button>
              <button className="btn chip" onClick={() => { const n = { ...s.notes }; delete n[styleId]; set({ notes: n }); }}>Remove</button>
            </div>
          </>
        )}
      </div>

      <h2 className="section">Pictures</h2>
      <p className="muted small">Shapes drawn by AI as a small vector picture (SVG).</p>
      <label className="field">
        <span className="field-label">Look</span>
        <select className="input" value={s.look} onChange={(e) => set({ look: e.target.value as LookId })} aria-label="Picture look">
          {(Object.keys(LOOKS) as LookId[]).map((id) => <option key={id} value={id}>{LOOKS[id].label}</option>)}
        </select>
      </label>
      {s.look === "custom" && (
        <textarea className="input" rows={3} value={s.customLook} placeholder="e.g. bold colorful vectors with thick outlines on cream paper" onChange={(e) => set({ customLook: e.target.value })} aria-label="Custom look" />
      )}
      <div className="field">
        <span className="field-label">Drawing model</span>
        <ModelPicker value={s.drawModel} onChange={(id) => set({ drawModel: id })} label="Drawing model" allowEmpty emptyLabel={`Automatic (${drawModel().split("/").pop()})`} />
      </div>
      <div className="field">
        <span className="field-label">Story writer</span>
        <ModelPicker value={s.storyModel} onChange={(id) => set({ storyModel: id })} label="Story writer" allowEmpty emptyLabel="Same as the topic's model" />
      </div>
      <div className="field">
        <span className="field-label">Slides per story</span>
        <div className="seg" role="group" aria-label="Slides per story">
          {([3, 4] as const).map((n) => (
            <button key={n} className={s.slides === n ? "on" : ""} aria-pressed={s.slides === n} onClick={() => set({ slides: n })}>{n}</button>
          ))}
        </div>
      </div>

      <h2 className="section">Voice</h2>
      <label className="field">
        <span className="field-label">Voice model</span>
        <input className="input" list="speech-models" value={s.voiceModel} placeholder={voiceModel() || "e.g. openai/gpt-4o-mini-tts"} onChange={(e) => set({ voiceModel: e.target.value.trim() })} aria-label="Voice model" />
        <datalist id="speech-models">
          {speechModels.map((m) => <option key={m.id} value={m.id} />)}
        </datalist>
        <span className="muted small">{speechModels.length ? `${speechModels.length} speech models available. Empty = ${voiceModel()}.` : "Refresh the model list in Settings › Models to see speech models."}</span>
      </label>
      <label className="field">
        <span className="field-label">Voice</span>
        <input className="input" list="voices" value={s.voice} onChange={(e) => set({ voice: e.target.value.trim() })} aria-label="Voice" />
        <datalist id="voices">
          {VOICES.map((v) => <option key={v} value={v} />)}
        </datalist>
      </label>
      <button className="btn sm" disabled={!!busy} onClick={preview}>▶ Preview voice</button>
      <audio ref={player} aria-label="Voice preview" />
      <label className="field">
        <span className="field-label">Speech speed (sent to the voice model): {s.speechSpeed.toFixed(2)}×</span>
        <input type="range" min={0.5} max={2} step={0.05} value={s.speechSpeed} onChange={(e) => set({ speechSpeed: Number(e.target.value) })} aria-label="Speech speed" />
      </label>
      <label className="field">
        <span className="field-label">Playback speed</span>
        <select className="input" value={s.playbackRate} onChange={(e) => set({ playbackRate: Number(e.target.value) })} aria-label="Playback speed">
          {[0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={s.autoplay} onChange={(e) => set({ autoplay: e.target.checked })} />
        <span>Go to the next slide when the narration ends</span>
      </label>
      {busy && <p className="muted small" role="status">{busy}</p>}
      {msg && <p className="small" role="status">{msg}</p>}
    </section>
  );
}
