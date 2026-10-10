import { useEffect, useRef, useState } from "react";
import { ask, settingsFor } from "../ai";
import { councilChairman, councilMembers as councilMembersList } from "../council";
import { cropImage, seesImages, shrinkImage, visionModelFor } from "../photos";
import { taskSetup } from "../taskConfig";
import { go, hrefCard } from "../route";
import { modelInfo, settingsStore, updateSettings, useStore } from "../store";
import { AttachedRow, AttachSheet, attachedLabels, ImageRegion, type Attached, type Box } from "./Attachments";
import { Icon } from "./Icon";
import { ModelPicker, shortName } from "./ModelPicker";
import { ModelSettingsEditor } from "./ModelSettingsEditor";
import { Sheet } from "./Sheet";
import type { Anchor, ModelSettings } from "../types";

const councilMembersCount = () => councilMembersList().length;
export const CHIPS = ["Why?", "How do you know?", "Example", "What if this is wrong?"];
const CHIPS_KEY = "fractal.chipsOpen";

let attachSeq = 0;
const isPicture = (f: Blob) => !f.type || f.type.startsWith("image/");

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
  attach,
  addPicture,
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
  /** photos and screenshots can be sent with the question (+, paste) */
  attach?: boolean;
  /** a picture sent earlier, added again with the part of it to ask about */
  addPicture?: { blob: Blob; box: Box; n: number };
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
  const [attached, setAttached] = useState<Attached[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [region, setRegion] = useState<string>();
  // pictures still being made smaller or cut (the question waits for them)
  const [preparing, setPreparing] = useState(0);
  // the model chosen before pictures needed one that can see them (back when they're all removed)
  const [switchedFrom, setSwitchedFrom] = useState<string>();
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

  // thumbnails are object URLs: let them go when the question box closes
  const live = useRef(attached);
  live.current = attached;
  useEffect(() => () => live.current.forEach((a) => URL.revokeObjectURL(a.url)), []);

  const make = (blob: Blob, extra: Partial<Attached> = {}): Attached => ({ key: `p${++attachSeq}`, blob, url: URL.createObjectURL(blob), ...extra });
  const addFiles = async (files: Blob[]) => {
    const pics = files.filter(isPicture);
    setErr(pics.length < files.length ? "Only pictures can be added." : "");
    setPreparing((n) => n + pics.length);
    for (const f of pics) {
      try {
        const a = make(await shrinkImage(f), { original: f });
        live.current = [...live.current, a];
        setAttached((list) => [...list, a]);
      } catch {
        setErr("A picture couldn't be opened.");
      } finally {
        setPreparing((n) => n - 1);
      }
    }
  };
  // a part is cut from the picture as it was taken (sharper), then made smaller like any picture
  const addPart = async (key: string, box: Box) => {
    const whole = live.current.find((a) => a.key === key);
    if (!whole) return;
    setPreparing((n) => n + 1);
    let part: Attached;
    try {
      part = make(await shrinkImage(await cropImage(whole.original ?? whole.blob, box)), { partOf: key });
    } catch {
      return setErr("That part couldn't be cut out.");
    } finally {
      setPreparing((n) => n - 1);
    }
    setAttached((a) => {
      let at = a.findIndex((x) => x.key === key) + 1;
      if (!at) return a;
      while (at < a.length && a[at].partOf === key) at++;
      return [...a.slice(0, at), part, ...a.slice(at)];
    });
  };
  const remove = (key: string) => {
    const gone = attached.filter((a) => a.key === key || a.partOf === key);
    gone.forEach((a) => URL.revokeObjectURL(a.url));
    setAttached((a) => a.filter((x) => !gone.some((g) => g.key === x.key)));
  };

  useEffect(() => {
    if (!addPicture) return;
    const whole = make(addPicture.blob);
    setAttached((a) => [...a, whole]);
    live.current = [...live.current, whole];
    void addPart(whole.key, addPicture.box);
  }, [addPicture?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // pictures need a model that can see them (council members that can't get the text read from them)
  const hasPictures = attached.length > 0;
  useEffect(() => {
    if (!hasPictures) {
      if (switchedFrom) {
        setModel(switchedFrom);
        setSettings(settingsFor(switchedFrom));
        setSwitchedFrom(undefined);
      }
      return;
    }
    if (council || !model || seesImages(modelInfo(model))) return;
    const v = visionModelFor(model);
    if (!v) return;
    setSwitchedFrom(model);
    setModel(v);
    setSettings(settingsFor(v));
  }, [hasPictures, council, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const pictureNote = !hasPictures
    ? ""
    : council
      ? "Council members that can't see pictures get the text read from them."
      : !seesImages(modelInfo(model))
        ? "None of the models can see pictures: the text read from them is sent instead."
        : switchedFrom
          ? `Using ${shortName(model)}, which can see pictures.`
          : "";

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
    const question = q.trim() || (attached.length ? (attached.length > 1 ? "Explain these pictures." : "Explain this picture.") : "");
    if (!question || preparing) return;
    if (!apiKey) return setErr("Connect OpenRouter in Settings first.");
    if (!model) return setErr("Choose a model first.");
    setErr("");
    const chair = council ? councilChairman() : model;
    if (council && !chair) return setErr("Choose a chairman in Settings › Council.");
    const labels = attachedLabels(attached);
    const keys = attached.map((a) => a.key);
    const images = attached.map((a) => ({ blob: a.blob, label: labels.get(a.key) ?? "Picture", partOf: a.partOf ? keys.indexOf(a.partOf) : undefined }));
    const r = await ask({ sessionId, parentId, question, anchor, model: chair, settings: council ? taskSetup("chairman").settings : settings, council, fromVisual, images: images.length ? images : undefined });
    setText("");
    attached.forEach((a) => URL.revokeObjectURL(a.url));
    // the question went to the model that sees them: that stays the choice
    setSwitchedFrom(undefined);
    setAttached([]);
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
      {(attached.length > 0 || preparing > 0) && <AttachedRow list={attached} preparing={preparing} onRemove={remove} onPart={setRegion} />}
      {pictureNote && <p className="muted small" role="status">{pictureNote}</p>}
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
        {attach && (
          <button type="button" className="btn icon sm" aria-label="Add a picture" onClick={() => setAttachOpen(true)}>
            <Icon name="attach" />
          </button>
        )}
        <textarea
          ref={ta}
          className="input grow"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = attach ? [...e.clipboardData.files].filter(isPicture) : [];
            if (!files.length) return;
            e.preventDefault();
            void addFiles(files);
          }}
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
            <button type="submit" className="btn primary icon sm round" aria-label="Ask" disabled={(!text.trim() && !attached.length) || preparing > 0}>
              <Icon name="up" />
            </button>
          ) : (
            <button type="submit" className="btn primary sm" disabled={(!text.trim() && !attached.length) || preparing > 0}>
              Ask
            </button>
          ))}
      </form>
      {big && (
        <button type="button" className="btn primary wide" disabled={(!text.trim() && !attached.length) || preparing > 0} onClick={() => submit(text)}>
          Ask
        </button>
      )}
      {council && <p className="muted small council-note">Council on: {`each member answers, they review each other, then the chairman writes the answer (about ${2 * councilMembersCount() + 2} model calls)`}</p>}
      {err && (
        <p className="error small" role="alert">
          {err} {!apiKey && <a href="#/settings/account">Open Settings</a>}
        </p>
      )}
      {attachOpen && <AttachSheet onFiles={(f) => void addFiles(f)} onClose={() => setAttachOpen(false)} />}
      {region && (
        <ImageRegion
          src={attached.find((a) => a.key === region)?.url ?? ""}
          onDone={(box) => {
            const key = region;
            setRegion(undefined);
            void addPart(key, box);
          }}
          onClose={() => setRegion(undefined)}
        />
      )}
      {open && (
        <Sheet title="Model settings" onClose={() => setOpen(false)}>
          <p className="muted small">These settings apply to this question.</p>
          {attached.length > 0 && <p className="muted small">Only models that can see pictures are listed.</p>}
          <ModelPicker value={model} onChange={(id) => (setModel(id), setSettings(settingsFor(id)))} label="Model for this question" filter={attached.length ? seesImages : undefined} />
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
