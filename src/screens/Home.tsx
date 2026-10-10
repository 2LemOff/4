import { useState } from "react";
import { db } from "../db";
import { CouncilEditor } from "../components/CouncilEditor";
import { Sheet } from "../components/Sheet";
import { roleModel } from "../ai";
import { BookmarkList } from "../components/BookmarkList";
import { Composer } from "../components/Composer";
import { go, hrefChat } from "../route";
import { modelsStore, settingsStore, useLive, useStore } from "../store";

const DAY = 24 * 3600 * 1000;

export function Home() {
  const { apiKey, lastBackupAt, backupReminderDays } = useStore(settingsStore);
  useStore(modelsStore);
  const [council, setCouncil] = useState(false);
  const [sheet, setSheet] = useState(false);
  const sessions = useLive(() => db.sessions.orderBy("updatedAt").reverse().limit(20).toArray(), []);
  const overdue = !!sessions?.length && backupReminderDays > 0 && Date.now() - (lastBackupAt ?? 0) > backupReminderDays * DAY;
  return (
    <div className="scroll pad">
      <h1 className="brand">Fractal</h1>
      <p className="muted small">Ask anything. Then highlight any words in an answer to ask about them; every question starts its own branch.</p>
      {!apiKey && (
        <div className="banner">
          Connect OpenRouter to start. <a href="#/settings/account">Open Settings</a>
        </div>
      )}
      {overdue && (
        <div className="banner">
          {lastBackupAt ? `Last backup ${Math.floor((Date.now() - lastBackupAt) / DAY)} days ago.` : "You haven't backed up yet."}{" "}
          <a href="#/settings/storage">Back up now</a>
        </div>
      )}
      <Composer
        parentId={null}
        placeholder="What do you want to understand?"
        defaultModel={roleModel("answer")}
        big
        autoFocus
        attach
        council={council}
        onCouncilToggle={() => setCouncil(!council)}
        onCouncilSettings={() => setSheet(true)}
        onAsked={(r) => {
          try {
            localStorage.setItem(`fractal.council.${r.sessionId}`, council ? "1" : "0");
          } catch {
            /* ignore */
          }
          go(hrefChat(r.sessionId, { focus: r.cardId }));
        }}
      />
      {sheet && (
        <Sheet title="LLM Council" onClose={() => setSheet(false)}>
          <CouncilEditor />
          <button className="btn primary" onClick={() => setSheet(false)}>Done</button>
        </Sheet>
      )}
      <BookmarkList />
      {!!sessions?.length && (
        <>
          <h2 className="section">Continue learning</h2>
          {sessions.map((s) => (
            <button key={s.id} className="row-btn compact" onClick={() => go(hrefChat(s.id))}>
              <strong>{s.title}</strong>
              <span className="muted small">{new Date(s.updatedAt).toLocaleDateString()}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
