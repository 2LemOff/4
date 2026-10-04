import { db } from "../db";
import { useLive } from "../store";

export function JobChip() {
  const n = useLive(async () => (await db.outlines.toArray()).filter((o) => o.status === "pending" || o.status === "running").length, []);
  if (!n) return null;
  return (
    <a className="btn chip job" href="#/library" role="status">
      ✦ Synthesizing{n > 1 ? ` (${n})` : ""}…
    </a>
  );
}
