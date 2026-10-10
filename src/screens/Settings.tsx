import { useState } from "react";
import { StorageSettings } from "./StorageSettings";
import { StorySettings } from "./StorySettings";
import { db } from "../db";
import { roleModel } from "../ai";
import { SynthesisEditor } from "../components/SynthesisEditor";
import { TaskList } from "../components/TaskEditor";
import { CouncilEditor } from "../components/CouncilEditor";
import { challengeS256, authUrl, makeVerifier } from "../openrouter";
import { ANSWER_FORMAT, composeSystemPrompt, DEFAULT_SYSTEM_PROMPT, detectToggles, PROMPT_PARTS, setToggle } from "../prompts";
import { go } from "../route";
import { modelsStore, refreshModels, settingsStore, updateSettings, useLive, useStore } from "../store";
import type { AppSettings } from "../store";
import type { PromptToggles } from "../types";

const SECTIONS = [
  ["account", "Account"],
  ["models", "Models"],
  ["council", "Council"],
  ["prompt", "System prompt"],
  ["synthesis", "Synthesis"],
  ["views", "Views"],
  ["story", "Story"],
  ["storage", "Storage"],
] as const;

export function Settings({ section }: { section: string }) {
  return (
    <div className="scroll pad">
      <h1>Settings</h1>
      <div className="chips" role="tablist">
        {SECTIONS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={section === id} className={`btn chip ${section === id ? "on" : ""}`} onClick={() => go(`#/settings/${id}`)}>
            {label}
          </button>
        ))}
      </div>
      {section === "account" && <Account />}
      {section === "models" && <Models />}
      {section === "council" && (
        <section>
          <h2 className="section">LLM Council</h2>
          <p className="muted small">Switch the council on with its button next to the question box. Members answer, review each other anonymously, and the chairman writes the final answer using only their text.</p>
          <CouncilEditor />
        </section>
      )}
      {section === "prompt" && <PromptSettings />}
      {section === "synthesis" && <SynthesisSettings />}
      {section === "story" && <StorySettings />}
      {section === "views" && <ViewSettings />}
      {(section === "storage" || section === "data") && <StorageSettings />}
    </div>
  );
}

function Account() {
  const { apiKey } = useStore(settingsStore);
  const [key, setKey] = useState("");
  const connect = async () => {
    const verifier = makeVerifier();
    sessionStorage.setItem("pkce_verifier", verifier);
    location.href = authUrl(location.origin + location.pathname, await challengeS256(verifier));
  };
  return (
    <section>
      <h2 className="section">OpenRouter</h2>
      {apiKey ? (
        <>
          <p>Connected. Your key is stored only on this device.</p>
          <button className="btn danger" onClick={() => updateSettings({ apiKey: "" })}>Disconnect</button>
        </>
      ) : (
        <>
          <button className="btn primary" onClick={connect}>Connect OpenRouter</button>
          <p className="muted small">Or paste an API key:</p>
          <form className="composer-row" onSubmit={(e) => { e.preventDefault(); if (key.trim()) { updateSettings({ apiKey: key.trim() }); setKey(""); } }}>
            <input className="input grow" type="password" autoComplete="off" placeholder="sk-or-…" value={key} onChange={(e) => setKey(e.target.value)} aria-label="OpenRouter API key" />
            <button className="btn" type="submit" disabled={!key.trim()}>Save</button>
          </form>
        </>
      )}
      <p className="muted small">The key never leaves this device except in requests to openrouter.ai. Anyone with access to this browser profile can use it, so set a spending limit on the key at openrouter.ai.</p>
    </section>
  );
}

