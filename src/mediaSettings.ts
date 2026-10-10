/**
 * Image and video settings built from OpenRouter's own metadata, never hardcoded:
 * - image models: `supported_parameters` maps each request field to a typed descriptor
 *   (an enum with its values, a numeric range with min/max, or a boolean), at model level and per endpoint;
 * - video models: `supported_durations`, `supported_resolutions`, `supported_aspect_ratios`,
 *   `supported_sizes` (optional) and `pricing_skus`.
 * The exact shapes vary between examples in the docs, so everything here is parsed tolerantly.
 */

export type MediaControl =
  | { key: string; kind: "choice"; options: (string | number)[] }
  | { key: string; kind: "range"; min: number; max: number; step: number }
  | { key: string; kind: "toggle" };

/** Fields the app sets itself (or that cost money without helping a slide). */
const IMAGE_SKIP = new Set(["model", "prompt", "n", "seed", "input_references", "stream", "user", "provider"]);

const num = (x: unknown): number | undefined => {
  const n = typeof x === "string" ? Number(x) : x;
  return typeof n === "number" && isFinite(n) ? n : undefined;
};

function descriptorEntries(params: unknown): [string, unknown][] {
  if (!params) return [];
  if (Array.isArray(params)) {
    return params.map((p): [string, unknown] =>
      typeof p === "string" ? [p, true] : [String((p as any)?.name ?? (p as any)?.key ?? (p as any)?.parameter ?? ""), p],
    ).filter(([k]) => !!k);
  }
  if (typeof params === "object") return Object.entries(params as Record<string, unknown>);
  return [];
}

/** One descriptor to a control, or undefined when it can't be shown as a setting. */
export function descriptorControl(key: string, d: unknown): MediaControl | undefined {
  if (Array.isArray(d)) return d.length ? { key, kind: "choice", options: d as (string | number)[] } : undefined;
  if (!d || typeof d !== "object") return undefined;
  const o = d as Record<string, any>;
  const values = o.values ?? o.enum ?? o.options ?? o.supported_values ?? o.allowed_values;
  if (Array.isArray(values) && values.length) return { key, kind: "choice", options: values };
  const min = num(o.min ?? o.minimum);
  const max = num(o.max ?? o.maximum);
  if (min !== undefined && max !== undefined && max > min) {
    const int = o.type === "integer" || (Number.isInteger(min) && Number.isInteger(max) && o.type !== "number");
    return { key, kind: "range", min, max, step: num(o.step) ?? (int ? 1 : (max - min) / 20) };
  }
  if (o.type === "boolean") return { key, kind: "toggle" };
  return undefined;
}

/** Settings for an image model: the endpoint's own descriptors when known, else the model-level union. */
export function imageControls(modelParams: unknown, endpointParams?: unknown): MediaControl[] {
  const src = endpointParams && descriptorEntries(endpointParams).length ? endpointParams : modelParams;
  return descriptorEntries(src)
    .filter(([k]) => !IMAGE_SKIP.has(k))
    .map(([k, d]) => descriptorControl(k, d))
    .filter((c): c is MediaControl => !!c);
}

/** How many reference images a model accepts (0 when it takes none). */
export function maxReferences(params: unknown): number {
  const d = descriptorEntries(params).find(([k]) => k === "input_references")?.[1];
  if (!d) return 0;
  if (d === true) return 1;
  return num((d as any)?.max ?? (d as any)?.maximum) ?? 1;
}

export interface VideoModel {
  id: string;
  name?: string;
  supported_durations?: number[] | null;
  supported_resolutions?: string[] | null;
  supported_aspect_ratios?: string[] | null;
  supported_sizes?: string[] | null;
  generate_audio?: boolean | null;
  pricing_skus?: Record<string, string | number> | null;
  allowed_passthrough_parameters?: string[] | null;
}

export function videoControls(m: VideoModel): MediaControl[] {
  const out: MediaControl[] = [];
  const choice = (key: string, xs?: (string | number)[] | null) => xs?.length && out.push({ key, kind: "choice", options: xs });
  choice("duration", m.supported_durations);
  choice("resolution", m.supported_resolutions);
  choice("aspect_ratio", m.supported_aspect_ratios);
  // `size` is interchangeable with resolution + aspect ratio: offer it only when they aren't
  if (!m.supported_resolutions?.length && !m.supported_aspect_ratios?.length) choice("size", m.supported_sizes);
  return out;
}

