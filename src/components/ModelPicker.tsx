import { useMemo, useState } from "react";
import { Sheet } from "./Sheet";
import { modelsStore, useStore } from "../store";
import { familyModels, PICKER_FAMILIES, priceLabel, type PickerFamily } from "../models";
import { formatTokens } from "../context";

export const shortName = (id: string) => id.replace(/^~/, "").split("/").slice(1).join("/") || id;

export function ModelPicker({
  value,
  onChange,
  label = "Model",
  allowEmpty,
  emptyLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  /** offer a "same as …" choice that selects the empty string */
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const { models, loading, error } = useStore(modelsStore);
  const [open, setOpen] = useState(false);
  const [family, setFamily] = useState<PickerFamily | "all">("gemini-pro");
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    if (q.trim()) {
      const t = q.toLowerCase();
      return models.filter((m) => m.id.toLowerCase().includes(t) || (m.name ?? "").toLowerCase().includes(t)).slice(0, 40);
    }
    if (family === "all") return [...models].sort((a, b) => (b.created ?? 0) - (a.created ?? 0)).slice(0, 40);
    return familyModels(models, family, 8);
  }, [models, family, q]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      <button className="btn chip model-chip" aria-label={`${label}: ${value || emptyLabel || "none"}`} onClick={() => setOpen(true)}>
        {value ? shortName(value) : emptyLabel ?? "Choose model"} ▾
      </button>
      {open && (
        <Sheet title={label} onClose={() => setOpen(false)}>
          {allowEmpty && (
            <button className={`row-btn ${value === "" ? "on" : ""}`} onClick={() => pick("")}>
              {emptyLabel ?? "Default"}
            </button>
          )}
          <input className="input" placeholder="Search all models…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search models" />
          {!q && (
            <div className="chips" role="tablist">
              {PICKER_FAMILIES.map((f) => (
                <button key={f.id} role="tab" aria-selected={family === f.id} className={`btn chip ${family === f.id ? "on" : ""}`} onClick={() => setFamily(f.id)}>
                  {f.label}
                </button>
              ))}
              <button role="tab" aria-selected={family === "all"} className={`btn chip ${family === "all" ? "on" : ""}`} onClick={() => setFamily("all")}>
                All
              </button>
            </div>
          )}
          {loading && <p className="muted">Loading models…</p>}
          {error && <p className="error">Couldn’t load the model list: {error}</p>}
          {!loading && !models.length && !error && <p className="muted">No models loaded yet.</p>}
          {list.map((m) => (
            <button key={m.id} className={`row-btn ${m.id === value ? "on" : ""}`} onClick={() => pick(m.id)}>
              <strong>{shortName(m.id)}</strong>
              <span className="muted small">
                {m.context_length ? `${formatTokens(m.context_length)} context · ` : ""}
                {priceLabel(m)}
                {m.reasoning ? " · reasoning" : ""}
              </span>
            </button>
          ))}
          {!list.length && models.length > 0 && <p className="muted">No matches.</p>}
        </Sheet>
      )}
    </>
  );
}
