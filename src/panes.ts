/**
 * Pure geometry for showing a branch beside the original: where the split goes, keeping words in view when the
 * keyboard takes space, and keeping the bubble on screen. Everything is in CSS pixels.
 */

export type BranchMode = "split" | "bubble" | "layer";
export const BRANCH_MODES: BranchMode[] = ["split", "bubble", "layer"];

/**
 * Height of the original's pane in the split: it ends just under the paragraph that was asked about, so that text
 * doesn't move. A paragraph too low on the screen is scrolled up just enough (`scrollBy`).
 */
export function splitHeight(o: { paneHeight: number; blockBottom: number; min?: number; max?: number; gap?: number }): { height: number; scrollBy: number } {
  const min = Math.round(o.paneHeight * (o.min ?? 0.3));
  const max = Math.round(o.paneHeight * (o.max ?? 0.66));
  const want = Math.round(o.blockBottom + (o.gap ?? 10));
  if (want <= min) return { height: min, scrollBy: 0 };
  if (want <= max) return { height: want, scrollBy: 0 };
  return { height: max, scrollBy: want - max };
}

/**
 * How far to scroll a pane so an element stays visible after the pane got shorter (or 0 when it already is).
 * `top`/`bottom` are the element's edges measured from the pane's top edge.
 */
export function keepInView(o: { top: number; bottom: number; paneHeight: number; margin?: number }): number {
  const m = o.margin ?? 12;
  if (o.bottom > o.paneHeight - m) {
    // a tall element: keep its top in view rather than its bottom
    const by = o.bottom - o.paneHeight + m;
    return Math.min(by, Math.max(0, o.top - m));
  }
  if (o.top < 0) return o.top - m;
  return 0;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const BUBBLE_MIN = { w: 200, h: 150 };

/** The bubble kept inside the screen (shrunk first if the screen got smaller, e.g. with the keyboard up). */
export function clampRect(r: Rect, bounds: { w: number; h: number }, min = BUBBLE_MIN): Rect {
  const w = Math.max(Math.min(min.w, bounds.w), Math.min(r.w, bounds.w));
  const h = Math.max(Math.min(min.h, bounds.h), Math.min(r.h, bounds.h));
  return { w, h, x: Math.min(Math.max(0, r.x), bounds.w - w), y: Math.min(Math.max(0, r.y), bounds.h - h) };
}

/** Preset sizes (fractions of the screen) for the bubble's S / M / L buttons. */
export const BUBBLE_SIZES = { S: { w: 0.62, h: 0.3 }, M: { w: 0.86, h: 0.45 }, L: { w: 0.96, h: 0.68 } } as const;
export type BubbleSize = keyof typeof BUBBLE_SIZES;

export function bubblePreset(size: BubbleSize, bounds: { w: number; h: number }, at: "top" | "bottom" | { x: number; y: number } = "bottom"): Rect {
  const w = Math.round(bounds.w * BUBBLE_SIZES[size].w);
  const h = Math.round(bounds.h * BUBBLE_SIZES[size].h);
  const pos = at === "top" ? { x: (bounds.w - w) / 2, y: 8 } : at === "bottom" ? { x: (bounds.w - w) / 2, y: bounds.h - h - 8 } : at;
  return clampRect({ x: Math.round(pos.x), y: Math.round(pos.y), w, h }, bounds);
}

/** See-through levels of the bubble and the layer: how much of the background is opaque. */
export const SEE_THROUGH = [1, 0.7, 0.4] as const;
