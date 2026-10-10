import { useEffect, useRef, useState } from "react";
import { ask, settingsFor } from "../ai";
import { councilChairman, councilMembers as councilMembersList } from "../council";
import { taskSetup } from "../taskConfig";
import { go, hrefCard } from "../route";
import { settingsStore, updateSettings, useStore } from "../store";
import { Icon } from "./Icon";
import { ModelPicker } from "./ModelPicker";
import { ModelSettingsEditor } from "./ModelSettingsEditor";
import { Sheet } from "./Sheet";
import type { Anchor, ModelSettings } from "../types";

const councilMembersCount = () => councilMembersList().length;
export const CHIPS = ["Why?", "How do you know?", "Example", "What if this is wrong?"];
const CHIPS_KEY = "fractal.chipsOpen";

const readChips = () => {
  try {
    return localStorage.getItem(CHIPS_KEY) === "1";
  } catch {
    return false;
  }
};

export function Composer({
  sessionId,
  parentId,
  anchor,
  anchorLabel,
  onClearAnchor,
  placeholder,
  defaultModel,
  big,
  autoFocus,
  inputRef,
  onAsked,
  council,
  onCouncilToggle,
  onCouncilSettings,
  forceModel,
  sendIcon,
  initialText,
  fromVisual,
}: {
  sessionId?: string;
  parentId: string | null;
  anchor?: Anchor;
  /** what the question is about, shown as a removable chip */
  anchorLabel?: string;
  onClearAnchor?: () => void;
  placeholder: string;
  defaultModel: string | undefined;
  /** the first, big question box on Home */
  big?: boolean;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  onAsked?: (r: { cardId: string; sessionId: string }) => void;
  /** LLM Council on for this question (the chairman then answers) */
  council?: boolean;
  onCouncilToggle?: () => void;
  onCouncilSettings?: () => void;
  /** switch the single model from outside ("Continue with this model") */
  forceModel?: { id: string; n: number };
  /** a round send icon instead of the "Ask" label (the chat) */
  sendIcon?: boolean;
  /** text typed in for you (e.g. a question offered by a view) */
  initialText?: string;
  /** asked from a visual's side chat */
  fromVisual?: string;
}) {
  const { apiKey } = useStore(settingsStore);
  const [text, setText] = useState(initialText ?? "");
  useEffect(() => {
    if (initialText) setText(initialText);
  }, [initialText]);
  const [model, setModel] = useState(defaultModel ?? "");
  const [settings, setSettings] = useState<ModelSettings>(() => settingsFor(defaultModel ?? ""));
  const [open, setOpen] = useState(false);
  const [chips, setChips] = useState(readChips);
  const [err, setErr] = useState("");
  const own = useRef<HTMLTextAreaElement>(null);
  const ta = inputRef ?? own;

  useEffect(() => {
    if (defaultModel) {
      setModel(defaultModel);
      setSettings(settingsFor(defaultModel));
    }
  }, [defaultModel]);

  useEffect(() => {
    if (forceModel?.id) {
      setModel(forceModel.id);
      setSettings(settingsFor(forceModel.id));
    }
  }, [forceModel?.id, forceModel?.n]);

  const grow = () => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    const max = big ? Math.round(window.innerHeight * 0.45) : 104;
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
  };
  useEffect(grow, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleChips = () => {
    setChips((c) => {
      try {
        localStorage.setItem(CHIPS_KEY, c ? "0" : "1");
      } catch {
        /* storage may be unavailable */
      }
      return !c;
    });
  };

  const submit = async (q: string) => {
    const question = q.trim();
    if (!question) return;
    if (!apiKey) return setErr("Connect OpenRouter in Settings first.");
    if (!model) return setErr("Choose a model first.");
    setErr("");
    const chair = council ? councilChairman() : model;
    if (council && !chair) return setErr("Choose a chairman in Settings › Council.");
    const r = await ask({ sessionId, parentId, question, anchor, model: chair, settings: council ? taskSetup("chairman").settings : settings, council, fromVisual });
    setText("");
    onClearAnchor?.();
    if (onAsked) onAsked(r);
    else go(hrefCard(r.sessionId, r.cardId));
  };

  return (
    <div className={`composer ${big ? "big" : ""}`}>
      {anchorLabel && (
        <div className="anchor-chip" role="status">
          <span className="small">Asking about: {anchorLabel}</span>
          {onClearAnchor && (
            <button className="btn icon xs" aria-label="Ask about the whole answer instead" onClick={onClearAnchor}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      )}
      {chips && !big && (
        <div className="chips quick" aria-label="Quick questions">
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
        <textarea
          ref={ta}
          className="input grow"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit(text);
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus={autoFocus}
        />
        {!big && (
          <button type="button" className={`btn icon sm ${chips ? "on" : ""}`} aria-label="Quick questions" aria-expanded={chips} onClick={toggleChips}>
            <Icon name="help" />
          </button>
        )}
        {onCouncilToggle && (
          <>
            <button type="button" className={`btn icon sm ${council ? "on" : ""}`} aria-label="Council" aria-pressed={!!council} onClick={onCouncilToggle} title="LLM Council">
              <Icon name="council" />
            </button>
            {council && onCouncilSettings && (
              <button type="button" className="btn icon xs" aria-label="Council settings" onClick={onCouncilSettings}>
                ▾
              </button>
            )}
          </>
        )}
        <button type="button" className="btn icon sm" aria-label="Model settings" onClick={() => setOpen(true)}>
          <Icon name="settings" />
        </button>
        {!big &&
          (sendIcon ? (
            <button type="submit" className="btn primary icon sm round" aria-label="Ask" disabled={!text.trim()}>
              <Icon name="up" />
            </button>
          ) : (
            <button type="submit" className="btn primary sm" disabled={!text.trim()}>
              Ask
            </button>
          ))}
      </form>
      {big && (
        <button type="button" className="btn primary wide" disabled={!text.trim()} onClick={() => submit(text)}>
          Ask
        </button>
      )}
      {council && <p className="muted small council-note">Council on: {`each member answers, they review each other, then the chairman writes the answer (about ${2 * councilMembersCount() + 2} model calls)`}</p>}
      {err && (
        <p className="error small" role="alert">
          {err} {!apiKey && <a href="#/settings/account">Open Settings</a>}
        </p>
      )}
      {open && (
        <Sheet title="Model settings" onClose={() => setOpen(false)}>
          <p className="muted small">These settings apply to this question.</p>
          <ModelPicker value={model} onChange={(id) => (setModel(id), setSettings(settingsFor(id)))} label="Model for this question" />
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
