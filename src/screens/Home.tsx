import { db } from "../db";
import { roleModel } from "../ai";
import { Composer } from "../components/Composer";
import { go, hrefCard } from "../route";
import { modelsStore, settingsStore, useLive, useStore } from "../store";

export function Home() {
  const { apiKey } = useStore(settingsStore);
  useStore(modelsStore);
  const sessions = useLive(() => db.sessions.orderBy("updatedAt").reverse().limit(20).toArray(), []);
  return (
    <div className="scroll pad">
      <h1 className="brand">Fractal</h1>
      <p className="muted">Ask anything, then question every answer. Tap any sentence to dig deeper.</p>
      {!apiKey && (
        <div className="banner">
          Connect OpenRouter to start. <a href="#/settings/account">Open Settings</a>
        </div>
      )}
      <Composer parentId={null} placeholder="What do you want to understand?" defaultModel={roleModel("answer")} chips={false} autoFocus />
      {!!sessions?.length && (
        <>
          <h2 className="section">Continue learning</h2>
          {sessions.map((s) => (
            <button key={s.id} className="row-btn" onClick={() => go(hrefCard(s.id, s.lastCardId))}>
              <strong>{s.title}</strong>
              <span className="muted small">{new Date(s.updatedAt).toLocaleDateString()}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
