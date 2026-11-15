// .gitignore matching for the agent leak audit (checks/agent-leaks.ts). No git, no exec: the
// patterns come from .gitignore files read through the sandbox, and matching follows the rules in
// https://git-scm.com/docs/gitignore (read 15 November 2026):
// - blank lines match nothing, "#" starts a comment, "\#" and "\!" are literal;
// - trailing spaces are dropped unless escaped with a backslash;
// - "!" negates; a later match wins, and a .gitignore deeper in the tree wins over one above it;
// - a trailing "/" matches folders only;
// - a "/" at the start or in the middle anchors the pattern to the folder of its .gitignore,
//   otherwise it matches a name at any depth below that folder;
// - "*" and "?" never match "/", "[...]" is a set ("!" or "^" negates it, ranges allowed);
// - "**/" at the start or "/**/" in the middle match zero or more folders, a trailing "/**"
//   matches everything inside, and any other "**" is a plain "*";
// - a file cannot be re-included when a folder above it is excluded.
// Not modelled: .git/info/exclude and the global excludes file (we never read outside the root
// or inside .git), core.ignorecase, and POSIX classes like [[:alpha:]] (read as plain sets).
//
// Matching simulates the pattern as an NFA, one pass over the path with a set of live states, so a
// match costs O(path length x pattern length) whatever the pattern is. No regex is built from the
// pattern, so no pattern can make the engine backtrack.

/** One step of a compiled pattern. */
type Tok =
  | { t: "lit"; c: string }
  | { t: "one" } // ?
  | { t: "star" } // * inside one name
  | { t: "set"; neg: boolean; items: Array<[string, string]> }
  | { t: "dirs" } // **/ : zero or more whole folders
  | { t: "all" }; // trailing /** (or a lone **): anything, "/" included

export interface IgnorePattern {
  neg: boolean;
  dirOnly: boolean;
  /** Matched against the path below the .gitignore folder; otherwise against the last name. */
  anchored: boolean;
  toks: Tok[];
}

/** Longest pattern line we compile. Longer lines are skipped (git has no such limit, but no real pattern is this long). */
export const MAX_PATTERN_CHARS = 1024;
/** Most patterns kept from one .gitignore file. */
export const MAX_PATTERNS = 20_000;

/** Parses a .gitignore file. Lines that cannot match anything are dropped. */
export function parseGitignore(text: string): IgnorePattern[] {
  const out: IgnorePattern[] = [];
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (start <= text.length && out.length < MAX_PATTERNS) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    let line = text.slice(start, end);
    start = end + 1;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.length > MAX_PATTERN_CHARS) continue;
    const p = parseLine(line);
    if (p) out.push(p);
    if (end === text.length) break;
  }
  return out;
}

function parseLine(raw: string): IgnorePattern | null {
  if (raw === "" || raw.startsWith("#")) return null;
  // Trailing spaces go unless the last one is escaped ("a\ " keeps one space).
  let line = raw;
  let cut = line.length;
  while (cut > 0 && line[cut - 1] === " ") cut--;
  if (cut < line.length && cut > 0 && line[cut - 1] === "\\") cut++;
  line = line.slice(0, cut);
  if (line === "") return null;
  let neg = false;
  if (line.startsWith("!")) {
    neg = true;
    line = line.slice(1);
  }
  let dirOnly = false;
  if (line.endsWith("/") && !line.endsWith("\\/")) {
    dirOnly = true;
    line = line.replace(/\/+$/, "");
  }
  if (line === "") return null;
  // A slash anywhere but the end anchors the pattern; a leading one is then dropped.
  const anchored = hasUnescapedSlash(line);
  if (line.startsWith("/")) line = line.replace(/^\/+/, "");
  if (line === "") return null;
  const toks = compile(line);
  return toks ? { neg, dirOnly, anchored, toks } : null;
}

function hasUnescapedSlash(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === "/") return true;
  }
  return false;
}

