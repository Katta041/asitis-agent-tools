// Counts the files in the tree that a rule's path patterns match, from the walk's name list.

import { Budget, compileGlob, globMatches, type CompiledGlob } from "./glob.js";
import type { LoadContext } from "./context.js";

/** Matching steps one rule may spend; past it the count is unknown. */
const STEPS_PER_RULE = 2_000_000;

export interface MatchCount {
  /** Files that match now, or null when we cannot tell (incomplete listing, step budget, no pattern we can read). */
  count: number | null;
  /** Patterns we could compile. */
  compiled: CompiledGlob[];
  /** Patterns we could not read (negations, absolute paths, invalid brackets), as written. */
  unreadable: string[];
  /** True when every file that could match was listed: the walk was complete and no pattern reaches into a folder the walk skips. */
  complete: boolean;
}

/** What countMatches needs from the walk: the name list (null when incomplete) and the folders it did not enter. */
export type NameSource = Pick<LoadContext, "names" | "walk">;

export function countMatches(ctx: NameSource, patterns: readonly string[], base: string): MatchCount {
  const compiled: CompiledGlob[] = [];
  const unreadable: string[] = [];
  for (const p of patterns) {
    const c = compileGlob(p);
    if (c.ok) compiled.push(c.glob);
    else unreadable.push(p);
  }
  const names = ctx.names;
  if (!names || !compiled.length) return { count: null, compiled, unreadable, complete: false };
  // A pattern that points into node_modules, dist, build or another folder the walk does not enter
  // may match files we never listed.
  const skipped = ctx.walk.skippedDirs ?? [];
  const lowerBase = base.toLowerCase();
  let complete = true;
  for (const g of compiled) {
    const fromRoot = lowerBase ? (g.prefix ? `${lowerBase}/${g.prefix}` : lowerBase) : g.prefix;
    // A pattern with no literal folders ("**/*.ts") is not held up by node_modules somewhere: a rule
    // whose only matches live in dependencies or build output is worth hearing about anyway.
    if (!g.prefix) continue;
    for (const s of skipped) {
      const sl = s.toLowerCase();
      // The skipped folder is inside the pattern's reach (prefix above it) or the prefix is inside it.
      if (sl === fromRoot || sl.startsWith(`${fromRoot}/`) || fromRoot.startsWith(`${sl}/`)) { complete = false; break; }
    }
    if (!complete) break;
  }
  const budget = new Budget(STEPS_PER_RULE);
  let count = 0;
  for (const n of names) {
    for (const g of compiled) {
      const m = globMatches(g, base, n, budget);
      if (m === null) return { count: null, compiled, unreadable, complete: false };
      if (m) { count++; break; }
    }
  }
  return { count, compiled, unreadable, complete };
}
