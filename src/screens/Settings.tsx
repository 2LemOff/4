import { useState } from "react";
import { db } from "../db";
import { roleModel, settingsFor } from "../ai";
import { ModelPicker } from "../components/ModelPicker";
import { ModelSettingsEditor } from "../components/ModelSettingsEditor";
import { SynthesisEditor } from "../components/SynthesisEditor";
import { challengeS256, authUrl, makeVerifier } from "../openrouter";
import { composeSystemPrompt, DEFAULT_SYSTEM_PROMPT, detectToggles, PROMPT_PARTS, setToggle } from "../prompts";
import { go } from "../route";
import { modelsStore, refreshModels, settingsStore, updateSettings, useLive, useStore } from "../store";
import type { PromptToggles } from "../types";

const SECTIONS = [
  ["account", "Account"],
  ["models", "Models"],
  ["prompt", "System prompt"],
  ["synthesis", "Synthesis"],
  ["data", "Data"],
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
      {section === "prompt" && <PromptSettings />}
      {section === "synthesis" && <SynthesisSettings />}
      {section === "data" && <Data />}
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
  const s = useStore(settingsStore);
  const m = useStore(modelsStore);
  const answer = roleModel("answer") ?? "";
  const role = (key: "answer" | "tags" | "rerank", label: string, hint: string) => (
    <div className="field">
      <span className="field-label">{label}</span>
      <ModelPicker value={s.roleModels[key] ?? roleModel(key) ?? ""} onChange={(id) => updateSettings({ roleModels: { ...s.roleModels, [key]: id } })} label={label} />
      <span className="muted small">{hint}</span>
    </div>
  );
  return (
    <section>
      <h2 className="section">Model per role</h2>
      {role("answer", "Answers", "Newest Gemini Pro by default. Can be changed per question.")}
      {role("tags", "Tags and summaries", "Newest Gemini Flash by default.")}
      {role("rerank", "Search reranking", "Newest Claude Sonnet by default.")}
      <label className="field">
        <span className="field-label">Embeddings (search)</span>
        <select className="input" value={s.roleModels.embed ?? ""} onChange={(e) => updateSettings({ roleModels: { ...s.roleModels, embed: e.target.value || undefined } })}>
          <option value="">Automatic ({roleModel("embed") ?? "none available"})</option>
          {m.embedModels.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
        </select>
      </label>
      <p className="muted small">
        {m.models.length ? `${m.models.length} models loaded.` : "No models loaded."} {m.error && <span className="error">{m.error}</span>}{" "}
        <button className="btn chip" onClick={() => refreshModels(true)} disabled={m.loading}>{m.loading ? "Loading…" : "Refresh list"}</button>
      </p>
      {answer && (
        <>
          <h2 className="section">Default settings for {answer.split("/").pop()}</h2>
          <ModelSettingsEditor modelId={answer} value={settingsFor(answer)} onChange={(v) => updateSettings({ modelSettings: { ...s.modelSettings, [answer]: v } })} />
        </>
      )}
    </section>
  );
}

const TOGGLE_LABELS: Record<keyof PromptToggles, string> = {
  noWalls: "Directive 1: no walls of text, distinct premises",
  firstPrinciples: "Directive 2: first principles",
  premiseFormat: "Premise formatting (short paragraphs, blank lines)",
  pushback: "Honest pushback",
};

function PromptSettings() {
  const { systemPrompt } = useStore(settingsStore);
  const toggles = detectToggles(systemPrompt);
  return (
    <section>
      <h2 className="section">Hidden system prompt</h2>
      <p className="muted small">Sent with every question. Changes apply to <strong>new sessions</strong>; each session keeps the prompt it started with.</p>
      {(Object.keys(PROMPT_PARTS) as (keyof PromptToggles)[]).map((k) => (
        <label key={k} className="check">
          <input type="checkbox" checked={toggles[k]} onChange={(e) => updateSettings({ systemPrompt: setToggle(systemPrompt, k, e.target.checked) })} />
          <span>{TOGGLE_LABELS[k]}</span>
        </label>
      ))}
      {!toggles.premiseFormat && <p className="notice error small">Cards split answers on blank lines, so without the formatting rule blocks may be long.</p>}
      <textarea className="input" rows={14} value={systemPrompt} onChange={(e) => updateSettings({ systemPrompt: e.target.value })} aria-label="System prompt" />
      <button className="btn" onClick={() => updateSettings({ systemPrompt: DEFAULT_SYSTEM_PROMPT })}>Reset to default</button>
      <p className="muted small">Default: {composeSystemPrompt().length} characters.</p>
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

function Data() {
  const [msg, setMsg] = useState("");
  const exportAll = async () => {
    const data = { app: "fractal", version: 1, sessions: await db.sessions.toArray(), cards: await db.cards.toArray(), outlines: await db.outlines.toArray() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `fractal-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importAll = async (file: File) => {
    try {
      const d = JSON.parse(await file.text());
      if (d.app !== "fractal") throw new Error("Not a Fractal export.");
      await db.sessions.bulkPut(d.sessions ?? []);
      await db.cards.bulkPut(d.cards ?? []);
      await db.outlines.bulkPut(d.outlines ?? []);
      setMsg(`Imported ${d.sessions?.length ?? 0} sessions.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section>
      <h2 className="section">Your data</h2>
      <p className="muted small">Everything is stored on this device. Exports don’t include your API key.</p>
      <button className="btn" onClick={exportAll}>Export as JSON</button>
      <label className="btn">
        Import JSON
        <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importAll(e.target.files[0])} />
      </label>
      <button
        className="btn danger"
        onClick={async () => {
          if (!confirm("Delete all sessions, cards and outlines on this device?")) return;
          await Promise.all([db.sessions.clear(), db.cards.clear(), db.outlines.clear(), db.vectors.clear()]);
          setMsg("All learning data deleted.");
        }}
      >
        Delete all learning data
      </button>
      {msg && <p role="status" className="small">{msg}</p>}
    </section>
  );
}
