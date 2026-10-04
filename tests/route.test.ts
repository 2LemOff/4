import { describe, expect, it } from "vitest";
import { hrefCard, hrefDraft, parseRoute } from "../src/route";

describe("routes", () => {
  it("parses the main routes", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/")).toEqual({ name: "home" });
    expect(parseRoute("#/library")).toEqual({ name: "library" });
    expect(parseRoute("#/outline/abc")).toEqual({ name: "outline", id: "abc" });
    expect(parseRoute("#/settings")).toEqual({ name: "settings", section: "account" });
    expect(parseRoute("#/settings/models")).toEqual({ name: "settings", section: "models" });
  });
  it("parses cards with a highlight block", () => {
    expect(parseRoute("#/s/s1/c/c1")).toEqual({ name: "card", sid: "s1", cid: "c1", hl: undefined });
    expect(parseRoute("#/s/s1/c/c1?hl=2")).toEqual({ name: "card", sid: "s1", cid: "c1", hl: 2 });
  });
  it("parses drafts for a sentence and for the whole card", () => {
    expect(parseRoute("#/s/s1/c/c1/d/1/3")).toEqual({ name: "draft", sid: "s1", cid: "c1", block: 1, sentence: 3 });
    expect(parseRoute("#/s/s1/c/c1/d/whole")).toEqual({ name: "draft", sid: "s1", cid: "c1" });
  });
  it("round-trips hrefs", () => {
    expect(parseRoute(hrefCard("s", "c", 4))).toEqual({ name: "card", sid: "s", cid: "c", hl: 4 });
    expect(parseRoute(hrefDraft("s", "c", 0, 2))).toEqual({ name: "draft", sid: "s", cid: "c", block: 0, sentence: 2 });
    expect(parseRoute(hrefDraft("s", "c"))).toEqual({ name: "draft", sid: "s", cid: "c" });
  });
});
