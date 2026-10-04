export type Route =
  | { name: "home" }
  | { name: "card"; sid: string; cid: string; hl?: number }
  | { name: "draft"; sid: string; cid: string; block?: number; sentence?: number }
  | { name: "library" }
  | { name: "outline"; id: string }
  | { name: "settings"; section: string };

export function parseRoute(hash: string): Route {
  const [pathPart, query = ""] = hash.replace(/^#/, "").split("?");
  const parts = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(query);
  if (parts[0] === "s" && parts[2] === "c" && parts[1] && parts[3]) {
    if (parts[4] === "d") {
      if (parts[5] === "whole") return { name: "draft", sid: parts[1], cid: parts[3] };
      const block = Number(parts[5]);
      const sentence = Number(parts[6]);
      if (Number.isInteger(block) && Number.isInteger(sentence)) return { name: "draft", sid: parts[1], cid: parts[3], block, sentence };
      return { name: "draft", sid: parts[1], cid: parts[3] };
    }
    const hl = q.get("hl");
    return { name: "card", sid: parts[1], cid: parts[3], hl: hl !== null && hl !== "" ? Number(hl) : undefined };
  }
  if (parts[0] === "library") return { name: "library" };
  if (parts[0] === "outline" && parts[1]) return { name: "outline", id: parts[1] };
  if (parts[0] === "settings") return { name: "settings", section: parts[1] ?? "account" };
  return { name: "home" };
}

export const hrefCard = (sid: string, cid: string, hl?: number) =>
  `#/s/${sid}/c/${cid}${hl !== undefined && hl >= 0 ? `?hl=${hl}` : ""}`;
export const hrefDraft = (sid: string, cid: string, block?: number, sentence?: number) =>
  block === undefined || sentence === undefined ? `#/s/${sid}/c/${cid}/d/whole` : `#/s/${sid}/c/${cid}/d/${block}/${sentence}`;

export const go = (href: string) => {
  location.hash = href.replace(/^#/, "");
};
