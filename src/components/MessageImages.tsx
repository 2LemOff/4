import { useEffect, useMemo, useState } from "react";
import { db } from "../db";
import { readImageText } from "../photos";
import { useLive } from "../store";
import type { Card } from "../types";
import { AnswerText, type AnswerMark } from "./AnswerText";
import { ImageRegion, type Box } from "./Attachments";
import { clock } from "../videoCost";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

/** The object URL of a stored picture (let go when no longer shown). */
function useMediaUrl(id: string): { url?: string; missing: boolean } {
  const rec = useLive(async () => (await db.media.get(id)) ?? null, [id]);
  const url = useMemo(() => (rec ? URL.createObjectURL(rec.blob) : undefined), [rec]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return { url, missing: rec === null };
}

function MediaImage({ id, alt }: { id: string; alt: string }) {
  const { url, missing } = useMediaUrl(id);
  if (url) return <img src={url} alt={alt} />;
  return <span className="img-missing small muted" role="img" aria-label={alt}>{missing ? "Deleted" : ""}</span>;
}

const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);

/** The pictures and videos sent with a question, as thumbnails (tap one to see it whole), and "Read the text". */
export function MessageThumbs({ card, onOpen, onVideo }: { card: Card; onOpen: (i: number) => void; onVideo: (i: number) => void }) {
  const imgs = card.images ?? [];
  const unread = imgs.flatMap((im, i) => (!im.text && im.textStatus !== "running" ? [i] : []));
  return (
    <>
      <div className="msg-images">
        {imgs.map((im, i) => (
          <button key={i} className={`msg-thumb ${im.partOf !== undefined ? "part" : ""}`} aria-label={`Open ${lower(im.label)}`} onClick={() => onOpen(i)}>
            <MediaImage id={im.mediaId} alt={im.label} />
          </button>
        ))}
        {(card.videos ?? []).map((v, i) => (
          <button key={`v${i}`} className="msg-thumb video" aria-label={`Play ${lower(v.label)}`} onClick={() => onVideo(i)}>
            {v.frames?.[0] ? <MediaImage id={v.frames[0]} alt={v.label} /> : <span className="img-missing small muted">link</span>}
            <span className="att-dur">
              <Icon name="play" size={10} /> {v.link ? "link" : clock(v.seconds)}
            </span>
          </button>
        ))}
      </div>
      {unread.length > 0 && card.status !== "streaming" && (
        <button className="btn chip small-chip" onClick={() => unread.forEach((i) => void readImageText(card.id, i))}>
          <Icon name="text" size={13} /> {unread.length > 1 ? "Read the text in them" : "Read the text"}
        </button>
      )}
    </>
  );
}

/**
 * The text read from each picture of a question. It can be highlighted like an answer: each picture's text is
 * its own part ("img0"), so highlights there are measured in that text.
 */
export function ImageTexts({ card, marks }: { card: Card; marks: (part: string) => AnswerMark[] }) {
  const imgs = card.images ?? [];
  if (!imgs.some((im) => im.text || im.textStatus === "running" || im.textStatus === "error")) return null;
  return (
    <div className="img-texts">
      {imgs.map((im, i) =>
        im.text ? (
          <details key={i} className="img-text" open>
            <summary className="small muted">Text in {lower(im.label)}</summary>
            <AnswerText cardId={card.id} part={`img${i}`} markdown={im.text} marks={marks(`img${i}`)} selectable />
          </details>
        ) : im.textStatus === "running" ? (
          <p key={i} className="small muted pulse" role="status">Reading the text in {lower(im.label)}…</p>
        ) : im.textStatus === "error" ? (
          <p key={i} className="small error" role="alert">
            Couldn't read {lower(im.label)}: {im.textError}{" "}
            <button className="btn chip small-chip" onClick={() => void readImageText(card.id, i)}>Try again</button>
          </p>
        ) : null,
      )}
    </div>
  );
}

/** One sent picture, whole: read its text, or ask about a part of it (it's sent again with that part). */
export function PictureSheet({ card, i, onPart, onClose }: { card: Card; i: number; onPart: (blob: Blob, box: Box) => void; onClose: () => void }) {
  const im = card.images?.[i];
  const { url } = useMediaUrl(im?.mediaId ?? "");
  const [drawing, setDrawing] = useState(false);
  if (!im) return null;
  if (drawing && url)
    return (
      <ImageRegion
        src={url}
        onDone={async (box) => {
          const rec = await db.media.get(im.mediaId);
          if (rec) onPart(rec.blob, box);
          onClose();
        }}
        onClose={() => setDrawing(false)}
      />
    );
  return (
    <Sheet title={im.label} onClose={onClose}>
      <figure className="picture-full">{url ? <img src={url} alt={im.label} /> : <span className="muted small">This picture was deleted.</span>}</figure>
      <button className="row-btn" disabled={!url} onClick={() => setDrawing(true)}>
        <span className="row-line"><Icon name="crop" size={16} /> Ask about a part of it</span>
      </button>
      <button className="row-btn" disabled={!url || im.textStatus === "running"} onClick={() => void readImageText(card.id, i)}>
        <span className="row-line"><Icon name="text" size={16} /> {im.text ? "Read the text again" : "Read the text in it"}</span>
      </button>
      <p className="muted small">The text read from a picture can be highlighted and asked about like an answer.</p>
    </Sheet>
  );
}

/** A sent video, played on the phone (or its link opened). */
export function VideoSheet({ card, i, onClose }: { card: Card; i: number; onClose: () => void }) {
  const v = card.videos?.[i];
  const { url, missing } = useMediaUrl(v?.mediaId ?? "");
  if (!v) return null;
  return (
    <Sheet title={v.label} onClose={onClose}>
      {v.link ? (
        <p>
          <a href={v.link} target="_blank" rel="noopener noreferrer">{v.link}</a>
        </p>
      ) : url ? (
        <video className="video-full" src={url} controls playsInline aria-label={v.label} />
      ) : (
        <p className="muted small">{missing ? "This video was deleted (Settings › Storage)." : "Loading…"}</p>
      )}
      <p className="muted small">
        {v.seconds ? `${clock(v.seconds)} long. ` : ""}Models that can watch videos get the whole clip{v.frames?.length ? `; others see ${v.frames.length} still frame${v.frames.length > 1 ? "s" : ""}` : ""}.
      </p>
    </Sheet>
  );
}
