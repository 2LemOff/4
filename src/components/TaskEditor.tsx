import { useState } from "react";
import { modelInfo, modelsStore, settingsStore, useStore } from "../store";
import { setTask, setTaskModelSettings, settingsFor, taskModel } from "../taskConfig";
import { lengthOf, TASK, TASK_GROUPS, TASKS, taskModelSettings, type TaskId } from "../tasks";
import type { ModelInfo } from "../types";
import { ModelPicker, shortName } from "./ModelPicker";
import { ModelSettingsEditor } from "./ModelSettingsEditor";
import { Sheet } from "./Sheet";

const visionOnly = (m: ModelInfo) => !!m.architecture?.input_modalities?.includes("image");

/**
 * The same editor for every task that uses a model: the model, the prompt (with what the app adds shown
 * read-only), the length and every setting the chosen model supports.
 */
export function TaskEditor({ id, extra }: { id: TaskId; extra?: React.ReactNode }) {
  const s = useStore(settingsStore);
  const { embedModels } = useStore(modelsStore);
  const def = TASK[id];
  const saved = s.tasks[id];
  const model = taskModel(id);
  const automatic = !saved?.model;

  if (def.kind === "embed") {
    return (
      <div className="settings-editor">
        <p className="muted small">{def.hint}</p>
        <label className="field">
          <span className="field-label">Model</span>
          <select className="input" value={saved?.model ?? ""} onChange={(e) => setTask(id, { model: e.target.value || undefined })} aria-label="Embedding model">
            <option value="">Automatic ({shortName(taskModel(id)) || "none available"})</option>
            {embedModels.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
          </select>
        </label>
      </div>
    );
  }

  const info = modelInfo(model);
  const value = id === "answer" ? settingsFor(model) : taskModelSettings(def, saved, info);
  const len = lengthOf(def, saved);
  return (
    <div className="settings-editor">
      <p className="muted small">{def.hint}</p>
      {def.noModel ? (
        <p className="small">Each council member uses its own model and settings for this.</p>
      ) : (
        <div className="field">
          <span className="field-label">Model</span>
          <ModelPicker
            value={saved?.model ?? ""}
            onChange={(m) => setTask(id, { model: m || undefined })}
            label={`${def.label} model`}
            allowEmpty
            emptyLabel={`Automatic (${shortName(model) || "none"})`}
            filter={def.kind === "vision" ? visionOnly : undefined}
          />
          {automatic && <span className="muted small">Automatic picks the newest suitable model{def.defaultIsAnswer ? " (the topic's model)" : ""}.</span>}
        </div>
      )}
      {extra}
      {def.prompt !== undefined && (
        <label className="field">
          <span className="field-label">Prompt</span>
          <textarea className="input" rows={5} value={saved?.prompt ?? def.prompt} onChange={(e) => setTask(id, { prompt: e.target.value })} aria-label={`${def.label} prompt`} />
          {saved?.prompt !== undefined && saved.prompt !== def.prompt && (
            <button type="button" className="btn sm" onClick={() => setTask(id, { prompt: undefined })}>Reset prompt</button>
          )}
        </label>
      )}
      {def.fixed && (
        <details className="group">
          <summary className="small">Added by the app (needed to read the reply)</summary>
          <pre className="prompt-pre">{def.fixed}</pre>
        </details>
      )}
      {def.lengths && (
        <div className="field">
          <span className="field-label">Length</span>
          <div className="chips" role="radiogroup" aria-label={`${def.label} length`}>
            {def.lengths.map((l) => (
              <button key={l.id} role="radio" aria-checked={len?.id === l.id} className={`btn chip ${len?.id === l.id ? "on" : ""}`} onClick={() => setTask(id, { length: l.id })}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {model && !def.noModel && (
        <details className="group" open={id !== "answer"}>
          <summary>Settings for {shortName(model)}</summary>
          <ModelSettingsEditor modelId={model} value={value} onChange={(v) => setTaskModelSettings(id, model, v)} />
          <button type="button" className="btn sm" onClick={() => setTaskModelSettings(id, model, undefined)}>
            Reset to this model's defaults
          </button>
        </details>
      )}
    </div>
  );
}

/** Every task, grouped; each row opens its editor in a sheet. */
export function TaskList({ answerExtra, extraRows }: { answerExtra?: React.ReactNode; extraRows?: Partial<Record<(typeof TASK_GROUPS)[number], React.ReactNode>> }) {
  useStore(settingsStore);
  useStore(modelsStore);
  const [open, setOpen] = useState<TaskId>();
  return (
    <>
      {TASK_GROUPS.map((g) => (
        <section key={g} aria-label={g}>
          <h2 className="section">{g}</h2>
          {TASKS.filter((t) => t.group === g).map((t) => (
            <button key={t.id} className="row-btn compact task-row" onClick={() => setOpen(t.id)}>
              <span className="row-line">
                <strong>{t.label}</strong>
              </span>
              <span className="muted small">{t.noModel ? "Each member's own model" : shortName(taskModel(t.id)) || "no model yet"}</span>
            </button>
          ))}
          {extraRows?.[g]}
        </section>
      ))}
      {open && (
        <Sheet title={TASK[open].label} onClose={() => setOpen(undefined)}>
          <TaskEditor id={open} extra={open === "answer" ? answerExtra : undefined} />
          <button className="btn primary" onClick={() => setOpen(undefined)}>Done</button>
        </Sheet>
      )}
    </>
  );
}
