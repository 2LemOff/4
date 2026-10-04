import type { Card, Effort } from "./types";

/** Effective effort after replaying the stored mid-conversation updates along a path (root first). */
export function effortAlong(path: Card[]): Effort | undefined {
  let eff = path[0]?.effortUsed;
  for (const c of path.slice(1)) if (c.configUpdate) eff = c.configUpdate.effort;
  return eff;
}

export type EffortPlan =
  | { mode: "request" }
  | { mode: "update"; baseline: Effort | undefined; update?: { effort: Effort } };

/**
 * Decide how an effort choice is sent. Where the model accepts mid-conversation updates, the request-level
 * effort stays at the root's baseline and a change becomes a stored configuration_update, so the cached prefix
 * stays valid. Otherwise the effort is simply sent at request level (which resets the cache for that turn).
 */
export function planEffort(opts: {
  canUpdate: boolean;
  parentPath: Card[];
  next: Effort | undefined;
  kind: "default" | "off" | "effort" | "budget";
}): EffortPlan {
  if (!opts.canUpdate || !opts.parentPath.length || opts.kind !== "effort" || !opts.next) return { mode: "request" };
  const cur = effortAlong(opts.parentPath);
  return {
    mode: "update",
    baseline: opts.parentPath[0].effortUsed,
    update: opts.next !== cur ? { effort: opts.next } : undefined,
  };
}
