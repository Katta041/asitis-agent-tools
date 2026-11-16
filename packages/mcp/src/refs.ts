// stale-path and dead-command: a steering file that names a repo path or a package script that is
// no longer there. Both are per-file checks called from lintDoc().
//
// Source, read 16 November 2026: Claude Code memory docs (https://code.claude.com/docs/en/memory),
// "Review your CLAUDE.md files ... periodically to remove outdated or conflicting instructions", and
// its prompt audit looks for "references to files or commands that don't exist". npm run docs
// (https://docs.npmjs.com/cli/v11/commands/npm-run): without --if-present, running "a script that
// isn't defined" exits with an error. pnpm run docs (https://pnpm.io/cli/run) say the same of
// --if-present for pnpm run.
//
// Precision comes first, so both rules stay quiet whenever a reading other than "stale" is likely.
// The 0.4.4 real-repo review (26 public repos) drove each of these:
// - Paths come only from inline code spans outside fenced blocks, have two or more segments and end
//   in a file extension or a slash ("lib/track" is often an import, "tools/list" an RPC method). The
//   first segment must exist, in the same letter case, next to the file or at the root, so
//   "next/navigation", "Owner/repo" and "application/json" are never checked.
// - A path that exists anywhere under the root with the same ending is fine: nested files often
//   give paths relative to a package. So is one a .gitignore covers, one whose folder became a
//   module (handlers/ and handlers.py), and one in link text, which broken-link checks.
// - Skipped: globs, URLs, placeholders (<x>, {x}, $X, ..., path/to, your-x, NAME), home and absolute
//   paths, build output and dependency folders, dot folders other than .github (tool state such as
//   .claude/worktrees/), lines about creating, moving or removing files, sections headed Example or
//   Template, paths after a possessive ("the compiler's `docs/x.md`"), and blocks that name another repository
//   (`acme/sdk`, a github.com link, "the charts repo", or a path whose top folder is not here).
// - yarn, pnpm without "run" and bun run also start binaries from node_modules/.bin, so for those a
//   missing script is reported only for script-like names (build, test:unit) that are not a
//   dependency. Commands with workspace or folder flags, or after cd or pushd, are not checked. A
//   script defined in any package.json up to three folders deep counts as present.
// - make is checked only when a Makefile with no include and no pattern rule sits in the file's
//   folder or above it.
// Skills, commands and agents are checked only inside the project's own tool folders (.claude/,
// .github/, .agents/, ...): a skill published for other repos talks about their paths.
// Only node:path and the sandbox are used: nothing is written, run or fetched.
//
// What each rule reads. stale-path is on by default and reads no file contents: it only asks whether
// paths exist and lists folders. With include "config" it also reads .gitignore files, so a path the
// build writes is not reported; without them it skips paths under results/, output/, tmp/, logs/
// and similar folders, which usually hold ignored run output (scripts/pr-status/results/ in
// next.js). dead-command needs package.json and Makefile contents, so it runs only with include
// "config", like the other checks that read files other than markdown. The project-files policy
// refuses every read without that grant as well.

import path from "node:path";
import type { Doc } from "./doc.js";
import { SKIP_DIRS } from "./discover.js";
import { q } from "./escape.js";
import { IgnoreTree, parseGitignore } from "./gitignore.js";
import { inNotProjectFolder, inTestTree } from "./places.js";
import type { Sandbox } from "./paths.js";

/** Where findings go: lint.ts passes its Collector. */
interface Sink {
  add(severity: "warning", rule: string, message: string, line: number): void;
}

/** Steering files that hold instructions for this repo. Skills, commands and agents count only in the project's own tool folders. */
const PROJECT_KINDS = new Set(["claude-md", "agents-md", "gemini-md", "claude-rule", "cursor-rule", "cursor-legacy", "windsurf-rule", "cline-rule", "copilot-instructions", "copilot-scoped"]);
const OWN_INVOKED_KINDS = new Set(["skill", "claude-agent", "claude-command", "prompt-file", "custom-agent"]);
const OWN_DIR = /^(?:\.claude|\.cursor|\.github|\.agents|\.codex|\.gemini|\.windsurf|\.clinerules)\//;

export function refsInScope(doc: Doc): boolean {
  if (doc.file.root.extra) return false;
  const rel = doc.file.rel;
  if (inTestTree(rel) || inNotProjectFolder(rel)) return false;
  const k = doc.kind.kind;
  if (PROJECT_KINDS.has(k)) return true;
  return OWN_INVOKED_KINDS.has(k) && OWN_DIR.test(rel);
}

