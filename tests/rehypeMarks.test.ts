import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { applyMarks, hastText, normalizeTree, rehypeMarks, type HRoot, type MarkSpan } from "../src/rehypeMarks";

const t = (value: string) => ({ type: "text" as const, value });
const el = (tagName: string, children: any[]) => ({ type: "element" as const, tagName, properties: {}, children });

describe("highlight marks", () => {
  it("counts text the way the page shows it: raw HTML as text, no whitespace between table rows", () => {
    const tree: HRoot = {
      type: "root",
      children: [el("p", [t("A "), { type: "raw", value: "<b>" }]), t("\n"), el("table", [t("\n"), el("tr", [t("\n"), el("td", [t("x")]), t("\n")])])],
    };
    normalizeTree(tree);
    expect(hastText(tree)).toBe("A <b>\nx");
  });

  it("wraps marked words across text nodes and keeps every character", () => {
    const tree: HRoot = { type: "root", children: [el("p", [t("Hello "), el("strong", [t("world")]), t(" again")])] };
    applyMarks(tree, [{ id: "h1", start: 3, end: 9, className: "picked", badge: "↳ 1" }]);
    expect(hastText(tree)).toBe("Hello world again");
    const p = tree.children[0] as any;
    expect(p.children[0]).toEqual(t("Hel"));
    expect(p.children[1]).toMatchObject({ tagName: "mark", properties: { dataH: "h1", className: ["hl", "picked"] }, children: [t("lo ")] });
    expect(p.children[1].properties.dataN).toBeUndefined();
    const inner = p.children[2].children;
    expect(inner[0]).toMatchObject({ tagName: "mark", properties: { dataH: "h1", dataN: "↳ 1" }, children: [t("wor")] });
    expect(inner[1]).toEqual(t("ld"));
  });

  it("lets highlights overlap", () => {
    const tree: HRoot = { type: "root", children: [el("p", [t("abcdefgh")])] };
    applyMarks(tree, [
      { id: "a", start: 0, end: 5 },
      { id: "b", start: 3, end: 8 },
    ]);
    const parts = (tree.children[0] as any).children.map((c: any) => [c.properties?.dataH ?? "", c.children?.[0].value ?? c.value]);
    expect(parts).toEqual([["a", "abc"], ["a b", "de"], ["b", "fgh"]]);
  });

  it("offsets match the text react-markdown renders, tables included", () => {
    const md = "Light **scatters** & bends.\n\n| a | b |\n|---|---|\n| x | y |\n\n- one\n- two\n\nEnd <i>raw</i>.";
    let seen = "";
    const resolve = (text: string): MarkSpan[] => {
      seen = text;
      const at = text.indexOf("scatters");
      return [{ id: "h", start: at, end: at + 8 }];
    };
    const html = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm], rehypePlugins: [[rehypeMarks, { resolve }]] as any }, md));
    const shown = html
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&");
    expect(shown).toBe(seen);
    expect(html).toContain('<mark data-h="h" class="hl">scatters</mark>');
  });
});
