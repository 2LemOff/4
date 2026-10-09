import { describe, expect, it } from "vitest";
import { hrefCard, hrefMap, parseRoute } from "../src/route";

describe("routes", () => {
  it("parses the main routes", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/library")).toEqual({ name: "library" });
    expect(parseRoute("#/outline/abc")).toEqual({ name: "outline", id: "abc" });
    expect(parseRoute("#/settings/storage")).toEqual({ name: "settings", section: "storage" });
  });
  it("parses the map with focus, node and view", () => {
    expect(parseRoute("#/s/s1")).toEqual({ name: "map", sid: "s1", focus: undefined, node: undefined, hl: undefined, view: "map" });
    expect(parseRoute("#/s/s1?focus=c2&node=K2.n3&view=outline")).toMatchObject({ focus: "c2", node: "K2.n3", view: "outline" });
  });
  it("keeps v1 card and draft links working", () => {
    expect(parseRoute("#/s/s1/c/c1?hl=2")).toMatchObject({ name: "map", sid: "s1", focus: "c1", hl: 2 });
    expect(parseRoute("#/s/s1/c/c1/d/1/3")).toMatchObject({ name: "map", focus: "c1" });
  });
  it("round-trips hrefs", () => {
    expect(parseRoute(hrefMap("s", { focus: "c", node: "K1.n1", view: "outline" }))).toMatchObject({ focus: "c", node: "K1.n1", view: "outline" });
    expect(parseRoute(hrefCard("s", "c", 4))).toMatchObject({ focus: "c", hl: 4 });
    expect(hrefMap("s")).toBe("#/s/s");
  });
});
