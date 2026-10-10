import { useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

/** A picture waiting to be sent with the next question. */
export interface Attached {
  key: string;
  blob: Blob;
  /** object URL for the thumbnail */
  url: string;
  /** the picture this one is a part of (a box drawn over it) */
  partOf?: string;
  /** the file as picked, for cutting sharper parts */
  original?: Blob;
}

/** A part of a picture, as fractions (0–1) of its width and height. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** "Picture 2", or "Part of picture 2" for a box drawn over it. */
export function attachedLabels(list: Attached[]): Map<string, string> {
  const whole = list.filter((a) => !a.partOf);
  const n = new Map(whole.map((a, i) => [a.key, i + 1]));
  return new Map(list.map((a) => [a.key, a.partOf ? `Part of picture ${n.get(a.partOf) ?? "?"}` : `Picture ${n.get(a.key)}`]));
}

/** Take a photo, pick photos or screenshots, choose a file, or paste a copied picture. */
export function AttachSheet({ onFiles, onClose }: { onFiles: (files: Blob[]) => void; onClose: () => void }) {
  const [err, setErr] = useState("");
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!files.length) return;
    onFiles(files);
    onClose();
  };
  const paste = async () => {
    setErr("");
    try {
      const blobs: Blob[] = [];
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) blobs.push(await item.getType(type));
      }
      if (!blobs.length) return setErr("There's no picture on the clipboard.");
      onFiles(blobs);
      onClose();
    } catch {
      setErr("The clipboard can't be read here. Long-press the question box and choose Paste instead.");
    }
  };
  return (
    <Sheet title="Add a picture" onClose={onClose}>
      <label className="row-btn">
        <span className="row-line"><Icon name="camera" size={16} /> Take a photo</span>
        <input type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      </label>
      <label className="row-btn">
        <span className="row-line"><Icon name="image" size={16} /> Photos and screenshots</span>
        <input type="file" accept="image/*" multiple hidden onChange={pick} />
      </label>
      <label className="row-btn">
        <span className="row-line"><Icon name="file" size={16} /> From files</span>
        <input type="file" multiple hidden onChange={pick} />
      </label>
      <button className="row-btn" onClick={paste}>
        <span className="row-line"><Icon name="paste" size={16} /> Paste a copied picture</span>
      </button>
      {err && <p className="error small" role="alert">{err}</p>}
      <p className="muted small">Pictures are made smaller before sending and stay on this phone. To ask about one part, tap the box button on its thumbnail.</p>
    </Sheet>
  );
}

/** The pictures to send, above the question box: remove one, or draw a box over the part you mean. */
export function AttachedRow({ list, preparing, onRemove, onPart }: { list: Attached[]; preparing: number; onRemove: (key: string) => void; onPart: (key: string) => void }) {
  const labels = attachedLabels(list);
  return (
    <div className="attached" role="group" aria-label="Pictures to send">
      {list.map((a) => (
        <figure key={a.key} className={`att ${a.partOf ? "part" : ""}`}>
          <img src={a.url} alt={labels.get(a.key)} />
          {a.partOf && (
            <span className="att-part" aria-hidden>
              <Icon name="crop" size={11} />
            </span>
          )}
          <button type="button" className="btn icon att-btn att-x" aria-label={`Remove ${labels.get(a.key)}`} onClick={() => onRemove(a.key)}>
            <Icon name="close" size={14} />
          </button>
          {!a.partOf && (
            <button type="button" className="btn icon att-btn att-crop" aria-label={`Ask about a part of ${labels.get(a.key)}`} onClick={() => onPart(a.key)}>
              <Icon name="crop" size={14} />
            </button>
          )}
        </figure>
      ))}
      {Array.from({ length: preparing }, (_, i) => (
        <span key={`wait${i}`} className="att wait pulse" role="status" aria-label="Preparing a picture" />
      ))}
    </div>
  );
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Draw a box over a part of a picture; that part is sent along with the whole picture. */
export function ImageRegion({ src, onDone, onClose }: { src: string; onDone: (box: Box) => void; onClose: () => void }) {
  const img = useRef<HTMLImageElement>(null);
  const from = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<Box>();
  // measured on the picture itself (it keeps its proportions, so its box is exactly the picture)
  const at = (e: PointerEvent) => {
    const r = img.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const el = img.current;
  const big = !!box && box.w > 0.02 && box.h > 0.02;
  return (
    <Sheet title="Ask about a part" onClose={onClose}>
      <p className="muted small">Draw a box over the part you mean.</p>
      <div
        className="region"
        aria-label="Picture: draw a box"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture?.(e.pointerId);
          from.current = at(e);
          setBox(undefined);
        }}
        onPointerMove={(e) => {
          const a = from.current;
          if (!a) return;
          const b = at(e);
          setBox({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
        }}
        onPointerUp={() => (from.current = null)}
        onPointerCancel={() => (from.current = null)}
      >
        <img ref={img} src={src} alt="" draggable={false} />
        {box && el && (
          <div
            className="region-box"
            style={{ left: el.offsetLeft + box.x * el.offsetWidth, top: el.offsetTop + box.y * el.offsetHeight, width: box.w * el.offsetWidth, height: box.h * el.offsetHeight }}
          />
        )}
      </div>
      <div className="region-actions">
        <button className="btn" disabled={!box} onClick={() => setBox(undefined)}>Clear</button>
        <button className="btn primary grow" disabled={!big} onClick={() => box && onDone(box)}>Use this part</button>
      </div>
    </Sheet>
  );
}