/** A line that describes a path rather than pointing at an existing one: an example, a file to create, one that was moved. */
const CONTEXT_SKIP = /\b(?:e\.g\.|eg\.|i\.e\.|for example|for instance|such as|example|examples|sample|placeholder|template|create[sd]?|creating|generates?|generated|generating|new|will be|would be|output|outputs|writes?|written|produces?|rename[sd]?|renaming|moved?|removed?|deleted?|deprecated|legacy|formerly|previously|no longer|used to|old|instead of|replaced|migrat\w*|do not|don't|never|avoid|not|if exists|if present|installed)\b/i;
/** A section that holds examples or templates, not facts about this repo. */
const EXAMPLE_HEADING = /\b(?:examples?|samples?|templates?|scaffold\w*|placeholders?|illustrat\w*|hypothetical|format|output)\b/i;
const HEADING = /^ {0,3}#{1,6}\s+(.*)$/;

/** Inline code spans on one line, as [start, end) of their content. Linear in the line length. */
export function codeSpans(s: string): Array<[number, number]> {
  if (!s.includes("`")) return [];
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < s.length; ) {
    if (s.charCodeAt(i) !== 96) { i++; continue; }
    let n = 0;
    while (i + n < s.length && s.charCodeAt(i + n) === 96) n++;
    runs.push([i, n]);
    i += n;
  }
  const next = new Int32Array(runs.length).fill(-1);
  const lastByLen = new Map<number, number>();
  for (let k = runs.length - 1; k >= 0; k--) {
    next[k] = lastByLen.get(runs[k]![1]) ?? -1;
    lastByLen.set(runs[k]![1], k);
  }
  const out: Array<[number, number]> = [];
  for (let k = 0; k < runs.length && out.length < 200; ) {
    const j = next[k]!;
    if (j < 0) { k++; continue; }
    out.push([runs[k]![0] + runs[k]![1], runs[j]![0]]);
    k = j + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// stale-path

/** A segment that stands for a name the reader fills in. */
const PLACEHOLDER_SEGMENT = /^(?:path|to|foo|bar|baz|qux|xxx+|x+|y+|n+|your[-_.].*|my[-_.].*|some[-_.].*|example[-_.]?.*|sample[-_.]?.*|.*[-_]name|name|file(?:name)?|dir(?:name)?|folder|module|component|feature|thing|whatever|tbd|todo)(?:\.[A-Za-z0-9]{1,8})?$/i;
/** An all-caps word (NAME, FEATURE_ID) that is not one of the usual all-caps files. */
const CAPS_SEGMENT = /^[A-Z][A-Z0-9_]{1,}$/;
const CAPS_FILES = /^(?:README|LICENSE|LICENCE|CHANGELOG|CONTRIBUTING|SECURITY|NOTICE|AUTHORS|CODEOWNERS|AGENTS|CLAUDE|GEMINI|MEMORY|SKILL|TODO|VERSION|API|CLI|UI|SDK|DB)$/;
/** A file extension on the last segment: what makes "lib/telemetry/track" (an import) differ from "lib/telemetry/track.ts" (a file). */
const FILE_EXT = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;

/**
 * The path written in one code span, normalised, or null when it is not clearly a repo path. A
 * path has two or more segments and ends in a file extension or a slash: "packages/web/" and
 * "src/api/routes.ts" count, "next/navigation" and "tools/list" do not.
 */
export function pathCandidate(raw: string): string | null {
  let t = raw.trim();
  if (t.length < 3 || t.length > 300 || /\s/.test(t)) return null;
  // Line and symbol suffixes: src/a.ts:42, src/a.ts#L10-L20, api.py:emit_signal.
  t = t.replace(/#L\d+(?:-L?\d+)?$/, "").replace(/(\.[A-Za-z][A-Za-z0-9]{0,7}):(?:\d+(?::\d+)?(?:-\d+)?|[A-Za-z_][\w.]*)$/, "$1");
  // Globs, placeholders, variables, shell syntax, quotes, Windows paths, home paths and @scope names.
  if (/[*?[\]{}<>$%|&;=@!^~'"`(),\\+#:]/.test(t)) return null;
  if (t.startsWith("/") || t.includes("//") || t.includes("...") || t.includes("\u2026")) return null;
  while (t.startsWith("./")) t = t.slice(2);
  const dir = t.endsWith("/");
  const segs = t.replace(/\/$/, "").split("/");
  if (segs.length < 2 || segs.some((s) => s === "" || s === ".")) return null;
  if (!dir && !FILE_EXT.test(segs[segs.length - 1]!)) return null;
  // ".." only at the start.
  const firstReal = segs.findIndex((s) => s !== "..");
  if (firstReal < 0 || segs.length - firstReal < 2 || segs.slice(firstReal).includes("..")) return null;
  for (const s of segs.slice(firstReal)) {
    if (PLACEHOLDER_SEGMENT.test(s)) return null;
    const stem = s.replace(FILE_EXT, "");
    if (CAPS_SEGMENT.test(stem) && !CAPS_FILES.test(stem)) return null;
    if (SKIP_DIRS.has(s)) return null;
    if (/^\d+$/.test(s)) return null;
  }
  // A dotted first segment that is not a dot folder is a host (github.com/x, docs.rs/y).
  const first = segs[firstReal]!;
  // Dot folders other than .github hold tool state that tools create at run time (.claude/worktrees/,
  // symlinked .cursor/skills/, .agents/specs/), so a missing one is not stale.
  if (first.startsWith(".") && first !== ".github") return null;
  if (/^[\w-]+(?:\.[\w-]+)+$/.test(first) && !first.startsWith(".")) return null;
  return t;
}

/** A name in the repository, lower case, mapped to every root-relative path that ends in it. */
interface RepoIndex {
  byName: Map<string, string[]>;
  complete: boolean;
}
const indexCache = new WeakMap<Sandbox, Promise<RepoIndex>>();
const INDEX_MAX_ENTRIES = 400_000;

/**
 * Every file and folder under the root except .git and node_modules, by name. Built once per
 * sandbox and only when a path is about to be reported: a path that exists anywhere under the
 * root ("test/x.test.ts" written relative to tools/build/) is not reported. complete is false when
 * the walk hit its limit, and then nothing is reported.
 */
function repoIndex(sandbox: Sandbox): Promise<RepoIndex> {
  let p = indexCache.get(sandbox);
  if (!p) {
    p = (async () => {
      const byName = new Map<string, string[]>();
      let entries = 0;
      const queue: string[] = [""];
      for (let qi = 0; qi < queue.length; qi++) {
        const dir = queue[qi]!;
        let list;
        try {
          list = await sandbox.listDir(dir || ".");
        } catch {
          continue;
        }
        for (const e of list.entries) {
          if (++entries > INDEX_MAX_ENTRIES) return { byName, complete: false };
          if (e.name === ".git" || e.name === "node_modules") continue;
          const rel = dir ? `${dir}/${e.name}` : e.name;
          const key = e.name.toLowerCase();
          const at = byName.get(key);
          if (at) at.push(rel);
          else byName.set(key, [rel]);
          if (e.type === "dir") queue.push(rel);
        }
      }
      return { byName, complete: true };
    })();
    indexCache.set(sandbox, p);
  }
  return p;
}

/** Whether some file or folder in the repository ends with this path, in any letter case. */
function existsSomewhere(idx: RepoIndex, t: string): boolean {
  const want = t.replace(/^(?:\.\.\/)+/, "").replace(/\/$/, "").toLowerCase();
  const name = want.slice(want.lastIndexOf("/") + 1);
  return (idx.byName.get(name) ?? []).some((p) => {
    const l = p.toLowerCase();
    return l === want || l.endsWith("/" + want);
  });
}

/** The .gitignore files read so far, by folder, read through the project-files class. */
class Ignores {
  readonly tree = new IgnoreTree();
  private readonly loaded = new Set<string>();
  constructor(private readonly sandbox: Sandbox, private readonly grants: ReadonlySet<string>) {}
  async load(dir: string): Promise<void> {
    if (this.loaded.has(dir)) return;
    this.loaded.add(dir);
    const rel = dir ? `${dir}/.gitignore` : ".gitignore";
    if ((await this.sandbox.probe(rel, this.sandbox.primary.real)).state !== "ok") return;
    try {
      const f = await this.sandbox.openAs("project-files", rel, { grants: this.grants });
      this.tree.add(dir, parseGitignore(new TextDecoder("utf-8").decode(f.buf)));
    } catch {
      // unreadable or refused: no patterns from it
    }
  }
}
const ignoresBySandbox = new WeakMap<Sandbox, Ignores>();

/**
 * A folder name that usually holds files a script or a run writes (scripts/pr-status/results/).
 * Without include "config" no .gitignore is read, so these paths are skipped instead.
 */
const RUNTIME_SEGMENT = /^(?:results?|outputs?|tmp|temp|cache|logs?|generated|artifacts?|snapshots?|reports?)$/i;

/** Root-relative POSIX path of base joined with t, or null when it leaves the root. */
function rootRel(sandbox: Sandbox, base: string, t: string): string | null {
  const rel = path.relative(sandbox.primary.real, path.resolve(base, t)).split(path.sep).join("/");
  return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel;
}

/** Distinct paths, and commands, checked in one file: each costs a few filesystem lookups. */
const MAX_CHECKED = 300;
/** "the compiler's `docs/x.md`": a path that belongs to something else. */
const POSSESSIVE_BEFORE = /\b[\w.-]+['\u2019]s\s*(?:`[^`\n]{1,300}`\s*(?:,|and|or)?\s*){0,4}$/;
/** "`Owner/repo`": a GitHub repository named on the line, so its paths may be in that repository. */
const REPO_REF = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;
/** "the charts repo", "in the SDK repository": another repository named in words. */
const OTHER_REPO_WORDS = /\b(?!(?:this|the|our|same|main|whole|a|an|your|each|every|its|mono)\b)[\w-]+\s+repo(?:sitory)?\b/i;

async function checkStalePaths(doc: Doc, sandbox: Sandbox, out: Sink, submodules: string[], grants: ReadonlySet<string>): Promise<void> {
  const fileDir = path.dirname(doc.file.real);
  const bases = [...new Set([fileDir, sandbox.primary.real])];
  /** exact: exists as written; nocase: exists in another letter case (macOS, Windows); missing. */
  const cache = new Map<string, "exact" | "nocase" | "missing">();
  const look = async (t: string, base: string): Promise<"exact" | "nocase" | "missing"> => {
    const key = `${base}\0${t}`;
    let v = cache.get(key);
    if (v === undefined) {
      const p = await sandbox.probe(t, base);
      const want = rootRel(sandbox, base, t);
      if (p.state === "outside" || want === null) v = "exact"; // not ours to check
      else if (p.state === "missing") v = "missing";
      else v = p.rel === undefined || p.rel.toLowerCase() !== want.toLowerCase() || p.rel === want ? "exact" : "nocase";
      cache.set(key, v);
    }
    return v;
  };
  /** Whether the parent folder holds an entry with the same name up to its extension (handlers/ and handlers.py). */
  const siblingWithStem = async (rel: string): Promise<boolean> => {
    const clean = rel.replace(/\/$/, "");
    const parent = path.posix.dirname(clean);
    const stem = path.posix.basename(clean).replace(FILE_EXT, "").toLowerCase();
    try {
      const list = await sandbox.listDir(parent);
      return list.entries.some((e) => e.name.toLowerCase().replace(FILE_EXT, "") === stem);
    } catch {
      return false;
    }
  };
  // .gitignore files are read only with include "config"; by default no file contents are read here.
  let ignores: Ignores | null = null;
  if (readsProjectFiles(grants)) {
    ignores = ignoresBySandbox.get(sandbox) ?? null;
    if (!ignores) {
      ignores = new Ignores(sandbox, grants);
      ignoresBySandbox.set(sandbox, ignores);
    }
    await ignores.load("");
  }
  const start = doc.frontmatter.present ? doc.frontmatter.endLine + 1 : 0;
  // Blocks: runs of non-blank lines outside fences and headings (a paragraph, a list, a table).
  const blockOf = new Int32Array(doc.lines.count).fill(-1);
  const blockStart: number[] = [];
  for (let i = start, open = false; i < doc.lines.count; i++) {
    const l = doc.lines.line(i);
    if (doc.fence[i] || l.trim() === "" || HEADING.test(l)) { open = false; continue; }
    if (!open) { blockStart.push(i); open = true; }
    blockOf[i] = blockStart.length - 1;
  }
  const foreignCache = new Map<number, boolean>();
  /**
   * Whether a block is about another repository: it names one (`acme/sdk`, a github.com link, "the
   * charts repo"), or it gives another path whose top folder exists nowhere in this one. Paths in
   * such a block are often in that other repository.
   */
  const foreign = async (block: number): Promise<boolean> => {
    let v = foreignCache.get(block);
    if (v !== undefined) return v;
    v = false;
    for (let i = blockStart[block]!; i < doc.lines.count && blockOf[i] === block && !v; i++) {
      const line = doc.lines.line(i);
      if (line.length > 4000) continue;
      if (/github\.com\/|gitlab\.com\/|bitbucket\.org\//.test(line) || OTHER_REPO_WORDS.test(line)) { v = true; break; }
      for (const [a, b] of codeSpans(line)) {
        const s = line.slice(a, b).trim();
        if (REPO_REF.test(s) && (await look(s.split("/")[0]!, sandbox.primary.real)) !== "exact") { v = true; break; }
        const c = pathCandidate(s);
        if (!c) continue;
        const top = [...c.split("/").filter((x) => x === ".."), c.replace(/^(?:\.\.\/)+/, "").split("/")[0]!].join("/");
        let here = false;
        for (const base of bases) if ((await look(top, base)) === "exact") { here = true; break; }
        if (!here) { v = true; break; }
      }
    }
    foreignCache.set(block, v);
    return v;
  };
  let exampleSection = false;
  const reported = new Set<string>();
  const checked = new Set<string>();
  for (let i = start; i < doc.lines.count; i++) {
    if (doc.fence[i]) continue;
    const line = doc.lines.line(i);
    const h = HEADING.exec(line);
    if (h) {
      exampleSection = EXAMPLE_HEADING.test(h[1]!);
      continue;
    }
    if (exampleSection || line.length > 4000 || !line.includes("`") || CONTEXT_SKIP.test(line)) continue;
    const before = (a: number): string => {
      const own = line.slice(Math.max(0, a - 400), Math.max(0, a - 1));
      return i > 0 && blockOf[i - 1] === blockOf[i] ? `${doc.lines.line(i - 1).slice(-300)} ${own}` : own;
    };
    for (const [a, b] of codeSpans(line)) {
      const t = pathCandidate(line.slice(a, b));
      if (!t || reported.has(t) || checked.has(t) || checked.size >= MAX_CHECKED || POSSESSIVE_BEFORE.test(before(a))) continue;
      checked.add(t);
      // Link text ([`docs/x.md`](docs/x.md)): broken-link reports the target.
      if (/\[`*$/.test(line.slice(Math.max(0, a - 20), a)) && /^`*\]\(/.test(line.slice(b))) continue;
      let found = false;
      for (const base of bases) if ((await look(t, base)) !== "missing") { found = true; break; }
      if (found) continue;
      // The first segment must exist as written from one base: then the author clearly meant a path in this repo.
      const segs = t.replace(/\/$/, "").split("/");
      const lead = segs.filter((s) => s === "..").length;
      let base: string | null = null;
      for (const b of bases) if ((await look(segs.slice(0, lead + 1).join("/"), b)) === "exact") { base = b; break; }
      if (!base) continue;
      const rel = rootRel(sandbox, base, t);
      if (rel === null || submodules.some((m) => rel === m || rel.startsWith(m + "/"))) continue;
      if (ignores) {
        const relParts = rel.split("/");
        for (let d = 0; d < relParts.length; d++) await ignores.load(relParts.slice(0, d).join("/"));
        if (ignores.tree.ignored(rel.replace(/\/$/, ""), t.endsWith("/"))) continue;
      } else if (segs.slice(0, -1).some((x) => RUNTIME_SEGMENT.test(x))) continue;
      const idx = await repoIndex(sandbox);
      if (!idx.complete || existsSomewhere(idx, t)) continue;
      if (blockOf[i]! >= 0 && (await foreign(blockOf[i]!))) continue;
      // "src/handlers/" when src/handlers.py exists: the folder became a module, the reader still finds it.
      if (await siblingWithStem(rel)) continue;
      // The deepest part that exists, for the message.
      let have = lead + 1;
      while (have < segs.length && (await look(segs.slice(0, have + 1).join("/"), base)) === "exact") have++;
      reported.add(t);
      out.add("warning", "stale-path", `${q(t, 200)} is not in the repository: ${q(segs.slice(0, have).join("/") + "/", 200)} exists but has no ${q(segs.slice(have).join("/"), 200)}. Update the path or remove it`, i + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// dead-command

/** Fence info strings whose lines are shell commands. */
const SHELL_LANG = /^(?:|sh|bash|shell|console|zsh|terminal|shellsession|shell-session|fish)$/i;
const PNPM_BUILTINS = new Set(["add", "i", "install", "remove", "rm", "uninstall", "un", "update", "up", "upgrade", "link", "ln", "unlink", "import", "rebuild", "rb", "prune", "fetch", "patch", "patch-commit", "patch-remove", "audit", "list", "ls", "outdated", "why", "licenses", "exec", "dlx", "create", "init", "publish", "pack", "env", "store", "server", "root", "bin", "config", "c", "get", "set", "setup", "deploy", "doctor", "self-update", "help", "start", "test", "t", "tst", "run", "run-script", "recursive", "multi", "m", "dedupe", "cat-file", "cat-index", "find-hash", "ignored-builds", "approve-builds", "version", "login", "logout", "whoami", "owner", "dist-tag", "docs", "home", "repo", "search", "view", "info", "show", "access", "token", "team", "org", "profile", "sbom", "cache", "catalog"]);
const YARN_BUILTINS = new Set(["add", "install", "remove", "upgrade", "up", "upgrade-interactive", "init", "dlx", "run", "exec", "workspace", "workspaces", "why", "info", "link", "unlink", "pack", "publish", "set", "config", "cache", "constraints", "npm", "plugin", "version", "explain", "bin", "node", "rebuild", "dedupe", "patch", "patch-commit", "outdated", "audit", "list", "login", "logout", "owner", "tag", "team", "global", "create", "import", "licenses", "generate-lock-entry", "check", "autoclean", "policies", "help", "unplug", "stage", "search", "sdks"]);
/** Script names that are clearly scripts, not a binary from node_modules/.bin. */
const SCRIPT_LIKE = /^(?:dev|build|test|lint|format|fmt|typecheck|type-check|types|check|preview|e2e|clean|storybook|codegen|gen|generate|deploy|release|bootstrap|setup|ci|validate|coverage|bench|serve|watch|start)$|[:]/;
/** Flags that move a command to another package or folder. */
const ELSEWHERE = /(?:^|\s)(?:-w|--workspace|--workspaces|-ws|--prefix|-C|--dir|--cwd|--filter|-F|-r|--recursive|--if-present|-f|--file|--makefile|--directory)(?:[\s=]|$)/;

interface CommandRef {
  tool: "npm" | "pnpm" | "yarn" | "bun" | "make";
  name: string;
  /** May also start a binary of that name. */
  binOk: boolean;
  text: string;
}

/** Package-manager script runs and make targets in one shell command string. */
export function commandsIn(s: string): CommandRef[] {
  if (s.length > 2000 || /(?:^|[\s;&|(])(?:cd|pushd)\s/.test(s)) return [];
  const out: CommandRef[] = [];
  for (const part of s.split(/&&|\|\||[;|]|\$\(|`/)) {
    const m = /(?:^|\s)(npm|pnpm|yarn|bun|make)\s+([^\n]*)$/.exec(part.trim().replace(/^\$\s+/, ""));
    if (!m) continue;
    const tool = m[1] as CommandRef["tool"];
    const rest = m[2]!.trim();
    if (ELSEWHERE.test(" " + rest)) continue;
    const toks = rest.split(/\s+/);
    const text = `${tool} ${toks.slice(0, 3).join(" ")}`.trim();
    let name: string | undefined;
    let binOk = false;
    if (tool === "npm") {
      if (toks[0] === "run" || toks[0] === "run-script") name = toks[1];
      else if (toks[0] === "test" || toks[0] === "t") name = "test";
    } else if (tool === "pnpm") {
      if (toks[0] === "run" || toks[0] === "run-script") name = toks[1];
      else if (toks[0] && !PNPM_BUILTINS.has(toks[0])) { name = toks[0]; binOk = true; }
    } else if (tool === "yarn") {
      if (toks[0] === "run") { name = toks[1]; binOk = true; }
      else if (toks[0] && !YARN_BUILTINS.has(toks[0])) { name = toks[0]; binOk = true; }
    } else if (tool === "bun") {
      if (toks[0] === "run") { name = toks[1]; binOk = true; }
    } else {
      name = toks.find((x) => !x.startsWith("-") && !x.includes("="));
      if (toks.some((x) => x.startsWith("-") && x !== "-j" && !/^-j\d*$/.test(x) && x !== "-s" && x !== "-k" && x !== "-n")) name = undefined;
    }
    if (!name || !/^[A-Za-z0-9][\w:.-]{0,80}$/.test(name)) continue;
    // A file to run (bun run src/x.ts, make out.o) or a placeholder (npm run <script> was dropped above).
    if (/\.[A-Za-z0-9]{1,5}$/.test(name) || (tool === "make" && name.includes("."))) continue;
    if (PLACEHOLDER_SEGMENT.test(name) || /^(?:script|target|command|cmd|task)s?$/i.test(name)) continue;
    out.push({ tool, name, binOk, text: tool === "make" ? `make ${name}` : text });
  }
  return out;
}

interface Manifest {
  rel: string;
  scripts: Set<string>;
  deps: Set<string>;
}

interface ProjectIndex {
  manifests: Map<string, Manifest | null>;
  /** Script names defined in any package.json up to three folders below the root. */
  anyScripts: Promise<Set<string>> | null;
}
const projectCache = new WeakMap<Sandbox, ProjectIndex>();

async function readManifest(sandbox: Sandbox, idx: ProjectIndex, rel: string, grants: ReadonlySet<string>): Promise<Manifest | null> {
  if (idx.manifests.has(rel)) return idx.manifests.get(rel)!;
  let m: Manifest | null = null;
  if ((await sandbox.probe(rel, sandbox.primary.real)).state === "ok") {
    try {
      const f = await sandbox.openAs("project-files", rel, { grants });
      const j = JSON.parse(new TextDecoder("utf-8").decode(f.buf)) as Record<string, unknown>;
      const keys = (v: unknown): string[] => (v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v) : []);
      m = { rel, scripts: new Set(keys(j["scripts"])), deps: new Set([...keys(j["dependencies"]), ...keys(j["devDependencies"]), ...keys(j["peerDependencies"]), ...keys(j["optionalDependencies"])]) };
    } catch {
      m = null; // not JSON or unreadable: not checked
    }
  }
  idx.manifests.set(rel, m);
  return m;
}

const MAX_MANIFESTS = 400;

async function allScripts(sandbox: Sandbox, idx: ProjectIndex, grants: ReadonlySet<string>): Promise<Set<string>> {
  idx.anyScripts ??= (async () => {
    const names = new Set<string>();
    let seen = 0;
    const visit = async (dir: string, depth: number): Promise<void> => {
      if (seen >= MAX_MANIFESTS) return;
      let list;
      try {
        list = await sandbox.listDir(dir || ".");
      } catch {
        return;
      }
      if (list.entries.some((e) => e.name === "package.json" && e.type === "file")) {
        seen++;
        const m = await readManifest(sandbox, idx, dir ? `${dir}/package.json` : "package.json", grants);
        for (const s of m?.scripts ?? []) names.add(s);
      }
      if (depth >= 3) return;
      for (const e of list.entries) {
        if (e.type !== "dir" || e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        await visit(dir ? `${dir}/${e.name}` : e.name, depth + 1);
      }
    };
    await visit("", 0);
    return names;
  })();
  return idx.anyScripts;
}

/** Targets of a Makefile, or null when it can define targets we cannot see (include, pattern rules, $(var) names). */
export function makeTargets(text: string): Set<string> | null {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length > 2000 || raw.startsWith("\t") || /^\s*#/.test(raw)) continue;
    if (/^\s*-?s?include\s/.test(raw)) return null;
    const m = /^([^\s:=#][^:=#]*?)\s*::?(?!=)/.exec(raw);
    if (!m) continue;
    // A target-specific variable (x: VAR = 1) still names x.
    for (const name of m[1]!.trim().split(/\s+/)) {
      if (name.includes("%") || name.includes("$")) return null;
      out.add(name);
    }
    if (/^\s*\.PHONY\s*:/.test(raw)) for (const n of raw.replace(/^\s*\.PHONY\s*:/, "").trim().split(/\s+/)) if (n) out.add(n);
  }
  return out;
}

async function checkDeadCommands(doc: Doc, sandbox: Sandbox, out: Sink, grants: ReadonlySet<string>): Promise<void> {
  let idx = projectCache.get(sandbox);
  if (!idx) {
    idx = { manifests: new Map(), anyScripts: null };
    projectCache.set(sandbox, idx);
  }
  const fileRel = path.posix.dirname(doc.file.rel);
  const chain: string[] = [];
  for (let d = fileRel === "." ? "" : fileRel; ; d = path.posix.dirname(d) === "." ? "" : path.posix.dirname(d)) {
    chain.push(d);
    if (d === "") break;
  }
  let nearest: Manifest | null | undefined;
  const pkg = async (): Promise<Manifest | null> => {
    if (nearest !== undefined) return nearest;
    nearest = null;
    for (const d of chain) {
      const m = await readManifest(sandbox, idx!, d ? `${d}/package.json` : "package.json", grants);
      if (m) { nearest = m; break; }
    }
    return nearest;
  };
  let makefile: { rel: string; targets: Set<string> | null; dir: string } | null | undefined;
  const make = async (): Promise<typeof makefile> => {
    if (makefile !== undefined) return makefile;
    makefile = null;
    outer: for (const d of chain) {
      for (const n of ["GNUmakefile", "makefile", "Makefile"]) {
        const rel = d ? `${d}/${n}` : n;
        const p = await sandbox.probe(rel, sandbox.primary.real);
        if (p.state !== "ok" || !p.rel?.endsWith(n)) continue;
        try {
          const f = await sandbox.openAs("project-files", rel, { grants });
          makefile = { rel, targets: makeTargets(new TextDecoder("utf-8").decode(f.buf)), dir: d };
        } catch {
          makefile = null;
        }
        break outer;
      }
    }
    return makefile;
  };

  let checkedCommands = 0;
  const check = async (s: string, line: number): Promise<void> => {
    for (const c of commandsIn(s)) {
      if (++checkedCommands > MAX_CHECKED) return;
      if (c.tool === "make") {
        const mk = await make();
        if (!mk || !mk.targets || mk.targets.has(c.name)) continue;
        if ((await sandbox.probe(mk.dir ? `${mk.dir}/${c.name}` : c.name, sandbox.primary.real)).state !== "missing") continue;
        out.add("warning", "dead-command", `${q(c.text, 120)} names a target that ${mk.rel} does not define. Fix the command or add the target`, line);
        continue;
      }
      const m = await pkg();
      if (!m || m.scripts.has(c.name)) continue;
      if (c.binOk && (!SCRIPT_LIKE.test(c.name) || m.deps.has(c.name))) continue;
      if ((await allScripts(sandbox, idx!, grants)).has(c.name)) continue;
      const have = [...m.scripts].slice(0, 8);
      out.add("warning", "dead-command", `${q(c.text, 120)} runs a script that ${m.rel} does not define${have.length ? ` (it has ${have.join(", ")}${m.scripts.size > have.length ? ", ..." : ""})` : " (it has no scripts)"}. Fix the command or add the script`, line);
    }
  };

  const start = doc.frontmatter.present ? doc.frontmatter.endLine + 1 : 0;
  let exampleSection = false;
  let inFence = false;
  let shellFence = false;
  let fenceCd = false;
  for (let i = start; i < doc.lines.count; i++) {
    const line = doc.lines.line(i);
    if (doc.fence[i]) {
      if (!inFence) {
        inFence = true;
        const info = /^\s*(?:`{3,}|~{3,})\s*([^\s{]*)/.exec(line)?.[1] ?? "";
        shellFence = SHELL_LANG.test(info);
        fenceCd = false;
      } else if (shellFence && !exampleSection && line.length <= 2000) {
        if (/(?:^|[\s;&|($])(?:cd|pushd)\s/.test(line)) fenceCd = true;
        if (!fenceCd && !/^\s*#/.test(line)) await check(line.replace(/^\s*(?:\$|>|%)\s+/, ""), i + 1);
      }
      if (i + 1 >= doc.lines.count || !doc.fence[i + 1]) inFence = false;
      continue;
    }
    inFence = false;
    const h = HEADING.exec(line);
    if (h) {
      exampleSection = EXAMPLE_HEADING.test(h[1]!);
      continue;
    }
    if (exampleSection || line.length > 4000 || !line.includes("`") || CONTEXT_SKIP.test(line)) continue;
    for (const [a, b] of codeSpans(line)) await check(line.slice(a, b), i + 1);
  }
}

/** Whether this call may read package.json, Makefile and .gitignore files (include "config" or "config-local"). */
function readsProjectFiles(grants: ReadonlySet<string>): boolean {
  return grants.has("config") || grants.has("config-local");
}

/** Runs stale-path on one steering file, and dead-command too when the call includes "config". */
export async function checkRefs(doc: Doc, sandbox: Sandbox, out: Sink, submodules: string[], grants: ReadonlySet<string> = new Set()): Promise<void> {
  if (!refsInScope(doc)) return;
  await checkStalePaths(doc, sandbox, out, submodules, grants);
  if (readsProjectFiles(grants)) await checkDeadCommands(doc, sandbox, out, grants);
}
