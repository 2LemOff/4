import { councilChairman, councilMembers } from "../council";
import { modelsStore, settingsStore, updateSettings, useStore } from "../store";
import { setTask, taskModel } from "../taskConfig";
import { Icon } from "./Icon";
import { ModelPicker, shortName } from "./ModelPicker";

/** Chairman, members, peer review and grounding check. Changes apply from the next council question. */
export function CouncilEditor() {
  const { council, tasks } = useStore(settingsStore);
  useStore(modelsStore);
  const members = councilMembers();
  const set = (patch: Partial<typeof council>) => updateSettings((s) => ({ council: { ...s.council, ...patch } }));
  return (
    <div className="settings-editor">
      <div className="field">
        <span className="field-label">Chairman (writes every council answer)</span>
        <ModelPicker value={tasks.chairman?.model || councilChairman()} onChange={(id) => setTask("chairman", { model: id || undefined })} label="Chairman" />
        <span className="muted small">Change it any time; the next council question uses the new chairman.</span>
      </div>
      <div className="field">
        <span className="field-label">Members ({members.length})</span>
        {members.map((m) => (
          <div key={m} className="bookmark-row">
            <span className="grow small">{shortName(m)}</span>
            <button className="btn icon sm" aria-label={`Remove ${m}`} onClick={() => set({ members: members.filter((x) => x !== m) })}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
        <ModelPicker value="" onChange={(id) => id && !members.includes(id) && set({ members: [...members, id] })} label="Add a member" emptyLabel="Add a member" />
      </div>
      <label className="check">
        <input type="checkbox" checked={council.peerReview} onChange={(e) => set({ peerReview: e.target.checked })} />
        <span>Peer review (members rank each other's anonymized answers)</span>
      </label>
      <div className="field">
        <span className="field-label">Grounding check model</span>
        <ModelPicker value={tasks.verifier?.model || taskModel("verifier")} onChange={(id) => setTask("verifier", { model: id || undefined })} label="Grounding check model" />
        <span className="muted small">Prompts, lengths and settings of the chairman, peer review and grounding check: Settings › Models.</span>
      </div>
      <label className="check">
        <input type="checkbox" checked={council.removeUnsupported} onChange={(e) => set({ removeUnsupported: e.target.checked })} />
        <span>Remove chairman points not found in the council's answers (otherwise they're marked)</span>
      </label>
    </div>
  );
}
