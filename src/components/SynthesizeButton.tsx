import { useState } from "react";
import { synthesize } from "../synthesis";
import { settingsStore, useStore } from "../store";
import { Sheet } from "./Sheet";
import { SynthesisEditor } from "./SynthesisEditor";
import type { SynthesisSettings } from "../types";

export function SynthesizeButton({ sessionId, sessionModel }: { sessionId: string; sessionModel?: string }) {
  const base = useStore(settingsStore).synthesis;
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<SynthesisSettings>(base);
  const [started, setStarted] = useState(false);

  const start = async (override?: SynthesisSettings) => {
    await synthesize(sessionId, override);
    setStarted(true);
    setOpen(false);
    setTimeout(() => setStarted(false), 6000);
  };

  return (
    <div className="synth">
      <button className="btn primary grow" onClick={() => start()}>
        ✦ Synthesize
      </button>
      <button className="btn icon" aria-label="Synthesis options for this run" onClick={() => { setLocal(base); setOpen(true); }}>
        ▾
      </button>
      {started && (
        <span className="small muted" role="status">
          Synthesizing in the background. <a href="#/library">Library</a>
        </span>
      )}
      {open && (
        <Sheet title="Synthesize this session" onClose={() => setOpen(false)}>
          <p className="muted small">These options apply to this run only. Change the defaults in Settings › Synthesis.</p>
          <SynthesisEditor value={local} onChange={setLocal} fallbackModel={sessionModel} />
          <button className="btn primary" onClick={() => start(local)}>
            Synthesize with these settings
          </button>
        </Sheet>
      )}
    </div>
  );
}
