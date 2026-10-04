import type { ReactNode } from "react";
import { modelInfo } from "../store";
import { defaultSettings, settingsControls, type GenericParam } from "../modelRules";
import type { Effort, ModelSettings, ReasoningSettings } from "../types";

const GENERIC: Record<GenericParam, { label: string; min?: number; max?: number; step?: number }> = {
  temperature: { label: "Temperature", min: 0, max: 2, step: 0.05 },
  top_p: { label: "Top P", min: 0, max: 1, step: 0.05 },
  top_k: { label: "Top K", min: 0, step: 1 },
  frequency_penalty: { label: "Frequency penalty", min: -2, max: 2, step: 0.1 },
  presence_penalty: { label: "Presence penalty", min: -2, max: 2, step: 0.1 },
  repetition_penalty: { label: "Repetition penalty", min: 0, max: 2, step: 0.05 },
  seed: { label: "Seed", step: 1 },
};

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

/** Every control appears only if the model supports it (from /models: supported_parameters and reasoning). */
export function ModelSettingsEditor({
  modelId,
  value,
  onChange,
}: {
  modelId: string;
  value: ModelSettings;
  onChange: (v: ModelSettings) => void;
}) {
  const model = modelInfo(modelId);
  const ctl = settingsControls(model);
  const r = value.reasoning;
  const setR = (patch: Partial<ReasoningSettings>) => onChange({ ...value, reasoning: { ...r, ...patch } });
  const num = (s: string) => (s.trim() === "" || isNaN(Number(s)) ? undefined : Number(s));

  const mode: "effort" | "budget" = r.budget !== undefined ? "budget" : "effort";
  const enabled = r.enabled ?? ctl.reasoning.defaultEnabled;
  const canEffort = ctl.reasoning.efforts.length > 0;
  const canBudget = ctl.reasoning.budget;
  const effortShown: Effort | undefined = r.effort;

  return (
    <div className="settings-editor">
      <div className="muted small">
        {model.context_length ? `Context window ${model.context_length.toLocaleString()} tokens. ` : ""}
        Only settings this model supports are shown.
      </div>

      <Field label="Max tokens" hint="Reasoning tokens count against this limit; it is raised automatically if needed.">
        <input className="input" type="number" min={1} inputMode="numeric" placeholder="auto" value={value.max_tokens ?? ""} onChange={(e) => onChange({ ...value, max_tokens: num(e.target.value) })} />
      </Field>

      {ctl.generic.map((p) => (
        <Field key={p} label={GENERIC[p].label}>
          <input className="input" type="number" inputMode="decimal" min={GENERIC[p].min} max={GENERIC[p].max} step={GENERIC[p].step} placeholder="default" value={value[p] ?? ""} onChange={(e) => onChange({ ...value, [p]: num(e.target.value) })} />
        </Field>
      ))}

      {ctl.verbosity && (
        <Field label="Verbosity">
          <select className="input" value={value.verbosity ?? ""} onChange={(e) => onChange({ ...value, verbosity: (e.target.value || undefined) as ModelSettings["verbosity"] })}>
            <option value="">Default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </Field>
      )}

      {ctl.reasoning.available && (
        <fieldset className="group">
          <legend>Reasoning</legend>
          {ctl.reasoning.canDisable && (
            <label className="check">
              <input type="checkbox" checked={enabled} onChange={(e) => setR({ enabled: e.target.checked })} />
              <span>Reasoning on</span>
            </label>
          )}
          {enabled && (canEffort || canBudget) && (
            <>
              {canEffort && canBudget && (
                <div className="chips" role="radiogroup" aria-label="Reasoning control">
                  <button type="button" role="radio" aria-checked={mode === "effort"} className={`btn chip ${mode === "effort" ? "on" : ""}`} onClick={() => setR({ budget: undefined })}>
                    Effort level
                  </button>
                  <button type="button" role="radio" aria-checked={mode === "budget"} className={`btn chip ${mode === "budget" ? "on" : ""}`} onClick={() => setR({ effort: undefined, budget: r.budget ?? 8192 })}>
                    Token budget
                  </button>
                </div>
              )}
              {mode === "effort" && canEffort && (
                <div className="chips" role="radiogroup" aria-label="Effort">
                  <button type="button" role="radio" aria-checked={effortShown === undefined} className={`btn chip ${effortShown === undefined ? "on" : ""}`} onClick={() => setR({ effort: undefined, budget: undefined })}>
                    Default{ctl.reasoning.defaultEffort ? ` (${ctl.reasoning.defaultEffort})` : ""}
                  </button>
                  {ctl.reasoning.efforts.map((e) => (
                    <button type="button" key={e} role="radio" aria-checked={effortShown === e} className={`btn chip ${effortShown === e ? "on" : ""}`} onClick={() => setR({ effort: e, budget: undefined })}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
              {mode === "budget" && canBudget && (
                <Field label={`Reasoning token budget: ${(r.budget ?? 8192).toLocaleString()}`}>
                  <input type="range" min={1024} max={64000} step={1024} value={r.budget ?? 8192} onChange={(e) => setR({ effort: undefined, budget: Number(e.target.value) })} aria-label="Reasoning token budget" />
                </Field>
              )}
            </>
          )}
          <label className="check">
            <input type="checkbox" checked={!!r.exclude} onChange={(e) => setR({ exclude: e.target.checked || undefined })} />
            <span>Hide reasoning from the response (still billed)</span>
          </label>
          {ctl.pro && (
            <label className="check">
              <input type="checkbox" checked={r.mode === "pro"} onChange={(e) => setR({ mode: e.target.checked ? "pro" : undefined })} />
              <span>Pro mode (deeper multi-pass reasoning)</span>
            </label>
          )}
          {ctl.contextMode && (
            <Field label="Reasoning context">
              <select className="input" value={r.context ?? "auto"} onChange={(e) => setR({ context: e.target.value as ReasoningSettings["context"] })}>
                <option value="auto">Auto</option>
                <option value="all_turns">All turns</option>
                <option value="current_turn">Current turn only</option>
              </select>
            </Field>
          )}
          {ctl.hints.map((h) => (
            <p key={h} className="muted small">{h}</p>
          ))}
        </fieldset>
      )}

      <fieldset className="group">
        <legend>Routing</legend>
        <Field label="Provider priority">
          <select className="input" value={value.provider?.sort ?? ""} onChange={(e) => onChange({ ...value, provider: { ...value.provider, sort: (e.target.value || undefined) as never } })}>
            <option value="">Default</option>
            <option value="price">Lowest price</option>
            <option value="throughput">Highest throughput</option>
            <option value="latency">Lowest latency</option>
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={value.provider?.data_collection === "deny"} onChange={(e) => onChange({ ...value, provider: { ...value.provider, data_collection: e.target.checked ? "deny" : undefined } })} />
          <span>Only providers that don’t store my data</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={value.provider?.allow_fallbacks !== false} onChange={(e) => onChange({ ...value, provider: { ...value.provider, allow_fallbacks: e.target.checked ? undefined : false } })} />
          <span>Allow other providers if one fails</span>
        </label>
        <Field label="Fallback models" hint="Comma-separated model ids tried if this model fails.">
          <input className="input" placeholder="e.g. anthropic/claude-sonnet-5.5" value={(value.fallbackModels ?? []).join(", ")} onChange={(e) => onChange({ ...value, fallbackModels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
        </Field>
      </fieldset>

      <button type="button" className="btn" onClick={() => onChange(defaultSettings(model))}>Reset to model defaults</button>
    </div>
  );
}
