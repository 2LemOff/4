import { useEffect, useMemo, useState } from "react";
import { db } from "../db";
import { buildBackup, restoreBackup, shareOrDownload } from "../backup";
import { deleteMedia, deleteTopics, estimate, formatBytes, isPersisted, requestPersist, usageBreakdown, type FileInfo, type TopicUsage } from "../storage";
import { settingsStore, updateSettings, useStore } from "../store";

const KIND_LABEL = { audio: "Voice", image: "Image", video: "Video" } as const;

export function StorageSettings() {
  const s = useStore(settingsStore);
  const [persisted, setPersisted] = useState<boolean | undefined>();
  const [est, setEst] = useState<{ usage?: number; quota?: number }>({});
  const [usage, setUsage] = useState<{ topics: TopicUsage[]; files: FileInfo[] } | null>(null);
  const [pickTopics, setPickTopics] = useState<Set<string>>(new Set());
  const [pickFiles, setPickFiles] = useState<Set<string>>(new Set());
  const [includeVideos, setIncludeVideos] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setPersisted(await isPersisted());
    setEst(await estimate());
    setUsage(await usageBreakdown());
  };
  useEffect(() => {
    void refresh();
  }, []);

  const topicTitle = useMemo(() => new Map(usage?.topics.map((t) => [t.sessionId, t.title]) ?? []), [usage]);
  const freed =
    (usage?.topics.filter((t) => pickTopics.has(t.sessionId)).reduce((n, t) => n + t.total, 0) ?? 0) +
    (usage?.files.filter((f) => pickFiles.has(f.id) && !pickTopics.has(f.sessionId)).reduce((n, f) => n + f.size, 0) ?? 0);
  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    fn(next);
  };
  const selectKind = (kind: FileInfo["kind"]) => setPickFiles(new Set([...pickFiles, ...(usage?.files.filter((f) => f.kind === kind).map((f) => f.id) ?? [])]));

  const backup = async () => {
    setBusy(true);
    setMsg("");
    try {
      const zip = await buildBackup({ includeVideos, settings: settingsStore.get() });
      const how = await shareOrDownload(zip);
      updateSettings({ lastBackupAt: Date.now() });
      setMsg(`${how === "shared" ? "Backup shared" : "Backup downloaded"} (${formatBytes(zip.byteLength)}).`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const restore = async (file: File) => {
    try {
      const r = await restoreBackup(new Uint8Array(await file.arrayBuffer()));
      if (r.settings) updateSettings((cur) => ({ ...r.settings, apiKey: cur.apiKey }));
      setMsg(`Restored ${r.sessions} topics and ${r.media} files.`);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <h2 className="section">On this phone</h2>
      <p className="small">
        {est.usage !== undefined ? `Using ${formatBytes(est.usage)}` : "Usage unknown"}
        {est.quota ? ` of up to ${formatBytes(est.quota)} available to Fractal.` : "."}
      </p>
      <p className="small" role="status">
        Protected from automatic cleanup: <strong>{persisted === undefined ? "unknown" : persisted ? "yes" : "no"}</strong>
      </p>
      {!persisted && (
        <button className="btn sm" onClick={async () => setPersisted(await requestPersist())}>
          Protect my data
        </button>
      )}

      <h2 className="section">Back up</h2>
      <p className="muted small">One file with every topic, bookmark, story and picture. Your API key is never included. Save it to Google Drive or Files from the share menu.</p>
      <label className="check">
        <input type="checkbox" checked={includeVideos} onChange={(e) => setIncludeVideos(e.target.checked)} />
        <span>Include videos</span>
      </label>
      <div className="chips">
        <button className="btn primary sm" onClick={backup} disabled={busy}>{busy ? "Preparing…" : "Back up"}</button>
        <label className="btn sm">
          Restore
          <input type="file" accept=".zip,application/zip,application/json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
        </label>
      </div>
      <p className="muted small">{s.lastBackupAt ? `Last backup: ${new Date(s.lastBackupAt).toLocaleString()}` : "No backup yet."}</p>
      <label className="field">
        <span className="field-label">Remind me to back up after</span>
        <select className="input" value={s.backupReminderDays} onChange={(e) => updateSettings({ backupReminderDays: Number(e.target.value) })}>
          <option value={3}>3 days</option>
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={0}>Never</option>
        </select>
      </label>
      {msg && <p className="small" role="status">{msg}</p>}

      <h2 className="section">Topics</h2>
      {!usage?.topics.length && <p className="muted small">No topics yet.</p>}
      {usage?.topics.map((t) => (
        <label key={t.sessionId} className="file-row">
          <input type="checkbox" checked={pickTopics.has(t.sessionId)} onChange={() => toggle(pickTopics, t.sessionId, setPickTopics)} aria-label={`Select topic ${t.title}`} />
          <span className="grow">
            <strong>{t.title}</strong>
            <span className="muted small">
              {" "}
              text {formatBytes(t.text)} · search {formatBytes(t.index)}
              {t.audio ? ` · voice ${formatBytes(t.audio)}` : ""}
              {t.image ? ` · images ${formatBytes(t.image)}` : ""}
              {t.video ? ` · videos ${formatBytes(t.video)}` : ""}
            </span>
          </span>
          <span className="small">{formatBytes(t.total)}</span>
        </label>
      ))}

      <h2 className="section">Files</h2>
      {!usage?.files.length && <p className="muted small">No voice, image or video files yet.</p>}
      {!!usage?.files.length && (
        <div className="chips">
          <button className="btn chip" onClick={() => selectKind("video")}>Select all videos</button>
          <button className="btn chip" onClick={() => selectKind("image")}>Select all images</button>
          <button className="btn chip" onClick={() => selectKind("audio")}>Select all voice</button>
          <button className="btn chip" onClick={() => (setPickFiles(new Set()), setPickTopics(new Set()))}>Clear</button>
        </div>
      )}
      {usage?.files.map((f) => (
        <label key={f.id} className="file-row">
          <input type="checkbox" checked={pickFiles.has(f.id)} onChange={() => toggle(pickFiles, f.id, setPickFiles)} aria-label={`Select ${f.label}`} />
          <span className="grow">
            <strong>{f.label}</strong>
            <span className="muted small"> {KIND_LABEL[f.kind]} · {topicTitle.get(f.sessionId) ?? ""} · {new Date(f.createdAt).toLocaleDateString()}</span>
          </span>
          <span className="small">{formatBytes(f.size)}</span>
        </label>
      ))}

      {(pickFiles.size > 0 || pickTopics.size > 0) && (
        <div className="delete-bar" role="status">
          <span className="grow small">Frees about {formatBytes(freed)}</span>
          <button
            className="btn danger sm"
            onClick={async () => {
              const what = [pickTopics.size ? `${pickTopics.size} topic(s) with everything in them` : "", pickFiles.size ? `${pickFiles.size} file(s)` : ""].filter(Boolean).join(" and ");
              if (!confirm(`Delete ${what}? Stories keep their text and can regenerate deleted pictures, voice and videos.`)) return;
              await deleteMedia([...pickFiles]);
              await deleteTopics([...pickTopics]);
              setPickFiles(new Set());
              setPickTopics(new Set());
              await refresh();
            }}
          >
            Delete selected
          </button>
        </div>
      )}

      <h2 className="section">Everything</h2>
      <button
        className="btn danger sm"
        onClick={async () => {
          if (!confirm("Delete all topics, outlines, bookmarks, stories and files on this device?")) return;
          await Promise.all([db.sessions.clear(), db.cards.clear(), db.outlines.clear(), db.vectors.clear(), db.bookmarks.clear(), db.stories.clear(), db.media.clear()]);
          await refresh();
        }}
      >
        Delete all learning data
      </button>
    </section>
  );
}
