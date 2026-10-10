import { buildRequestParams, defaultSettings } from "./modelRules";
import { roleDefaults } from "./models";
import { modelInfo, modelsStore, settingsStore, updateSettings } from "./store";
import { defaultTaskModel, TASK, taskModelSettings, taskPrompt, type TaskId, type TaskSettings } from "./tasks";
import type { ModelInfo, ModelSettings } from "./types";

/** Saved settings of the answer model (also the starting point for every question). */
export function settingsFor(modelId: string): ModelSettings {
  return settingsStore.get().modelSettings[modelId] ?? defaultSettings(modelInfo(modelId));
}

const saved = (id: TaskId): TaskSettings | undefined => settingsStore.get().tasks[id];

/** The model a task uses now: the user's choice, else its default (`answerModel` stands in for "the topic's model"). */
export function taskModel(id: TaskId, answerModel?: string): string {
  const chosen = saved(id)?.model;
  if (chosen) return chosen;
  const { models, embedModels } = modelsStore.get();
  if (id === "answer") return roleDefaults(models).answer ?? "";
  return defaultTaskModel(TASK[id], models, embedModels, answerModel || taskModel("answer")) ?? "";
}

export interface TaskSetup {
  model: string;
  info: ModelInfo;
  settings: ModelSettings;
  /** the instructions to send (edited prompt + length + the app's format) */
  prompt: string;
  /** the request-body fragment: only what the model supports */
  params: Record<string, unknown>;
}

/** Everything a request for this task needs. `middle` goes between the prompt and the length/format lines. */
export function taskSetup(id: TaskId, opts: { model?: string; answerModel?: string; middle?: string } = {}): TaskSetup {
  const def = TASK[id];
  const model = opts.model || taskModel(id, opts.answerModel);
  const info = modelInfo(model);
  const settings = id === "answer" ? settingsFor(model) : taskModelSettings(def, saved(id), info);
  return { model, info, settings, prompt: taskPrompt(def, saved(id), opts.middle), params: buildRequestParams(settings, info) };
}

export function setTask(id: TaskId, patch: Partial<TaskSettings>) {
  updateSettings((s) => ({ tasks: { ...s.tasks, [id]: { ...s.tasks[id], ...patch } } }));
}

/** Settings for one model of a task (the answer task keeps its per-model settings in `modelSettings`). */
export function setTaskModelSettings(id: TaskId, model: string, value: ModelSettings | undefined) {
  if (id === "answer") {
    updateSettings((s) => {
      const next = { ...s.modelSettings };
      if (value) next[model] = value;
      else delete next[model];
      return { modelSettings: next };
    });
    return;
  }
  updateSettings((s) => {
    const cur = s.tasks[id] ?? {};
    const settings = { ...cur.settings };
    if (value) settings[model] = value;
    else delete settings[model];
    return { tasks: { ...s.tasks, [id]: { ...cur, settings } } };
  });
}