function Models() {
  const m = useStore(modelsStore);
  const s = useStore(settingsStore);
  const row = (label: string, hint: string, href: string) => (
    <button className="row-btn compact task-row" onClick={() => go(href)}>
      <strong>{label}</strong>
      <span className="muted small">{hint}</span>
    </button>
  );
  return (
    <section>
      <p className="muted small">
        Every place Fractal uses a model. Tap one to choose its model, prompt, length and every setting that model supports.
      </p>
      <p className="muted small">
        {m.models.length ? `${m.models.length} models loaded.` : "No models loaded."} {m.error && <span className="error">{m.error}</span>}{" "}
        <button className="btn chip" onClick={() => refreshModels(true)} disabled={m.loading}>{m.loading ? "Loading…" : "Refresh list"}</button>
      </p>
      <TaskList
        extras={{
          answer: (
            <>
              <PromptSettings embedded />
              <fieldset className="field">
                <legend className="small">When you ask about highlighted words</legend>
                <label className="small">
                  The branch opens as{" "}
                  <select className="input" value={s.branchMode} onChange={(e) => updateSettings({ branchMode: e.target.value as AppSettings["branchMode"] })} aria-label="The branch opens as">
                    <option value="split">a split screen</option>
                    <option value="bubble">a bubble you can move</option>
                    <option value="layer">a layer over the original</option>
                  </select>
                </label>
                <label className="small">
                  Follow-ups in a branch{" "}
                  <select className="input" value={s.followUp} onChange={(e) => updateSettings({ followUp: e.target.value as AppSettings["followUp"] })} aria-label="Follow-ups in a branch">
                    <option value="thread">continue the same thread</option>
                    <option value="branch">each start a new branch from the same words</option>
                  </select>
                </label>
                <label className="small">
                  Keyboard{" "}
                  <select className="input" value={s.keyboardMode} onChange={(e) => updateSettings({ keyboardMode: e.target.value as AppSettings["keyboardMode"] })} aria-label="Keyboard">
                    <option value="resize">the screen gets shorter above it (nothing slides)</option>
                    <option value="overlay">it covers the screen; only the question box rises (try on your phone)</option>
                  </select>
                </label>
              </fieldset>
            </>
          ),
          quick: (
            <label className="check">
              <input type="checkbox" checked={s.quickAutoCheck} onChange={(e) => updateSettings({ quickAutoCheck: e.target.checked })} />
              <span>Check every quick answer with a second model (Quick check)</span>
            </label>
          ),
          claimCheck: (
            <label className="check">
              <input type="checkbox" checked={s.claimWebSearch} onChange={(e) => updateSettings({ claimWebSearch: e.target.checked })} />
              <span>Search the web while checking (OpenRouter's web plugin; costs more)</span>
            </label>
          ),
        }}
        extraRows={{
          Council: row("Members", "Who answers in the council (Settings › Council)", "#/settings/council"),
          Views: row("Study doc (synthesis)", "Style, prompt, length, language and model", "#/settings/synthesis"),
          Stories: row("Voice, AI images and AI video", "Their models, voices and settings (Settings › Story)", "#/settings/story"),
        }}
      />
    </section>
  );
}

const TOGGLE_LABELS: Record<keyof PromptToggles, string> = {
  premises: "Distinct, logical premises",
  pushback: "Honest pushback when challenged",
};

function PromptSettings({ embedded }: { embedded?: boolean }) {
  const { systemPrompt, answerFormat } = useStore(settingsStore);
  const toggles = detectToggles(systemPrompt);
  return (
    <section>
      <h2 className="section">{embedded ? "Prompt (the hidden system prompt)" : "Hidden system prompt"}</h2>
      <p className="muted small">Sent with every question. Changes apply to <strong>new topics</strong>; each topic keeps the prompt it started with.</p>
      {(Object.keys(PROMPT_PARTS) as (keyof PromptToggles)[]).map((k) => (
        <label key={k} className="check">
          <input type="checkbox" checked={toggles[k]} onChange={(e) => updateSettings({ systemPrompt: setToggle(systemPrompt, k, e.target.checked) })} />
          <span>{TOGGLE_LABELS[k]}</span>
        </label>
      ))}
      <textarea className="input" rows={14} value={systemPrompt} onChange={(e) => updateSettings({ systemPrompt: e.target.value })} aria-label="System prompt" />
      <button className="btn" onClick={() => updateSettings({ systemPrompt: DEFAULT_SYSTEM_PROMPT })}>Reset to default</button>
      <p className="muted small">Default: {composeSystemPrompt().length} characters.</p>
      <fieldset className="group">
        <legend>How new topics are answered</legend>
        <label className="check">
          <input type="radio" name="answer-format" checked={answerFormat !== "pyramid"} onChange={() => updateSettings({ answerFormat: "text" })} />
          <span>Full text, like Claude or Gemini (the chat)</span>
        </label>
        <label className="check">
          <input type="radio" name="answer-format" checked={answerFormat === "pyramid"} onChange={() => updateSettings({ answerFormat: "pyramid" })} />
          <span>Pyramid points (for the old map)</span>
        </label>
        <p className="muted small">Full text sends only your prompt above. Pyramid adds the fixed format section below.</p>
      </fieldset>
      {answerFormat === "pyramid" && (
        <details className="group">
          <summary>Answer format (fixed, added after your prompt)</summary>
          <p className="muted small">The old map needs answers as pyramids, so this part can't be edited.</p>
          <pre className="prompt-pre">{ANSWER_FORMAT}</pre>
        </details>
      )}
    </section>
  );
}

function ViewSettings() {
  const { readMoreLines } = useStore(settingsStore);
  return (
    <section>
      <h2 className="section">Views</h2>
      <p className="muted small">The chat always shows every message in full. In the other views (Levels, Mind map, Big idea, the study doc, diagrams), long text is cut with Read more.</p>
      <label className="field">
        <span className="field-label">Lines before “Read more”: {readMoreLines}</span>
        <input type="range" min={2} max={12} step={1} value={readMoreLines} onChange={(e) => updateSettings({ readMoreLines: Number(e.target.value) })} aria-label="Lines before Read more" />
      </label>
    </section>
  );
}

function SynthesisSettings() {
  const { synthesis } = useStore(settingsStore);
  const outlines = useLive(() => db.outlines.toArray(), []);
  const cats = [...new Set((outlines ?? []).filter((o) => o.status === "done").map((o) => o.category))].sort();
  const rename = async (from: string) => {
    const to = prompt(`Rename “${from}” to (use an existing name to merge):`, from)?.trim();
    if (!to || to === from) return;
    await db.outlines.where("category").equals(from).modify({ category: to });
  };
  return (
    <section>
      <h2 className="section">How sessions are synthesized</h2>
      <SynthesisEditor value={synthesis} onChange={(v) => updateSettings({ synthesis: v })} fallbackModel={roleModel("answer")} />
      <h2 className="section">Categories</h2>
      {cats.length ? cats.map((c) => (
        <div key={c} className="row-btn static">
          <strong>{c}</strong>
          <button className="btn chip" onClick={() => rename(c)}>Rename / merge</button>
        </div>
      )) : <p className="muted small">Categories appear after your first synthesis.</p>}
    </section>
  );
}
