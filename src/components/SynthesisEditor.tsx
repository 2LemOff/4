import { PRESET_LABELS, PRESET_PROMPTS } from "../prompts";
import { settingsFor, roleModel } from "../ai";
import { ModelPicker } from "./ModelPicker";
import { ModelSettingsEditor } from "./ModelSettingsEditor";
import type { SynthesisPreset, SynthesisSettings } from "../types";

/** How sessions are synthesized: preset, editable prompt, options, model and category handling. */
export function SynthesisEditor({
  value,
  onChange,
  fallbackModel,
}: {
  value: SynthesisSettings;
  onChange: (v: SynthesisSettings) => void;
  /** the model used when `value.model` is empty (the session's model) */
  fallbackModel?: string;
}) {
  const o = value.options;
  const setOpt = (patch: Partial<SynthesisSettings["options"]>) => onChange({ ...value, options: { ...o, ...patch } });
  const effectiveModel = value.model || fallbackModel || roleModel("answer") || "";

  return (
    <div className="settings-editor">
      <label className="field">
        <span className="field-label">Style</span>
        <select
          className="input"
          value={value.preset}
          onChange={(e) => {
            const preset = e.target.value as SynthesisPreset;
            onChange({ ...value, preset, prompt: PRESET_PROMPTS[preset] });
          }}
        >
          {(Object.keys(PRESET_LABELS) as SynthesisPreset[]).map((p) => (
            <option key={p} value={p}>{PRESET_LABELS[p]}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field-label">Synthesis prompt</span>
        <textarea className="input" rows={7} value={value.prompt} onChange={(e) => onChange({ ...value, prompt: e.target.value })} aria-label="Synthesis prompt" />
      </label>
      <button type="button" className="btn" onClick={() => onChange({ ...value, prompt: PRESET_PROMPTS[value.preset] })}>
        Reset to default
      </button>

      <fieldset className="group">
        <legend>Options</legend>
        <label className="field">
          <span className="field-label">Heading levels</span>
          <select className="input" value={o.depth} onChange={(e) => setOpt({ depth: Number(e.target.value) as 1 | 2 | 3 })}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Length</span>
          <select className="input" value={o.length} onChange={(e) => setOpt({ length: e.target.value as typeof o.length })}>
            <option value="brief">Brief</option>
            <option value="standard">Standard</option>
            <option value="detailed">Detailed</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={o.examples} onChange={(e) => setOpt({ examples: e.target.checked })} />
          <span>Include examples</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={o.openQuestions} onChange={(e) => setOpt({ openQuestions: e.target.checked })} />
          <span>Include open questions</span>
        </label>
        <label className="field">
          <span className="field-label">Language</span>
          <input className="input" value={o.language} onChange={(e) => setOpt({ language: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Categories</span>
          <select className="input" value={value.categoryMode} onChange={(e) => onChange({ ...value, categoryMode: e.target.value as typeof value.categoryMode })}>
            <option value="reuse">Reuse existing categories</option>
            <option value="free">Let the AI choose freely</option>
          </select>
        </label>
      </fieldset>

      <div className="field">
        <span className="field-label">Model</span>
        <ModelPicker value={value.model} onChange={(m) => onChange({ ...value, model: m, modelSettings: undefined })} label="Synthesis model" allowEmpty emptyLabel="Same as the session" />
      </div>
      {effectiveModel && (
        <details className="group">
          <summary>Model settings for synthesis</summary>
          <ModelSettingsEditor modelId={effectiveModel} value={value.modelSettings ?? settingsFor(effectiveModel)} onChange={(s) => onChange({ ...value, modelSettings: s })} />
        </details>
      )}
    </div>
  );
}
