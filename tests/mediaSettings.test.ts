import { describe, expect, it } from "vitest";
import {
  defaultsFor,
  estimateImagePrice,
  estimateVideoPrice,
  formatPrice,
  imageControls,
  maxReferences,
  preferredDuration,
  pricingLines,
  requestParams,
  supportedFromError,
  videoControls,
  videoPhase,
} from "../src/mediaSettings";

const IMAGE_PARAMS = {
  aspect_ratio: { type: "enum", values: ["1:1", "16:9", "4:3"] },
  resolution: { type: "enum", values: ["1K", "2K", "4K"] },
  n: { type: "range", min: 1, max: 10 },
  input_references: { type: "range", min: 0, max: 14 },
  seed: { type: "boolean" },
  guidance: { type: "range", min: 1, max: 10 },
  background: { type: "enum", values: ["auto", "transparent", "opaque"] },
  mystery: { type: "object" },
};

describe("image controls", () => {
  it("turns enums into choices and ranges into sliders, hiding what the app sets or can't show", () => {
    const c = imageControls(IMAGE_PARAMS);
    expect(c.map((x) => x.key)).toEqual(["aspect_ratio", "resolution", "guidance", "background"]);
    expect(c[0]).toEqual({ key: "aspect_ratio", kind: "choice", options: ["1:1", "16:9", "4:3"] });
    expect(c[2]).toMatchObject({ kind: "range", min: 1, max: 10, step: 1 });
  });
  it("prefers the endpoint's own (stricter) descriptors", () => {
    const c = imageControls(IMAGE_PARAMS, { aspect_ratio: { type: "enum", values: ["1:1"] } });
    expect(c).toEqual([{ key: "aspect_ratio", kind: "choice", options: ["1:1"] }]);
  });
  it("accepts list-shaped descriptors and plain names", () => {
    const c = imageControls([{ name: "quality", enum: ["low", "high"] }, "seed", "style"]);
    expect(c).toEqual([{ key: "quality", kind: "choice", options: ["low", "high"] }]);
  });
  it("reads how many reference images are accepted", () => {
    expect(maxReferences(IMAGE_PARAMS)).toBe(14);
    expect(maxReferences({ aspect_ratio: {} })).toBe(0);
    expect(maxReferences(["input_references"])).toBe(1);
  });
});

