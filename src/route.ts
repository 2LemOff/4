export type Route =
  | { name: "home" }
  | { name: "map"; sid: string; focus?: string; node?: string; hl?: number; view: "map" | "outline"; quote?: string }
  | { name: "story"; id: string }
  | { name: "library" }
  | { name: "outline"; id: string }
  | { name: "settings"; section: string };

export function parseRoute(hash: string): Route {
  const [pathPart, query = ""] = hash.replace(/^#/, "").split("?");
  const parts = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(query);
  if (parts[0] === "s" && parts[1]) {
    // v1 links: #/s/:sid/c/:cid[/d/...][?hl=n] open the map focused on that card
    const focus = parts[2] === "c" && parts[3] ? parts[3] : q.get("focus") ?? undefined;
    const hl = q.get("hl");
    return {
      name: "map",
      sid: parts[1],
      focus,
      node: q.get("node") ?? undefined,
      hl: hl !== null && hl !== "" && !isNaN(Number(hl)) ? Number(hl) : undefined,
      view: q.get("view") === "outline" ? "outline" : "map",
      quote: q.get("quote") ?? undefined,
    };
  }
  if (parts[0] === "story" && parts[1]) return { name: "story", id: parts[1] };
  if (parts[0] === "library") return { name: "library" };
  if (parts[0] === "outline" && parts[1]) return { name: "outline", id: parts[1] };
  if (parts[0] === "settings") return { name: "settings", section: parts[1] ?? "account" };
  return { name: "home" };
}

export function hrefMap(sid: string, opts: { focus?: string; node?: string; view?: "map" | "outline"; quote?: string } = {}): string {
  const q = new URLSearchParams();
  if (opts.focus) q.set("focus", opts.focus);
  if (opts.node) q.set("node", opts.node);
  if (opts.quote) q.set("quote", opts.quote);
  if (opts.view === "outline") q.set("view", "outline");
  const s = q.toString();
  return `#/s/${sid}${s ? `?${s}` : ""}`;
}

/** Open the map focused on a question/answer (and optionally highlight its n-th point). */
export const hrefCard = (sid: string, cid: string, hl?: number) =>
  `#/s/${sid}?focus=${cid}${hl !== undefined && hl >= 0 ? `&hl=${hl}` : ""}`;

export const hrefStory = (id: string) => `#/story/${id}`;

export const go = (href: string) => {
  location.hash = href.replace(/^#/, "");
};
