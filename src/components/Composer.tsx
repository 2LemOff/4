import { useEffect, useState } from "react";
import { ask, settingsFor } from "../ai";
import { go, hrefCard } from "../route";
import { settingsStore, updateSettings, useStore } from "../store";
import { ModelPicker } from "./ModelPicker";
import { ModelSettingsEditor } from "./ModelSettingsEditor";
import { Sheet } from "./Sheet";
import type { Anchor, ModelSettings } from "../types";

export const CHIPS = ["Why?", "How do you know?", "Example", "What if this is wrong?"];

export function Composer({
  sessionId,
  parentId,
  anchor,
  placeholder,
  defaultModel,
  autoFocus,
  chips = true,
}: {
  sessionId?: string;
  parentId: string | null;
  anchor?: Anchor;
  placeholder: string;
  defaultModel: string | undefined;
  autoFocus?: boolean;
  chips?: boolean;
}) {
  const { apiKey } = useStore(settingsStore);
  const [text, setText] = useState("");
  const [model, setModel] = useState(defaultModel ?? "");
  const [settings, setSettings] = useState<ModelSettings>(() => settingsFor(defaultModel ?? ""));
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (defaultModel) {
      setModel(defaultModel);
      setSettings(settingsFor(defaultModel));
    }
  }, [defaultModel]);

  const pickModel = (id: string) => {
    setModel(id);
    setSettings(settingsFor(id));
  };

  const submit = async (q: string) => {
    const question = q.trim();
    if (!question) return;
    if (!apiKey) return setErr("Connect OpenRouter in Settings first.");
    if (!model) return setErr("Choose a model first.");
    setErr("");
    const r = await ask({ sessionId, parentId, question, anchor, model, settings });
    setText("");
    go(hrefCard(r.sessionId, r.cardId));
  };

  return (
    <div className="composer">
      {chips && (
        <div className="chips" aria-label="Quick questions">
          {CHIPS.map((c) => (
            <button key={c} className="btn chip" onClick={() => submit(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      <form
        className="composer-row"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(text);
        }}
      >
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoFocus={autoFocus} enterKeyHint="send" />
        <button type="button" className="btn icon" aria-label="Model settings" onClick={() => setOpen(true)}>⚙</button>
        <button type="submit" className="btn primary" disabled={!text.trim()}>Ask</button>
      </form>
      {err && (
        <p className="error small" role="alert">
          {err} {!apiKey && <a href="#/settings/account">Open Settings</a>}
        </p>
      )}
      {open && (
        <Sheet title="Model settings" onClose={() => setOpen(false)}>
          <p className="muted small">These settings apply to this question.</p>
          <ModelPicker value={model} onChange={pickModel} label="Model for this question" />
          {model && <ModelSettingsEditor modelId={model} value={settings} onChange={setSettings} />}
          <button
            className="btn"
            onClick={() => {
              updateSettings((s) => ({ modelSettings: { ...s.modelSettings, [model]: settings } }));
              setOpen(false);
            }}
          >
            Save as default for this model
          </button>
          <button className="btn primary" onClick={() => setOpen(false)}>Done</button>
        </Sheet>
      )}
    </div>
  );
}
