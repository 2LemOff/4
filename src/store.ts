import { useEffect, useState, useSyncExternalStore } from "react";
import { liveQuery } from "dexie";
import { kvGet, kvSet } from "./db";
import type { ModelInfo, ModelSettings, SynthesisSettings } from "./types";
import { DEFAULT_SYNTHESIS, DEFAULT_SYSTEM_PROMPT, OLD_PREMISE_FORMAT, PROMPT_PARTS } from "./prompts";
import { listModels } from "./openrouter";
import { DEFAULT_STORY, type StorySettings } from "./storyStyles";

type Listener = () => void;
export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next: T | ((prev: T) => T)) {
      value = typeof next === "function" ? (next as (p: T) => T)(value) : next;
      listeners.forEach((l) => l());
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
export function useStore<T>(store: ReturnType<typeof createStore<T>>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Re-run a Dexie query whenever its tables change. `undefined` until the first result. */
export function useLive<T>(fn: () => Promise<T> | T, deps: unknown[]): T | undefined {
  const [v, setV] = useState<T | undefined>(undefined);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setV, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  apiKey: string;
  roleModels: { answer?: string; tags?: string; rerank?: string; embed?: string };
  /** saved settings per model id */
  modelSettings: Record<string, ModelSettings>;
  /** hidden system prompt used for NEW sessions (each session keeps its own frozen copy) */
  systemPrompt: string;
  synthesis: SynthesisSettings;
  /** models that answered 400 to a mid-conversation effort update */
  blockedConfigUpdate: string[];
  council: {
    /** empty = newest Gemini Pro, Claude Opus, ChatGPT and Grok */
    members: string[];
    /** empty = the answer model */
    chairman: string;
    peerReview: boolean;
    /** empty = newest Gemini Flash */
    verifier: string;
    removeUnsupported: boolean;
  };
  story: StorySettings;
  lastBackupAt?: number;
  /** remind after this many days without a backup (0 = never) */
  backupReminderDays: number;
}

export const defaultAppSettings = (): AppSettings => ({
  apiKey: "",
  roleModels: {},
  modelSettings: {},
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  synthesis: DEFAULT_SYNTHESIS,
  blockedConfigUpdate: [],
  backupReminderDays: 7,
  council: { members: [], chairman: "", peerReview: true, verifier: "", removeUnsupported: true },
  story: DEFAULT_STORY,
});

export const settingsStore = createStore<AppSettings>(defaultAppSettings());

export function updateSettings(patch: Partial<AppSettings> | ((s: AppSettings) => Partial<AppSettings>)) {
  const next = { ...settingsStore.get(), ...(typeof patch === "function" ? patch(settingsStore.get()) : patch) };
  settingsStore.set(next);
  void kvSet("settings", next);
}

// ── Models ───────────────────────────────────────────────────────────────────

export interface ModelsState {
  models: ModelInfo[];
  embedModels: ModelInfo[];
  speechModels?: ModelInfo[];
  loading: boolean;
  error?: string;
  fetchedAt?: number;
}
export const modelsStore = createStore<ModelsState>({ models: [], embedModels: [], loading: false });

const DAY = 24 * 3600 * 1000;

export async function refreshModels(force = false) {
  const cur = modelsStore.get();
  if (!force && cur.models.length && cur.fetchedAt && Date.now() - cur.fetchedAt < DAY) return;
  modelsStore.set({ ...cur, loading: true, error: undefined });
  try {
    const [models, embedModels, speechModels] = await Promise.all([
      listModels("text"),
      listModels("embeddings").catch(() => []),
      listModels("speech").catch(() => []),
    ]);
    const next = { models, embedModels, speechModels, loading: false, fetchedAt: Date.now() };
    modelsStore.set(next);
    await kvSet("models", next);
  } catch (e) {
    modelsStore.set({ ...modelsStore.get(), loading: false, error: e instanceof Error ? e.message : String(e) });
  }
}

export function modelInfo(id: string): ModelInfo {
  return modelsStore.get().models.find((m) => m.id === id) ?? { id };
}

// ── Live streaming view (not persisted until the answer finishes) ────────────

export interface StreamView {
  content: string;
  reasoning: string;
}
export const streamStore = createStore<Record<string, StreamView>>({});

export async function initApp() {
  const saved = await kvGet<AppSettings>("settings");
  if (saved) {
    const merged = { ...defaultAppSettings(), ...saved };
    merged.council = { ...defaultAppSettings().council, ...saved.council };
    merged.story = { ...DEFAULT_STORY, ...saved.story };
    // v1 prompts asked for blank-line paragraphs, which conflicts with the pyramid format
    merged.systemPrompt = merged.systemPrompt.replace(OLD_PREMISE_FORMAT, PROMPT_PARTS.premiseFormat);
    settingsStore.set(merged);
  }
  const cached = await kvGet<ModelsState>("models");
  if (cached) modelsStore.set({ ...cached, loading: false });
  void refreshModels();
}
