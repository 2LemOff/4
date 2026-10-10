import { useState } from "react";
import { councilChairman, councilMembers, memberSettings } from "../council";
import { modelsStore, settingsStore, updateSettings, useStore } from "../store";
import { setTask, taskModel } from "../taskConfig";
import type { TaskId } from "../tasks";
import { Icon } from "./Icon";
import { ModelPicker, shortName } from "./ModelPicker";
import { ModelSettingsEditor } from "./ModelSettingsEditor";
import { Sheet } from "./Sheet";
import { TaskEditor } from "./TaskEditor";

/** Chairman, members (each with its own settings), peer review and grounding check. Changes apply from the next council question. */
export function CouncilEditor() {
  const { council, tasks } = useStore(settingsStore);
  useStore(modelsStore);
  const members = councilMembers();
  const [member, setMember] = useState<string>();
  const [task, setTaskOpen] = useState<TaskId>();
  const set = (patch: Partial<typeof council>) => updateSettings((s) => ({ council: { ...s.council, ...patch } }));
  const setMemberSettings = (m: string, v: (typeof council.memberSettings & object)[string] | undefined) =>
    updateSettings((s) => {
      const next = { ...s.council.memberSettings };
      if (v) next[m] = v;
      else delete next[m];
      return { council: { ...s.council, memberSettings: next } };
    });
  const gear = (label: string, onClick: () => void) => (
    <button className="btn icon sm" aria-label={label} onClick={onClick}>
      <Icon name="settings" size={15} />
    </button>
  );
  return (
    <div className="settings-editor">
      <div className="field">
        <span className="field-label">Chairman (writes every council answer)</span>
        <div className="bookmark-row">
          <ModelPicker value={tasks.chairman?.model || councilChairman()} onChange={(id) => setTask("chairman", { model: id || undefined })} label="Chairman" />
          {gear("Chairman settings", () => setTaskOpen("chairman"))}
        </div>
        <span className="muted small">Change it any time; the next council question uses the new chairman.</span>
      </div>
      <div className="field">
        <span className="field-label">Members ({members.length})</span>
        {members.map((m) => (
          <div key={m} className="bookmark-row">
            <span className="grow small">
              {shortName(m)}
              {council.memberSettings?.[m] ? <span className="muted"> · own settings</span> : null}
            </span>
            {gear(`Settings for ${shortName(m)}`, () => setMember(m))}
            <button className="btn icon sm" aria-label={`Remove ${m}`} onClick={() => set({ members: members.filter((x) => x !== m) })}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
        <ModelPicker value="" onChange={(id) => id && !members.includes(id) && set({ members: [...members, id] })} label="Add a member" emptyLabel="Add a member" />
      </div>
      <div className="bookmark-row">
        <label className="check grow">
          <input type="checkbox" checked={council.peerReview} onChange={(e) => set({ peerReview: e.target.checked })} />
          <span>Peer review (members rank each other's anonymized answers)</span>
        </label>
        {gear("Peer review settings", () => setTaskOpen("review"))}
      </div>
      <div className="field">
        <span className="field-label">Grounding check model</span>
        <div className="bookmark-row">
          <ModelPicker value={tasks.verifier?.model || taskModel("verifier")} onChange={(id) => setTask("verifier", { model: id || undefined })} label="Grounding check model" />
          {gear("Grounding check settings", () => setTaskOpen("verifier"))}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={council.removeUnsupported} onChange={(e) => set({ removeUnsupported: e.target.checked })} />
        <span>Pyramid topics: remove points not found in the council's answers (otherwise marked). Full-text answers always fold them, never delete.</span>
      </label>
      {member && (
        <Sheet title={`Member: ${shortName(member)}`} onClose={() => setMember(undefined)}>
          <p className="muted small">Used when this member answers and when it reviews the others.</p>
          <ModelSettingsEditor modelId={member} value={memberSettings(member)} onChange={(v) => setMemberSettings(member, v)} />
          <button className="btn sm" onClick={() => setMemberSettings(member, undefined)}>Reset to this model's defaults</button>
          <button className="btn primary" onClick={() => setMember(undefined)}>Done</button>
        </Sheet>
      )}
      {task && (
        <Sheet title={task === "chairman" ? "Chairman" : task === "review" ? "Peer review" : "Grounding check"} onClose={() => setTaskOpen(undefined)}>
          <TaskEditor id={task} />
          <button className="btn primary" onClick={() => setTaskOpen(undefined)}>Done</button>
        </Sheet>
      )}
    </div>
  );
}
