import { describe, expect, it } from "vitest";
import { effortAlong, planEffort } from "../src/effort";
import { card } from "./fixtures";

describe("effort planning", () => {
  const root = card({ id: "r", effortUsed: "medium" });
  const c1 = card({ id: "c1", parentId: "r", configUpdate: { effort: "low" }, effortUsed: "low" });
  it("follows stored updates along a path", () => {
    expect(effortAlong([root])).toBe("medium");
    expect(effortAlong([root, c1])).toBe("low");
    expect(effortAlong([root, card({ id: "c2", parentId: "r" })])).toBe("medium");
  });
  it("sends effort at request level when updates are unsupported, there is no parent, or it is not effort mode", () => {
    expect(planEffort({ canUpdate: false, parentPath: [root], next: "high", kind: "effort" })).toEqual({ mode: "request" });
    expect(planEffort({ canUpdate: true, parentPath: [], next: "high", kind: "effort" })).toEqual({ mode: "request" });
    expect(planEffort({ canUpdate: true, parentPath: [root], next: undefined, kind: "default" })).toEqual({ mode: "request" });
    expect(planEffort({ canUpdate: true, parentPath: [root], next: "high", kind: "budget" })).toEqual({ mode: "request" });
  });
  it("keeps the baseline and emits an update only when the effort changes", () => {
    expect(planEffort({ canUpdate: true, parentPath: [root], next: "high", kind: "effort" })).toEqual({ mode: "update", baseline: "medium", update: { effort: "high" } });
    expect(planEffort({ canUpdate: true, parentPath: [root], next: "medium", kind: "effort" })).toEqual({ mode: "update", baseline: "medium", update: undefined });
    expect(planEffort({ canUpdate: true, parentPath: [root, c1], next: "low", kind: "effort" })).toEqual({ mode: "update", baseline: "medium", update: undefined });
  });
});