/** The supported duration closest to `target` seconds (5 s: long enough for a slide, cheap enough). */
export function preferredDuration(durations: number[] | null | undefined, target = 5): number | undefined {
  if (!durations?.length) return undefined;
  return [...durations].sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)[0];
}

/** Defaults for a set of controls: keep valid saved values, else the first option / the minimum / off. */
export function defaultsFor(controls: MediaControl[], saved: Record<string, unknown> = {}, prefer: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of controls) {
    const v = saved[c.key] ?? prefer[c.key];
    if (c.kind === "choice") out[c.key] = c.options.includes(v as never) ? v : c.options[0];
    else if (c.kind === "range") out[c.key] = typeof v === "number" && v >= c.min && v <= c.max ? v : c.min;
    else out[c.key] = typeof v === "boolean" ? v : false;
  }
  return out;
}

/** Only the parameters this model/endpoint accepts. */
export function requestParams(controls: MediaControl[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of controls) if (values[c.key] !== undefined) out[c.key] = values[c.key];
  return out;
}

export interface PriceRange {
  min: number;
  max: number;
  /** what the estimate is based on */
  basis: string;
  /** the cost can't be known in advance (token pricing) */
  unknown?: boolean;
}

/** One billable line of an image endpoint: `{billable, unit, cost_usd, variant?}` (older shapes are read too). */
export interface PriceLine {
  billable: string;
  unit: string;
  cost: number;
  variant?: string;
}

export function pricingLines(pricing: unknown): PriceLine[] {
  const out: PriceLine[] = [];
  if (Array.isArray(pricing)) {
    for (const p of pricing as any[]) {
      const cost = num(p?.cost_usd ?? p?.price ?? p?.amount ?? p?.cost);
      if (cost === undefined) continue;
      const unit = String(p?.unit ?? "image").toLowerCase();
      out.push({ billable: String(p?.billable ?? "output_image").toLowerCase(), unit, cost, variant: p?.variant ? String(p.variant).toLowerCase() : undefined });
    }
  } else if (pricing && typeof pricing === "object") {
    // an older map like { image: "0.04" }
    for (const [k, x] of Object.entries(pricing as Record<string, unknown>)) {
      const cost = num(x);
      if (cost === undefined || cost <= 0) continue;
      const key = k.toLowerCase();
      if (/megapixel|\bmp\b/.test(key)) out.push({ billable: "output_image", unit: "megapixel", cost });
      else if (/image|request|generation|per_unit/.test(key)) out.push({ billable: "output_image", unit: "image", cost });
    }
  }
  return out;
}

/** Approximate megapixels of a resolution tier (the docs' tiers: 512, 768, 1K, 1.5K, 2K, 4K). */
export function tierMegapixels(resolution: unknown): number {
  const r = String(resolution ?? "1K").trim().toLowerCase();
  const k = r.match(/^([\d.]+)\s*k$/);
  const side = k ? Number(k[1]) * 1024 : Number(r);
  return isFinite(side) && side > 0 ? +((side * side) / 1e6).toFixed(2) : 1.05;
}

/**
 * Estimated cost of one image from an endpoint's pricing lines: output-image lines (per image or per
 * megapixel, with resolution-tiered `variant` lines matched to the chosen resolution), plus reference
 * images when some are sent. Token-priced endpoints can't be known in advance.
 */
export function estimateImagePrice(pricing: unknown, params: Record<string, unknown> = {}, references = 0): PriceRange | undefined {
  const lines = pricingLines(pricing);
  const res = String(params.resolution ?? params.size ?? "").toLowerCase();
  const pick = (billable: string) => {
    const all = lines.filter((l) => l.billable === billable);
    const tiered = all.filter((l) => l.variant && l.variant === res);
    return tiered.length ? tiered : all.filter((l) => !l.variant).length ? all.filter((l) => !l.variant) : all;
  };
  const out = pick("output_image");
  if (!out.length) return undefined;
  if (out.every((l) => l.unit === "token")) return { min: 0, max: 0, basis: "per token", unknown: true };
  const mp = tierMegapixels(params.resolution ?? params.size);
  const cost = (l: PriceLine) => (l.unit === "megapixel" ? l.cost * mp : l.unit === "token" ? NaN : l.cost);
  const outCosts = out.map(cost).filter((x) => isFinite(x));
  const refCosts = references > 0 ? pick("input_reference").map((l) => (l.unit === "megapixel" ? l.cost * 1 : l.cost) * references).filter((x) => isFinite(x)) : [];
  const refMin = refCosts.length ? Math.min(...refCosts) : 0;
  const refMax = refCosts.length ? Math.max(...refCosts) : 0;
  const basis = [
    out.some((l) => l.unit === "megapixel") ? `per megapixel × ~${mp} MP` : "per image",
    refCosts.length ? `+ ${references} reference image${references > 1 ? "s" : ""}` : "",
  ].filter(Boolean).join(" ");
  return { min: Math.min(...outCosts) + refMin, max: Math.max(...outCosts) + refMax, basis };
}

