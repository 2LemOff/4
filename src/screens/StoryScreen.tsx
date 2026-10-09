import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../db";
import { drawSlide, narrateSlide, runStory } from "../stories";
import { STORY_STYLES, svgDataUri, type StyleId } from "../storyStyles";
import { go, hrefMap } from "../route";
import { settingsStore, updateSettings, useLive, useStore } from "../store";
import { Icon } from "../components/Icon";
import type { PictureType, StorySlide } from "../storyTypes";
import { imageSetup, imageSlide, loadMediaModels, mediaStore, setPicture, videoSetup, videoSlide } from "../media";
import { formatPrice } from "../mediaSettings";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

/** Rough reading time when there's no narration audio: ~2.6 words per second. */
const readMs = (s: StorySlide, rate: number) => Math.max(3000, ((s.narration.split(/\s+/).length / 2.6) * 1000) / rate);

const sentences = (t: string) => t.match(/[^.!?]+[.!?]*["”’)]*\s*/g)?.map((x) => x.trim()).filter(Boolean) ?? [t];

export function StoryScreen({ id }: { id: string }) {
  const story = useLive(() => db.stories.get(id), [id]);
  const { story: cfg } = useStore(settingsStore);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const slide = story?.slides[i];

  const media = useStore(mediaStore);
  const picBlob = useLive(async () => {
    const mid = slide?.picture === "image" ? slide.imageId : slide?.picture === "video" ? slide.videoId : undefined;
    return mid ? (await db.media.get(mid))?.blob : undefined;
  }, [slide?.picture, slide?.imageId, slide?.videoId]);
  const picUrl = useMemo(() => (picBlob ? URL.createObjectURL(picBlob) : undefined), [picBlob]);
  useEffect(() => () => void (picUrl && URL.revokeObjectURL(picUrl)), [picUrl]);
  useEffect(() => {
    if (slide && slide.picture !== "shapes") void loadMediaModels();
  }, [slide?.picture]);

  const audioBlob = useLive(async () => (slide?.audioId ? (await db.media.get(slide.audioId))?.blob : undefined), [slide?.audioId]);
  const audioUrl = useMemo(() => (audioBlob ? URL.createObjectURL(audioBlob) : undefined), [audioBlob]);
  useEffect(() => () => void (audioUrl && URL.revokeObjectURL(audioUrl)), [audioUrl]);

  const rate = cfg.playbackRate || 1;
  const last = (story?.slides.length ?? 1) - 1;

  const advance = () => {
    if (i < last && cfg.autoplay) setI(i + 1);
    else setPlaying(false);
  };

  // narration: play the slide's audio, or fall back to a reading-time timer
  useEffect(() => {
    const a = audio.current;
    if (!a || !slide) return;
    a.playbackRate = rate;
    if (!playing) {
      a.pause();
      return;
    }
    let timer: number | undefined;
    const fallback = () => (timer = window.setTimeout(advance, readMs(slide, rate)));
    if (audioUrl) a.play().catch(fallback);
    else fallback();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, i, audioUrl]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate]);

  if (story === undefined) return <div className="center muted">Loading…</div>;
  if (!story) {
    return (
      <div className="center">
        <p>This story no longer exists.</p>
        <a className="btn" href="#/">Home</a>
      </div>
    );
  }

  const back = () => go(hrefMap(story.sessionId, { focus: story.cardId }));
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length] ?? 1;
    updateSettings((s) => ({ story: { ...s.story, playbackRate: next } }));
  };
  const goTo = (n: number) => {
    audio.current?.pause();
    if (audio.current) audio.current.currentTime = 0;
    setI(Math.max(0, Math.min(last, n)));
  };

  const head = (
    <div className="topbar">
      <button className="btn icon sm" aria-label="Back to the map" onClick={back}><Icon name="prev" /></button>
      <strong className="grow ellipsis">{story.title || "Story"}</strong>
      <span className="muted small">{STORY_STYLES[story.style as StyleId]?.label ?? story.style}</span>
    </div>
  );

  if (!story.slides.length) {
    return (
      <>
        {head}
        <div className="center">
          {story.status === "error" ? (
            <>
              <p className="error">{story.error}</p>
              <button className="btn primary" onClick={() => runStory(story.id)}>Try again</button>
            </>
          ) : (
            <p className="muted" role="status">Writing the story…</p>
          )}
        </div>
      </>
    );
  }

  const s = slide!;
  const busy = (st: string) => st === "running" || (st === "pending" && story.status === "running");
  const has = { shapes: !!s.svg, image: !!s.imageId, video: !!(s.videoId || s.videoUrl) } as Record<PictureType, boolean>;
  const pictureMissing = !has[s.picture] && !busy(s.pictureStatus);
  void media; // re-render when model metadata arrives (prices)
  const img = imageSetup();
  const vid = videoSetup();
  const makeVideo = () => {
    const secs = vid.values.duration ? `${vid.values.duration}s ` : "";
    if (confirm(`Make a ${secs}video for this slide with ${vid.model.split("/").pop()}? Estimated cost: ${formatPrice(vid.price)}.`)) void videoSlide(story.id, i);
  };
  const regenerate = () => (s.picture === "image" ? imageSlide(story.id, i, true) : s.picture === "video" ? makeVideo() : drawSlide(story.id, i, true));
  const missingLabel =
    s.picture === "image" ? `Generate AI image · ${formatPrice(img.price)}` : s.picture === "video" ? `Generate video · ${formatPrice(vid.price)}` : "Regenerate picture";
  const working = busy(s.pictureStatus) || (s.picture === "video" && !!s.videoJob);
  const waitText = s.picture === "video" ? `Making the video${s.videoJob ? ` (${s.videoJob.status.replace("_", " ")})` : ""}… You can leave; it continues later.` : s.picture === "image" ? "Painting the image…" : "Drawing the picture…";
  const voiceMissing = !s.audioId && !busy(s.audioStatus);

  return (
    <>
      {head}
      <div className="story scroll">
        <figure className="story-pic">
          {s.picture === "video" && has.video && !working ? (
            <video key={picUrl ?? s.videoUrl} src={picUrl ?? s.videoUrl} muted={!cfg.videoSound} loop autoPlay playsInline aria-label={s.visual} />
          ) : s.picture === "image" && picUrl && !working ? (
            <img key={picUrl} className={playing ? "kb" : "kb paused"} src={picUrl} alt={s.visual} />
          ) : s.picture === "shapes" && s.svg && !working ? (
            <img key={`${i}-${s.svg.length}`} className={playing ? "kb" : "kb paused"} src={svgDataUri(s.svg)} alt={s.visual} />
          ) : (
            <div className="story-placeholder muted small" role="status">
              {working ? waitText : s.pictureStatus === "error" && s.pictureError ? s.pictureError : "No picture yet."}
            </div>
          )}
        </figure>
        <div className="seg story-kind" role="group" aria-label="Picture type">
          {(["shapes", "image", "video"] as PictureType[]).map((k) => (
            <button key={k} className={s.picture === k ? "on" : ""} aria-pressed={s.picture === k} disabled={working} onClick={() => setPicture(story.id, i, k)}>
              {k === "shapes" ? "Shapes" : k === "image" ? "AI image" : "AI video"}
            </button>
          ))}
        </div>
        <p className="muted small story-count">
          Slide {i + 1} of {story.slides.length} · {s.heading}
        </p>
        <div className="story-caption" aria-label="Caption">
          {sentences(s.narration).map((t, k) => (
            <button key={k} className="caption-line" onClick={() => go(hrefMap(story.sessionId, { focus: story.cardId, quote: t }))}>
              {t}
            </button>
          ))}
        </div>
        <p className="muted small">Tap a sentence to ask about it.</p>
        {(pictureMissing || voiceMissing) && (
          <div className="chips">
            {pictureMissing && <button className="btn chip" onClick={regenerate}>{missingLabel}</button>}
            {voiceMissing && <button className="btn chip" onClick={() => narrateSlide(story.id, i, true)}>Regenerate narration</button>}
          </div>
        )}
        {s.audioError && !s.audioId && <p className="error small">{s.audioError}</p>}
        {!pictureMissing && !voiceMissing && (
          <details className="group">
            <summary className="small">Slide options</summary>
            <div className="chips">
              <button className="btn chip" disabled={working} onClick={regenerate}>{s.picture === "shapes" ? "Redraw picture" : s.picture === "image" ? "New AI image" : "New video"}</button>
              <button className="btn chip" disabled={busy(s.audioStatus)} onClick={() => narrateSlide(story.id, i, true)}>Record narration again</button>
            </div>
          </details>
        )}
      </div>
      <audio ref={audio} src={audioUrl} preload="auto" onEnded={advance} aria-label="Narration" />
      <div className="dock story-controls">
        <button className="btn icon" aria-label="Previous slide" disabled={i === 0} onClick={() => goTo(i - 1)}><Icon name="prev" /></button>
        <button className="btn icon primary" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)}>
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <button className="btn icon" aria-label="Next slide" disabled={i === last} onClick={() => goTo(i + 1)}><Icon name="next" /></button>
        <span className="grow" />
        <button className="btn chip" aria-label="Playback speed" onClick={cycleSpeed}>{rate}×</button>
      </div>
    </>
  );
}
