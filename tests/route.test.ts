import { describe, expect, it } from "vitest";
import { hrefCard, hrefChat, hrefMap, parseRoute } from "../src/route";

describe("routes", () => {
  it("parses the main routes", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/library")).toEqual({ name: "library" });
    expect(parseRoute("#/outline/abc")).toEqual({ name: "outline", id: "abc" });
    expect(parseRoute("#/settings/storage")).toEqual({ name: "settings", section: "storage" });
  });
  it("opens a topic in the chat, with an answer to show, words to find and a quote to ask about", () => {
    expect(parseRoute("#/s/s1")).toEqual({ name: "chat", sid: "s1", focus: undefined, find: undefined, quote: undefined });
    expect(parseRoute("#/s/s1?focus=c2&find=blue%20light&quote=Hi")).toMatchObject({ name: "chat", focus: "c2", find: "blue light", quote: "Hi" });
  });
  it("keeps the old map at #/m with focus, node and view", () => {
    expect(parseRoute("#/m/s1")).toEqual({ name: "map", sid: "s1", focus: undefined, node: undefined, hl: undefined, view: "map", quote: undefined });
    expect(parseRoute("#/m/s1?focus=c2&node=K2.n3&view=outline")).toMatchObject({ name: "map", focus: "c2", node: "K2.n3", view: "outline" });
  });
  it("opens v1 card and draft links in the chat at that card", () => {
    expect(parseRoute("#/s/s1/c/c1?hl=2")).toMatchObject({ name: "chat", sid: "s1", focus: "c1" });
    expect(parseRoute("#/s/s1/c/c1/d/1/3")).toMatchObject({ name: "chat", focus: "c1" });
  });
  it("round-trips hrefs", () => {
    expect(parseRoute(hrefChat("s", { focus: "c", find: "a b", quote: "q" }))).toMatchObject({ name: "chat", focus: "c", find: "a b", quote: "q" });
    expect(hrefChat("s")).toBe("#/s/s");
    expect(parseRoute(hrefMap("s", { focus: "c", node: "K1.n1", view: "outline" }))).toMatchObject({ name: "map", focus: "c", node: "K1.n1", view: "outline" });
    expect(parseRoute(hrefCard("s", "c", 4))).toMatchObject({ name: "map", focus: "c", hl: 4 });
    expect(hrefMap("s")).toBe("#/m/s");
  });
});