describe("video controls", () => {
  const veo = {
    id: "google/veo-3.1",
    supported_durations: [4, 6, 8],
    supported_resolutions: ["720p", "1080p"],
    supported_aspect_ratios: ["16:9", "9:16"],
    supported_sizes: null,
    generate_audio: true,
    pricing_skus: { "per-video-second": "0.40", "per-video-second-1080p": "0.60", "per-video-second-no-audio": "0.20" },
  };
  it("builds choices from the model's supported lists and skips missing ones", () => {
    const c = videoControls(veo);
    expect(c.map((x) => x.key)).toEqual(["duration", "resolution", "aspect_ratio"]);
  });
  it("never offers size next to resolution or aspect ratio (they are interchangeable)", () => {
    expect(videoControls({ ...veo, supported_sizes: ["1280x720"] }).map((x) => x.key)).not.toContain("size");
    expect(videoControls({ id: "x", supported_sizes: ["1280x720", "1920x1080"] }).map((x) => x.key)).toEqual(["size"]);
  });
  it("defaults keep valid saved values only", () => {
    const c = videoControls(veo);
    expect(defaultsFor(c, { duration: 8, resolution: "4K" })).toEqual({ duration: 8, resolution: "720p", aspect_ratio: "16:9" });
    expect(requestParams(c, { duration: 8, nope: 1 })).toEqual({ duration: 8 });
  });
  it("starts at the supported duration closest to 5 seconds, not the shortest", () => {
    expect(preferredDuration([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(5);
    expect(preferredDuration([4, 6, 8])).toBe(4);
    expect(preferredDuration([8, 10])).toBe(8);
    expect(preferredDuration([])).toBeUndefined();
    expect(defaultsFor(videoControls({ id: "x", supported_durations: [1, 5, 10] }), {}, { duration: preferredDuration([1, 5, 10]) })).toEqual({ duration: 5 });
  });
  it("estimates price from pricing_skus by resolution, audio and duration", () => {
    expect(estimateVideoPrice(veo.pricing_skus, { duration: 8, resolution: "1080p" })).toMatchObject({ min: 4.8, max: 4.8 });
    expect(estimateVideoPrice(veo.pricing_skus, { duration: 8, resolution: "720p", audio: true })).toMatchObject({ min: 3.2, max: 3.2 });
    expect(estimateVideoPrice(veo.pricing_skus, { duration: 8, resolution: "720p", audio: false })).toMatchObject({ min: 1.6, max: 1.6 });
    expect(estimateVideoPrice({ generate: 0.9 }, { duration: 5 })).toMatchObject({ min: 0.9, basis: "per clip" });
    expect(estimateVideoPrice(null, {})).toBeUndefined();
    expect(formatPrice(estimateVideoPrice({ "per-video-second": 0.1028 }, { duration: 5 }))).toBe("about $0.51");
  });
  it("poll states", () => {
    expect(videoPhase("pending")).toBe("wait");
    expect(videoPhase("in_progress")).toBe("wait");
    expect(videoPhase("completed")).toBe("done");
    for (const s of ["failed", "cancelled", "expired"]) expect(videoPhase(s)).toBe("failed");
  });
  it("reads supported values out of a 400", () => {
    expect(supportedFromError("Invalid duration: must be one of: 5, 8")).toEqual({ key: "duration", values: ["5", "8"] });
    expect(supportedFromError("resolution not supported. Supported values: [720p, 1080p]")).toEqual({ key: "resolution", values: ["720p", "1080p"] });
    expect(supportedFromError("server error")).toBeUndefined();
  });
});

describe("image price", () => {
  it("reads the documented pricing lines (cost_usd per billable and unit)", () => {
    expect(pricingLines([{ billable: "output_image", unit: "image", cost_usd: 0.05 }])).toEqual([{ billable: "output_image", unit: "image", cost: 0.05, variant: undefined }]);
    expect(estimateImagePrice([{ billable: "output_image", unit: "image", cost_usd: 0.05 }])).toMatchObject({ min: 0.05, max: 0.05, basis: "per image" });
  });
  it("prices megapixels from the resolution tier", () => {
    const p = estimateImagePrice([{ billable: "output_image", unit: "megapixel", cost_usd: 0.03 }], { resolution: "2K" })!;
    expect(p.min).toBeCloseTo(0.03 * 4.19, 3);
    expect(estimateImagePrice([{ billable: "output_image", unit: "megapixel", cost_usd: 0.03 }], { resolution: "512" })!.min).toBeCloseTo(0.03 * 0.26, 3);
  });
  it("uses the variant line for the chosen resolution", () => {
    const tiers = [
      { billable: "output_image", unit: "image", cost_usd: 0.04, variant: "1k" },
      { billable: "output_image", unit: "image", cost_usd: 0.08, variant: "2k" },
      { billable: "output_image", unit: "image", cost_usd: 0.16, variant: "4k" },
    ];
    expect(estimateImagePrice(tiers, { resolution: "2K" })).toMatchObject({ min: 0.08, max: 0.08 });
    expect(estimateImagePrice(tiers, { resolution: "8K" })).toMatchObject({ min: 0.04, max: 0.16 });
  });
  it("adds reference images only when they are sent, and ignores input-image lines", () => {
    const lines = [
      { billable: "output_image", unit: "image", cost_usd: 0.04 },
      { billable: "input_reference", unit: "image", cost_usd: 0.01 },
      { billable: "input_image", unit: "image", cost_usd: 0.5 },
    ];
    expect(estimateImagePrice(lines, {}, 0)).toMatchObject({ min: 0.04, max: 0.04 });
    expect(estimateImagePrice(lines, {}, 2)).toMatchObject({ min: 0.06, max: 0.06, basis: "per image + 2 reference images" });
  });
  it("token pricing is known only when done; older maps still work", () => {
    const t = estimateImagePrice([{ billable: "output_image", unit: "token", cost_usd: 0.00003 }]);
    expect(t?.unknown).toBe(true);
    expect(formatPrice(t)).toBe("known when done (priced per token)");
    expect(estimateImagePrice({ image: "0.04" })).toMatchObject({ min: 0.04, basis: "per image" });
    expect(estimateImagePrice({ prompt: "0.000001", completion: "0.00003" })).toBeUndefined();
    expect(formatPrice(undefined)).toBe("price unknown");
  });
});
