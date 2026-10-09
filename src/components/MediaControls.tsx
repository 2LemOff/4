import type { MediaControl } from "../mediaSettings";

const LABELS: Record<string, string> = {
  aspect_ratio: "Aspect ratio",
  resolution: "Resolution",
  duration: "Duration (seconds)",
  size: "Size",
  generate_audio: "Generate sound",
  background: "Background",
  output_format: "Format",
  quality: "Quality",
};
const label = (k: string) => LABELS[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Settings built from OpenRouter's metadata: choices, sliders and switches. */
export function MediaControls({ controls, values, onChange }: { controls: MediaControl[]; values: Record<string, unknown>; onChange: (key: string, v: unknown) => void }) {
  if (!controls.length) return <p className="muted small">This model has no extra settings.</p>;
  return (
    <>
      {controls.map((c) =>
        c.kind === "choice" ? (
          <label key={c.key} className="field">
            <span className="field-label">{label(c.key)}</span>
            <select
              className="input"
              aria-label={label(c.key)}
              value={String(values[c.key])}
              onChange={(e) => onChange(c.key, c.options.find((o) => String(o) === e.target.value))}
            >
              {c.options.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
            </select>
          </label>
        ) : c.kind === "range" ? (
          <label key={c.key} className="field">
            <span className="field-label">{label(c.key)}: {String(values[c.key])}</span>
            <input type="range" aria-label={label(c.key)} min={c.min} max={c.max} step={c.step} value={Number(values[c.key])} onChange={(e) => onChange(c.key, Number(e.target.value))} />
          </label>
        ) : (
          <label key={c.key} className="check">
            <input type="checkbox" checked={!!values[c.key]} onChange={(e) => onChange(c.key, e.target.checked)} />
            <span>{label(c.key)}</span>
          </label>
        ),
      )}
    </>
  );
}
