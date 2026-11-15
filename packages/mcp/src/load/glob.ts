// Path globs from rule frontmatter (Claude Code paths, Cursor globs, Copilot applyTo), matched
// against file names. No regex is built from the pattern: segments are matched with the usual
// two-pointer wildcard algorithm, and every call has a step budget, so a hostile pattern costs a
// bounded amount of work and comes back "unknown" instead of hanging.
//
// The dialect is the permissive union of the three tools, because the one rule built on it
// (path-rule-matches-nothing) must never claim "matches nothing" when some tool would match:
// - a pattern with no slash matches the file name at any depth (Claude Code memory docs: "*.md"
//   matches .md files anywhere under the base directory); a leading "/" anchors it to the base;
// - "**" spans folders, "*" and "?" stay inside one name, [abc] and [!a-z] are classes, {a,b} expands
//   (at most MAX_EXPANSIONS alternatives), a backslash escapes the next character;
// - case-insensitive, and "*" matches names that start with a dot.

/** Longest pattern considered; longer ones are "unknown". */
export const MAX_PATTERN_CHARS = 512;
/** Brace alternatives one pattern may expand to. */
export const MAX_EXPANSIONS = 64;

type Tok = { t: "lit"; c: string } | { t: "any" } | { t: "star" } | { t: "class"; neg: boolean; items: Array<[string, string]> };

export interface CompiledGlob {
  /** The pattern as written. */
  source: string;
  /** Segment lists, one per brace alternative. A segment is null for "**". */
  alts: Array<Array<Tok[] | null>>;
  /** Literal leading folders shared by every alternative ("src/api" for "src/api/**"), lower case. */
  prefix: string;
}

export type CompileResult = { ok: true; glob: CompiledGlob } | { ok: false; reason: string };

/** Expands {a,b} groups, innermost first is not needed: groups may nest; returns null past the cap. */
export function expandBraces(p: string, cap = MAX_EXPANSIONS): string[] | null {
  // Find the first top-level {...} group that contains a comma.
  let depth = 0;
  let start = -1;
  let comma = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === "\\") { i++; continue; }
    if (c === "{") { if (depth === 0) { start = i; comma = false; } depth++; continue; }
    if (c === "," && depth === 1) { comma = true; continue; }
    if (c === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        if (!comma) { start = -1; continue; }
        const inner = p.slice(start + 1, i);
        const parts: string[] = [];
        let d = 0;
        let from = 0;
        for (let k = 0; k < inner.length; k++) {
          const ch = inner[k]!;
          if (ch === "\\") { k++; continue; }
          if (ch === "{") d++;
          else if (ch === "}") d--;
          else if (ch === "," && d === 0) { parts.push(inner.slice(from, k)); from = k + 1; }
        }
        parts.push(inner.slice(from));
        const head = p.slice(0, start);
        const tail = p.slice(i + 1);
        const out: string[] = [];
        for (const part of parts) {
          const sub = expandBraces(`${head}${part}${tail}`, cap);
          if (!sub) return null;
          for (const x of sub) {
            out.push(x);
            if (out.length > cap) return null;
          }
        }
        return out;
      }
    }
  }
  return [p];
}

function tokens(seg: string): Tok[] | null {
  const out: Tok[] = [];
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]!;
    if (c === "\\") {
      if (i + 1 < seg.length) out.push({ t: "lit", c: seg[++i]!.toLowerCase() });
      continue;
    }
    if (c === "*") {
      if (out.at(-1)?.t !== "star") out.push({ t: "star" });
      continue;
    }
    if (c === "?") { out.push({ t: "any" }); continue; }
    if (c === "[") {
      let j = i + 1;
      let neg = false;
      if (seg[j] === "!" || seg[j] === "^") { neg = true; j++; }
      const items: Array<[string, string]> = [];
      let first = true;
      for (; j < seg.length && (seg[j] !== "]" || first); j++) {
        first = false;
        let a = seg[j]!;
        if (a === "\\" && j + 1 < seg.length) a = seg[++j]!;
        if (seg[j + 1] === "-" && j + 2 < seg.length && seg[j + 2] !== "]") {
          let b = seg[j + 2]!;
          j += 2;
          if (b === "\\" && j + 1 < seg.length) b = seg[++j]!;
          items.push([a.toLowerCase(), b.toLowerCase()]);
        } else items.push([a.toLowerCase(), a.toLowerCase()]);
      }
      // "[" with no closing "]": Claude Code docs say the pattern is invalid and matches nothing.
      if (j >= seg.length) return null;
      out.push({ t: "class", neg, items });
      i = j;
      continue;
    }
    out.push({ t: "lit", c: c.toLowerCase() });
  }
  return out;
}