function compile(p: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < p.length) {
    const c = p[i]!;
    if (c === "\\") {
      if (i + 1 >= p.length) return null; // a trailing backslash is an invalid pattern in git
      toks.push({ t: "lit", c: p[i + 1]! });
      i += 2;
      continue;
    }
    if (c === "*") {
      let j = i;
      while (j < p.length && p[j] === "*") j++;
      const run = j - i;
      const atStart = i === 0 || p[i - 1] === "/";
      const atEnd = j === p.length;
      if (run >= 2 && atStart && p[j] === "/") {
        toks.push({ t: "dirs" });
        i = j + 1;
        continue;
      }
      if (run >= 2 && atStart && atEnd) {
        toks.push({ t: "all" });
        i = j;
        continue;
      }
      if (toks[toks.length - 1]?.t !== "star") toks.push({ t: "star" });
      i = j;
      continue;
    }
    if (c === "?") {
      toks.push({ t: "one" });
      i++;
      continue;
    }
    if (c === "[") {
      const set = parseSet(p, i);
      if (set) {
        toks.push(set.tok);
        i = set.next;
        continue;
      }
      toks.push({ t: "lit", c: "[" });
      i++;
      continue;
    }
    toks.push({ t: "lit", c });
    i++;
  }
  return toks;
}

/** "[...]" starting at i, or null when it is not closed (then "[" is literal). */
function parseSet(p: string, i: number): { tok: Tok; next: number } | null {
  let j = i + 1;
  let neg = false;
  if (p[j] === "!" || p[j] === "^") {
    neg = true;
    j++;
  }
  const items: Array<[string, string]> = [];
  let first = true;
  while (j < p.length) {
    let c = p[j]!;
    if (c === "]" && !first) return { tok: { t: "set", neg, items }, next: j + 1 };
    first = false;
    if (c === "\\" && j + 1 < p.length) {
      j++;
      c = p[j]!;
    }
    if (p[j + 1] === "-" && j + 2 < p.length && p[j + 2] !== "]") {
      let hi = p[j + 2]!;
      let step = 3;
      if (hi === "\\" && j + 3 < p.length) {
        hi = p[j + 3]!;
        step = 4;
      }
      items.push([c, hi]);
      j += step;
      continue;
    }
    items.push([c, c]);
    j++;
  }
  return null;
}

const inSet = (tok: Extract<Tok, { t: "set" }>, c: string): boolean => {
  let hit = false;
  for (const [lo, hi] of tok.items) {
    if (c >= lo && c <= hi) {
      hit = true;
      break;
    }
  }
  return hit !== tok.neg;
};

/**
 * NFA states for a token list. Every token is one state except "dirs", which is two: an entry
 * state (may skip ahead without consuming) and an inside-a-folder-name state, so "**\/foo" matches
 * "foo" and "a/b/foo" but never "xfoo".
 */
interface Nfa {
  /** For each state: the token it consumes for, and whether it is the inside part of a "dirs". */
  kind: Array<Tok | { t: "dirs-in" }>;
  /** State index after the token at this state (for dirs, after both parts). */
  next: number[];
}

const nfaCache = new WeakMap<Tok[], Nfa>();

function nfaOf(toks: Tok[]): Nfa {
  const hit = nfaCache.get(toks);
  if (hit) return hit;
  const kind: Nfa["kind"] = [];
  const next: number[] = [];
  for (const tok of toks) {
    if (tok.t === "dirs") {
      const at = kind.length;
      kind.push(tok, { t: "dirs-in" });
      next.push(at + 2, at + 2);
    } else {
      next.push(kind.length + 1);
      kind.push(tok);
    }
  }
  const nfa = { kind, next };
  nfaCache.set(toks, nfa);
  return nfa;
}