/**
 * Estimated cost of one clip from `pricing_skus` × duration. SKU names vary (per-video-second,
 * per-video-second-1080p, …), so they're matched by resolution and audio; otherwise a range is shown.
 */
export function estimateVideoPrice(skus: Record<string, string | number> | null | undefined, opts: { duration?: number; resolution?: string; audio?: boolean }): PriceRange | undefined {
  if (!skus) return undefined;
  const entries = Object.entries(skus)
    .map(([k, v]) => [k.toLowerCase(), num(v)] as const)
    .filter((e): e is readonly [string, number] => e[1] !== undefined && e[1] > 0);
  if (!entries.length) return undefined;
  const secs = opts.duration ?? 5;
  const perSecond = entries.filter(([k]) => /second|\bsec\b|per_s\b/.test(k));
  if (perSecond.length) {
    const res = opts.resolution?.toLowerCase();
    const mentionsRes = (k: string) => /\d{3,4}p|\dk\b/.test(k);
    const silent = (k: string) => /no[-_]?audio|without[-_]?audio|silent/.test(k);
    const withAudio = (k: string) => /audio/.test(k) && !silent(k);
    let pick = perSecond.filter(([k]) => (res && k.includes(res)) || (!mentionsRes(k) && !(res && perSecond.some(([x]) => x.includes(res)))));
    if (opts.audio !== undefined) {
      // either "…-no-audio" SKUs (the plain one then includes audio) or "…-audio" SKUs (the plain one is silent)
      const audible = pick.some(([k]) => silent(k)) ? (k: string) => !silent(k) : withAudio;
      if (pick.some(([k]) => audible(k)) && pick.some(([k]) => !audible(k))) pick = pick.filter(([k]) => audible(k) === opts.audio);
    }
    if (pick.length === 1) return { min: pick[0][1] * secs, max: pick[0][1] * secs, basis: `${pick[0][0]} × ${secs} s` };
    const vals = (pick.length ? pick : perSecond).map(([, v]) => v * secs);
    return { min: Math.min(...vals), max: Math.max(...vals), basis: `per second × ${secs} s (range, see details)` };
  }
  const vals = entries.map(([, v]) => v);
  return { min: Math.min(...vals), max: Math.max(...vals), basis: vals.length > 1 ? "per clip (range, see details)" : "per clip" };
}

export const formatPrice = (p?: PriceRange) => {
  if (!p) return "price unknown";
  if (p.unknown) return "known when done (priced per token)";
  const f = (x: number) => (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);
  return p.min === p.max ? `about ${f(p.min)}` : `${f(p.min)}–${f(p.max)}`;
};

export type VideoStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired";

/** What to do with a polled video job. */
export function videoPhase(status: string | undefined): "wait" | "done" | "failed" {
  if (status === "completed") return "done";
  if (status === "failed" || status === "cancelled" || status === "expired") return "failed";
  return "wait";
}

/** Read the supported values out of a 400 message like "duration must be one of: 5, 8". */
export function supportedFromError(message: string): { key: string; values: string[] } | undefined {
  const m = message.match(/\b(duration|resolution|aspect_ratio|size)\b[^\n]*?(?:one of|supported(?: values)?(?: are)?)[:\s]+\[?([^\]\n]+)/i);
  if (!m) return undefined;
  const values = m[2].split(/[,|]/).map((x) => x.trim().replace(/^["']|["'.]$/g, "")).filter(Boolean);
  return values.length ? { key: m[1].toLowerCase(), values } : undefined;
}