/** Compiles one pattern. Negations, absolute paths, variables and parent folders are "unknown". */
export function compileGlob(raw: string): CompileResult {
  let p = raw.trim();
  if (!p) return { ok: false, reason: "empty" };
  if (p.length > MAX_PATTERN_CHARS) return { ok: false, reason: "too long" };
  if (p.startsWith("!")) return { ok: false, reason: "negation" };
  if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith("~") || p.includes("${") || p.startsWith("//")) return { ok: false, reason: "absolute or variable" };
  if (p.startsWith("./")) p = p.slice(2);
  let anchored = false;
  if (p.startsWith("/")) { anchored = true; p = p.replace(/^\/+/, ""); }
  if (p.endsWith("/")) p = `${p}**`;
  if (!p) return { ok: false, reason: "empty" };
  const expanded = expandBraces(p);
  if (!expanded) return { ok: false, reason: "too many brace alternatives" };
  const alts: Array<Array<Tok[] | null>> = [];
  const prefixes: string[] = [];
  for (const e of expanded) {
    const segsRaw = e.split("/").filter((s, i, a) => s !== "" || i === a.length - 1);
    if (segsRaw.some((s) => s === ".." )) return { ok: false, reason: "parent folder" };
    const segs: Array<Tok[] | null> = [];
    for (const s of segsRaw) {
      if (s === ".") continue;
      if (s === "**") { if (segs.at(-1) !== null || !segs.length) segs.push(null); continue; }
      const t = tokens(s);
      if (!t) return { ok: false, reason: "invalid bracket expression" };
      segs.push(t);
    }
    // No slash: the name at any depth.
    if (!anchored && segsRaw.length === 1 && segs[0] !== null) segs.unshift(null);
    alts.push(segs);
    const lit: string[] = [];
    for (const s of segs) {
      if (!s || !s.every((t) => t.t === "lit")) break;
      lit.push(s.map((t) => (t as { c: string }).c).join(""));
    }
    // The last literal segment may be the file name itself; only folders count as a prefix.
    if (lit.length === segs.length) lit.pop();
    prefixes.push(lit.join("/"));
  }
  let prefix = prefixes[0] ?? "";
  for (const x of prefixes) {
    while (prefix && !(x === prefix || x.startsWith(`${prefix}/`))) prefix = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
  }
  return { ok: true, glob: { source: raw, alts, prefix } };
}

/** Step counter shared by a batch of matches; when it runs out, matching reports "unknown". */
export class Budget {
  constructor(public left: number) {}
}

const OUT = Symbol("out of budget");

function charOk(t: Tok, c: string): boolean {
  if (t.t === "lit") return t.c === c;
  if (t.t === "any") return true;
  if (t.t === "class") {
    let hit = false;
    for (const [a, b] of t.items) if (c >= a && c <= b) { hit = true; break; }
    return t.neg ? !hit : hit;
  }
  return false;
}

/** One name against one segment: two pointers, back up only to the last star. */
function segMatch(toks: Tok[], name: string, budget: Budget): boolean {
  let ti = 0;
  let ni = 0;
  let starT = -1;
  let starN = 0;
  while (ni < name.length) {
    if (--budget.left < 0) throw OUT;
    const t = toks[ti];
    if (t && t.t !== "star" && charOk(t, name[ni]!)) { ti++; ni++; continue; }
    if (t && t.t === "star") { starT = ti++; starN = ni; continue; }
    if (starT >= 0) { ti = starT + 1; ni = ++starN; continue; }
    return false;
  }
  while (toks[ti]?.t === "star") ti++;
  return ti === toks.length;
}

/** Segments against path parts, with "**" as a star over whole parts (same two-pointer scheme). */
function pathMatch(segs: Array<Tok[] | null>, parts: string[], budget: Budget): boolean {
  let si = 0;
  let pi = 0;
  let starS = -1;
  let starP = 0;
  while (pi < parts.length) {
    if (--budget.left < 0) throw OUT;
    const s = segs[si];
    if (s === null) { starS = si++; starP = pi; continue; }
    if (s !== undefined && segMatch(s, parts[pi]!, budget)) { si++; pi++; continue; }
    if (starS >= 0) { si = starS + 1; pi = ++starP; continue; }
    return false;
  }
  while (segs[si] === null) si++;
  return si === segs.length;
}

/**
 * Whether a root-relative POSIX file path matches, with the pattern taken relative to base
 * ("" for the root). Throws nothing: returns null when the step budget ran out.
 */
export function globMatches(g: CompiledGlob, base: string, rel: string, budget: Budget): boolean | null {
  let p = rel;
  if (base) {
    if (!rel.startsWith(`${base}/`)) return false;
    p = rel.slice(base.length + 1);
  }
  const lower = p.toLowerCase();
  if (g.prefix && !(lower.startsWith(`${g.prefix}/`))) return false;
  const parts = lower.split("/");
  try {
    for (const segs of g.alts) if (pathMatch(segs, parts, budget)) return true;
    return false;
  } catch (e) {
    if (e === OUT) return null;
    throw e;
  }
}

/** Splits a frontmatter value (YAML list, or a comma-separated string) into patterns. Commas inside braces stay. */
export function patternList(v: unknown): string[] {
  const out: string[] = [];
  const push = (s: string): void => {
    let depth = 0;
    let from = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!;
      if (c === "\\") { i++; continue; }
      if (c === "{") depth++;
      else if (c === "}") depth = Math.max(0, depth - 1);
      else if (c === "," && depth === 0) { out.push(s.slice(from, i)); from = i + 1; }
    }
    out.push(s.slice(from));
  };
  if (typeof v === "string") push(v);
  else if (Array.isArray(v)) for (const x of v) if (typeof x === "string") push(x);
  return out.map((s) => s.trim().replace(/^["']|["']$/g, "")).filter((s) => s.length > 0).slice(0, 200);
}
