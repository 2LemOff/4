/**
 * What a video sent with a question costs. Models bill video as input tokens; Google's Gemini models count about
 * 70 tokens per frame at one frame a second plus 32 tokens a second of sound (Gemini 3 and newer), and older
 * Gemini models about 263 + 32 tokens a second. Other models are estimated at 300 tokens a second. A model that
 * sees pictures but not video gets still frames instead (about 800 tokens each, or its per-image price).
 */
import type { ModelInfo } from "./types";

export const seesVideo = (m: ModelInfo) => !!m.architecture?.input_modalities?.includes("video");

/** Video tokens a second for a model (an estimate for models that don't publish it). */
export function videoTokensPerSecond(modelId: string): number {
  const g = modelId.replace(/^~/, "").match(/^google\/gemini-(\d+)/);
  if (g) return Number(g[1]) >= 3 ? 70 + 32 : 263 + 32;
  return 300;
}

export const FRAME_TOKENS = 800;

const perToken = (m: ModelInfo) => {
  const p = Number(m.pricing?.prompt);
  return isFinite(p) && p >= 0 ? p : undefined;
};

export interface MediaCost {
  tokens: number;
  usd?: number;
  /** how the model receives it */
  as: "video" | "frames" | "none";
}

/** Cost of sending one video of `seconds` (and its `frames` stills) to a model. */
export function videoCost(m: ModelInfo, seconds: number | undefined, frames: number, seesPictures: boolean): MediaCost {
  if (seesVideo(m)) {
    const tokens = seconds ? Math.ceil(seconds * videoTokensPerSecond(m.id)) : 0;
    const p = perToken(m);
    return { tokens, usd: seconds && p !== undefined ? tokens * p : undefined, as: "video" };
  }
  if (seesPictures && frames > 0) {
    const img = Number(m.pricing?.image);
    const tokens = frames * FRAME_TOKENS;
    const p = perToken(m);
    const usd = isFinite(img) && img > 0 ? frames * img : p !== undefined ? tokens * p : undefined;
    return { tokens, usd, as: "frames" };
  }
  return { tokens: 0, usd: 0, as: "none" };
}

const money = (x: number) => (x === 0 ? "$0" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);
const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

/** "≈ 306 tokens · ≈ $0.0006" (or why there's no estimate). */
export function costLabel(c: MediaCost, seconds: number | undefined): string {
  if (c.as === "none") return "this model can't see it";
  if (c.as === "video" && !seconds) return "billed by its length (shown after the answer)";
  const what = c.as === "frames" ? "as still frames, " : "";
  return `${what}≈ ${tok(c.tokens)} tokens${c.usd !== undefined ? ` · ≈ ${money(c.usd)}` : ""}`;
}

/** "0:07", "12:03". */
export const clock = (s: number | undefined) => (s === undefined || !isFinite(s) ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

/** Videos over this size can't be sent from the phone (the request carries the whole file). */
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

/** Total for several videos, with one label ("≈ 1.2k tokens · ≈ $0.0024"). */
export function videosCostLabel(m: ModelInfo, list: { seconds?: number; frames: number }[], seesPictures: boolean): string {
  const each = list.map((v) => ({ v, c: videoCost(m, v.seconds, v.frames, seesPictures) }));
  if (each.some(({ c }) => c.as === "none")) return "can't see videos";
  if (each.some(({ v, c }) => c.as === "video" && !v.seconds)) return "video billed by its length";
  const tokens = each.reduce((n, { c }) => n + c.tokens, 0);
  const usd = each.every(({ c }) => c.usd !== undefined) ? each.reduce((n, { c }) => n + (c.usd ?? 0), 0) : undefined;
  return costLabel({ tokens, usd, as: each.some(({ c }) => c.as === "frames") ? "frames" : "video" }, 1);
}