/** True when the whole of s matches the tokens. O(s.length x states). */
export function globMatch(toks: Tok[], s: string): boolean {
  const nfa = nfaOf(toks);
  const n = nfa.kind.length; // state n is "matched"
  let cur = new Uint8Array(n + 1);
  let nxt = new Uint8Array(n + 1);
  const close = (set: Uint8Array): void => {
    // Epsilon moves only go forward, so one pass in index order is enough.
    for (let i = 0; i < n; i++) {
      if (!set[i]) continue;
      const k = nfa.kind[i]!;
      if (k.t === "star" || k.t === "all" || k.t === "dirs") set[nfa.next[i]!] = 1;
    }
  };
  cur[0] = 1;
  close(cur);
  for (let p = 0; p < s.length; p++) {
    const c = s[p]!;
    nxt.fill(0);
    let any = false;
    for (let i = 0; i < n; i++) {
      if (!cur[i]) continue;
      const k = nfa.kind[i]!;
      switch (k.t) {
        case "lit":
          if (k.c === c) nxt[nfa.next[i]!] = 1;
          break;
        case "one":
          if (c !== "/") nxt[nfa.next[i]!] = 1;
          break;
        case "set":
          if (c !== "/" && inSet(k, c)) nxt[nfa.next[i]!] = 1;
          break;
        case "star":
          if (c !== "/") nxt[i] = 1;
          break;
        case "all":
          nxt[i] = 1;
          break;
        case "dirs":
          // Start a folder name (a name is never empty, so "/" cannot start one).
          if (c !== "/") nxt[i + 1] = 1;
          break;
        case "dirs-in":
          if (c === "/") nxt[i - 1] = 1;
          else nxt[i] = 1;
          break;
      }
      any = true;
    }
    if (!any) return false;
    [cur, nxt] = [nxt, cur];
    close(cur);
  }
  return cur[n] === 1;
}

/** Does one pattern match a path relative to its .gitignore folder? */
export function patternMatches(p: IgnorePattern, relPath: string, isDir: boolean): boolean {
  if (p.dirOnly && !isDir) return false;
  if (p.anchored) return globMatch(p.toks, relPath);
  const slash = relPath.lastIndexOf("/");
  return globMatch(p.toks, slash === -1 ? relPath : relPath.slice(slash + 1));
}

/**
 * The .gitignore files of one tree, by folder ("" for the root, "a/b" below it). Answers whether a
 * root-relative path is ignored by them.
 */
export class IgnoreTree {
  private readonly files = new Map<string, IgnorePattern[]>();

  add(dir: string, patterns: IgnorePattern[]): void {
    if (patterns.length) this.files.set(dir, patterns);
  }

  get size(): number {
    return this.files.size;
  }

  /** The verdict of the .gitignore files alone for this exact path: true, false, or undefined when no pattern matches. */
  private verdict(path: string, isDir: boolean): boolean | undefined {
    let result: boolean | undefined;
    const parts = path.split("/");
    // Root first, deepest last, so the deepest matching pattern decides.
    for (let d = 0; d < parts.length; d++) {
      const dir = parts.slice(0, d).join("/");
      const pats = this.files.get(dir);
      if (!pats) continue;
      const rel = d === 0 ? path : parts.slice(d).join("/");
      for (const p of pats) if (patternMatches(p, rel, isDir)) result = !p.neg;
    }
    return result;
  }

  /** True when a folder is excluded on its own (not counting folders above it). */
  dirExcluded(dir: string): boolean {
    return this.verdict(dir, true) === true;
  }

  /** True when some pattern matches the path itself, either way: a "!" line means someone chose to keep it. */
  decided(path: string, isDir = false): boolean {
    return this.verdict(path, isDir) !== undefined;
  }

  /** True when the path, or any folder above it, is ignored. */
  ignored(path: string, isDir = false): boolean {
    const parts = path.split("/");
    for (let d = 1; d < parts.length; d++) {
      if (this.verdict(parts.slice(0, d).join("/"), true) === true) return true;
    }
    return this.verdict(path, isDir) === true;
  }
}
