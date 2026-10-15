// Root confinement and file-type policy. Every file this server touches goes
// through Sandbox. The server has no write path at all; this module only opens
// files read-only.

import { constants, promises as fsp, realpathSync, statSync, type Stats } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CAPS } from "./limits.js";
import { AGENT_CONFIG_POLICY } from "./policy/agent-config.js";
import { ASITISRC_POLICY } from "./policy/asitisrc.js";
import { GITMODULES_POLICY } from "./policy/gitmodules.js";
import { SKILL_SCRIPT_POLICY } from "./policy/skill-script.js";

export class UserError extends Error {
  override readonly name = "UserError";
}

export const MARKDOWN_EXTENSIONS = [".md", ".mdc", ".markdown", ".mdx"] as const;
/** Steering files without a markdown extension that are still read. */
export const EXTENSIONLESS_STEERING = [".cursorrules", ".windsurfrules", ".clinerules"] as const;

/**
 * What kind of file a read is for. markdown is the default and the only class the MCP tools use
 * unless a call opts in with include. The other classes are decided by their policy in policy/*.ts,
 * after the refusals every class shares (.env, .git, node_modules, Windows streams and devices).
 */
export type ReadClass = "markdown" | "asitisrc" | "skill-script" | "agent-config" | "gitmodules";

export interface PolicyContext {
  sandbox: Sandbox;
  /** Opt-ins of the current call (include values such as "config-local"), for policies with sub-grants. */
  grants: ReadonlySet<string>;
}

export interface ReadPolicy {
  readonly readClass: Exclude<ReadClass, "markdown">;
  /** Words for messages: "skill scripts", "agent config files". */
  readonly label: string;
  /** Largest file read in full. A head read (headBytes) ignores it. */
  readonly maxBytes: number;
  /** Optional per-path limit (a baseline file may be larger than a config file). Defaults to maxBytes. */
  maxBytesFor?(relPosix: string): number;
  /**
   * null to allow, or a reason in the same style as policyRefusal ("x is ...; this server ...").
   * Called for the path as asked and again for the real path after symlinks resolve.
   */
  refusal(relPosix: string, ctx: PolicyContext): string | null | Promise<string | null>;
}

export const READ_POLICIES: Readonly<Record<Exclude<ReadClass, "markdown">, ReadPolicy>> = {
  asitisrc: ASITISRC_POLICY,
  "skill-script": SKILL_SCRIPT_POLICY,
  "agent-config": AGENT_CONFIG_POLICY,
  gitmodules: GITMODULES_POLICY,
};

export interface Root {
  /** The path as given at startup (for messages). */
  given: string;
  /**
   * The root as the server opens it: the realpath of the given folder, or the folder
   * itself where Node's permission model denies realpath. Every path the server opens
   * starts with this prefix, so it stays inside the --allow-fs-read grant.
   */
  real: string;
  /**
   * The root as the OS resolves it (realpath.native), used only to compare paths.
   * On Windows the JS realpath keeps 8.3 short names (C:\Users\RUNNER~1) and the case
   * as given, while the native realpath that resolves files returns long names, so
   * containment must be checked against this form.
   */
  canon: string;
  /** A second or later --root: the place for a Claude Code memory folder (~/.claude/projects/<project>/memory). */
  extra?: boolean;
}

export interface Resolved {
  /** Absolute real path (symlinks resolved). */
  real: string;
  /** Root-relative POSIX path of the real file, used for display and classification. */
  rel: string;
  root: Root;
}

export interface OpenedFile extends Resolved {
  buf: Buffer;
  stat: Stats;
  /**
   * When the file was reached through a symlink inside the root (CLAUDE.md -> AGENTS.md, or a
   * symlinked .claude/skills folder): the root-relative path of the real file. `rel` is then the
   * path the agent tools see, which is what decides how the file loads.
   */
  linkTarget?: string;
  /** The absolute path as opened, before symlinks are resolved. */
  lexical?: string;
}

const toPosix = (p: string): string => p.split(path.sep).join("/");

/** OS-canonical path (long names, on-disk case), or the path unchanged when it cannot be resolved. */
function canonical(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}

/** Root-relative path of target, or null when it is outside. Case-insensitive on Windows (path.win32.relative). */
function within(rootReal: string, target: string): string | null {
  const rel = path.relative(rootReal, target);
  if (rel === "") return "";
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return null;
  return rel;
}

/**
 * Returns a refusal reason if the path must never be read, or null.
 * Applied to both the path the agent asked for and the real path it resolves to,
 * so a symlink named notes.md that points at .env is refused too.
 */
/** A byte size for messages: "4,096 bytes" or "17.2 MB". */
const mb = (bytes: number): string => (bytes < 1024 * 1024 ? `${bytes.toLocaleString("en-US")} bytes` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

export function policyRefusal(relPosix: string, platform: NodeJS.Platform = process.platform): string | null {
  const parts = relPosix.split("/");
  const base = parts[parts.length - 1] ?? "";
  const lower = base.toLowerCase();
  const lowerParts = parts.map((p) => p.toLowerCase());
  if (platform === "win32") {
    // A root-relative path never contains ":" on Windows except to name an NTFS alternate
    // data stream (file.md:stream, file.md::$DATA), which would bypass the extension checks.
    if (relPosix.includes(":")) return `${relPosix} names an alternate data stream; this server only reads a file's main contents`;
    // CON, NUL, COM1.md and friends open devices, not files, on many Windows versions.
    const device = parts.find((p) => WINDOWS_DEVICE.test(p.replace(/[. ]+$/, "")));
    if (device !== undefined) return `${relPosix} uses the reserved Windows device name ${device}; this server only reads files`;
  }
  if (lower.startsWith(".env")) return `${relPosix} is an environment file that may hold secrets; this server never reads .env files`;
  if (lowerParts.includes(".claude") && /^settings.*\.json$/.test(lower)) {
    return `${relPosix} is a Claude Code settings file (permissions and hooks); this server never reads settings`;
  }
  if (lowerParts.includes(".git")) return `${relPosix} is inside .git; this server does not read git internals`;
  if (lowerParts.includes("node_modules")) return `${relPosix} is inside node_modules; this server does not read dependencies`;
  if ((EXTENSIONLESS_STEERING as readonly string[]).includes(lower)) return null;
  const ext = path.posix.extname(lower);
  if (!(MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)) {
    return `${relPosix} is not a markdown file; this server only reads markdown (${MARKDOWN_EXTENSIONS.join(", ")}) and ${EXTENSIONLESS_STEERING.join(", ")}`;
  }
  return null;
}

/**
 * The refusals every read class shares: Windows streams and devices, .env files, git internals and
 * dependencies. Used for the non-markdown classes; policyRefusal keeps its own order for markdown.
 */
export function commonRefusal(relPosix: string, platform: NodeJS.Platform = process.platform): string | null {
  const parts = relPosix.split("/");
  const lowerParts = parts.map((p) => p.toLowerCase());
  const lower = (parts[parts.length - 1] ?? "").toLowerCase();
  if (platform === "win32") {
    if (relPosix.includes(":")) return `${relPosix} names an alternate data stream; this server only reads a file's main contents`;
    const device = parts.find((p) => WINDOWS_DEVICE.test(p.replace(/[. ]+$/, "")));
    if (device !== undefined) return `${relPosix} uses the reserved Windows device name ${device}; this server only reads files`;
  }
  if (lower.startsWith(".env")) return `${relPosix} is an environment file that may hold secrets; this server never reads .env files`;
  if (lowerParts.includes(".git")) return `${relPosix} is inside .git; this server does not read git internals`;
  if (lowerParts.includes("node_modules")) return `${relPosix} is inside node_modules; this server does not read dependencies`;
  return null;
}

/** Reserved DOS device names, with or without an extension (compared case-insensitively). */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$) *(\..*)?$/i;

const isDenied = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === "ERR_ACCESS_DENIED";
const isMissing = (e: unknown): boolean => ["ENOENT", "ENOTDIR"].includes((e as NodeJS.ErrnoException)?.code ?? "");

/** The --allow-fs-read folders Node was started with (empty without the permission model). */
function readGrants(): string[] {
  return process.execArgv.filter((a) => a.startsWith("--allow-fs-read=")).map((a) => a.slice("--allow-fs-read=".length));
}

/**
 * Resolves and checks one root folder. The checks use the sync fs API on purpose:
 * on Node 22.13 a promise-based stat that the permission model denies rejects
 * outside the promise chain and crashes the process instead of throwing here.
 */
export function resolveRoot(g: string): string {
  const lexical = path.resolve(g);
  let real: string;
  try {
    real = realpathSync(lexical);
  } catch (e) {
    if (isMissing(e)) throw new UserError(`Root folder not found: ${g}. Pass an existing folder with --root.`);
    if (!isDenied(e)) throw new UserError(`Cannot read the root folder ${g} (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}).`);
    // Node's permission model can deny realpath on a folder it lets us read below
    // (for example when a parent is a symlink, or a nested folder is also allowed).
    // The lexical path is still confined: every read below it is checked by Node.
    real = lexical;
  }
  let st: Stats;
  try {
    st = statSync(real);
  } catch (e) {
    if (isMissing(e)) throw new UserError(`Root folder not found: ${g}. Pass an existing folder with --root.`);
    if (isDenied(e)) throw new UserError(deniedRootMessage(real));
    throw new UserError(`Cannot read the root folder ${g} (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}).`);
  }
  if (!st.isDirectory()) throw new UserError(`Root is not a folder: ${g}. Pass a folder with --root.`);
  return real;
}

function deniedRootMessage(root: string): string {
  const nested = readGrants().filter((a) => {
    const rel = path.relative(root, path.resolve(a));
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
  if (nested.length) {
    return `Node's permission model will not let the server read the root folder ${root} itself, because --allow-fs-read also lists ${nested.join(", ")}, which is inside it. Remove the nested --allow-fs-read (the root already covers it), or list the root first.`;
  }
  return `Node's permission model will not let the server read the root folder ${root}. Add --allow-fs-read=${root} (use the folder's real path if a parent folder is a symlink).`;
}

export interface SandboxOptions {
  allowBroadRoot?: boolean;
  maxFileBytes?: number;
}

/** A one-line UserError for the filesystem errors a user can fix, or null for the rest. Never includes an absolute path. */
export function fsError(e: unknown, input: string): UserError | null {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  if (code === "ERR_ACCESS_DENIED") return new UserError(`Refused: ${input} resolves outside the folders the server may read.`);
  if (code === "EACCES" || code === "EPERM") return new UserError(`Permission denied: the server cannot read ${input}. Check the file's permissions.`);
  if (code === "ELOOP") return new UserError(`Symlink loop: ${input} is a symlink that points back to itself or into a cycle.`);
  if (code === "ENOENT" || code === "ENOTDIR") return new UserError(`File not found: ${input}. Paths are relative to the allowed folder; find_steering_files lists the steering files.`);
  if (code === "EISDIR") return new UserError(`Not a regular file: ${input}.`);
  return null;
}

export class Sandbox {
  readonly maxFileBytes: number;

  private constructor(readonly roots: Root[], opts: SandboxOptions) {
    this.maxFileBytes = opts.maxFileBytes ?? CAPS.maxFileBytes;
  }

  static async create(given: string[], opts: SandboxOptions = {}): Promise<Sandbox> {
    if (given.length === 0) throw new UserError("No root folder given. Start the server with --root /path/to/project.");
    const roots: Root[] = [];
    // Under Node's permission model the home folder may not be readable, so fall
    // back to the lexical path for the broad-root check.
    const homes = [path.resolve(os.homedir()), canonical(os.homedir())];
    try {
      homes.push(realpathSync(os.homedir()));
    } catch {
      // not readable; the lexical path is enough
    }
    const same = (a: string, b: string): boolean => within(a, b) === "";
    for (const g of given) {
      const real = resolveRoot(g);
      const canon = canonical(real);
      if (!opts.allowBroadRoot) {
        if ([real, canon].some((r) => path.parse(r).root === r)) throw new UserError(`Refusing the filesystem root (${real}) as the allowed folder. Pass your project folder with --root, or add --allow-broad-root.`);
        if (homes.some((h) => same(h, real) || same(h, canon))) throw new UserError(`Refusing your home folder (${real}) as the allowed folder. Pass your project folder with --root, or add --allow-broad-root.`);
      }
      roots.push({ given: g, real, canon, ...(roots.length ? { extra: true } : {}) });
    }
    return new Sandbox(roots, opts);
  }

  get primary(): Root {
    return this.roots[0]!;
  }

  private validateInput(p: unknown): string {
    if (typeof p !== "string" || p.length === 0) throw new UserError("path must be a non-empty string, relative to the allowed folder.");
    if (p.length > CAPS.maxPathChars) throw new UserError(`path is longer than ${CAPS.maxPathChars} characters.`);
    if (p.includes("\0")) throw new UserError("path contains a NUL character.");
    return p;
  }

  /** Lexically resolves a path against the roots (no filesystem access). */
  lexical(p: string, baseDir?: string): { abs: string; root: Root; rel: string } | null {
    const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(baseDir ?? this.primary.real, p);
    // The agent may pass the root in another form: as given (for example through a
    // symlinked path), in another case, or as the OS spells it (long names on Windows).
    // Always rebase onto the form the server opens: Node's permission model compares
    // paths as plain, case-sensitive strings and does not expand 8.3 names.
    for (const root of this.roots) {
      for (const form of [root.real, root.canon, path.resolve(root.given)]) {
        const rel = within(form, abs);
        if (rel !== null) return { abs: path.join(root.real, rel), root, rel: toPosix(rel) };
      }
    }
    return null;
  }

  /**
   * Maps a realpath (from fs.realpath, which is native and returns long names on
   * Windows) to the root that contains it, rebased onto the form the server opens.
   */
  private contain(real: string): Resolved | null {
    for (const root of this.roots) {
      for (const form of [root.canon, root.real]) {
        const rel = within(form, real);
        if (rel !== null) return { real: rel ? path.join(root.real, rel) : root.real, rel: toPosix(rel), root };
      }
    }
    return null;
  }

  /** Resolves symlinks and confirms the real path is inside a root. Does not apply the file-type policy. */
  async resolveReal(p: string, baseDir?: string): Promise<Resolved> {
    const input = this.validateInput(p);
    const lex = this.lexical(input, baseDir);
    if (!lex) throw new UserError(`Refused: ${input} is outside the allowed folder ${this.primary.real}.`);
    let real: string;
    try {
      real = await fsp.realpath(lex.abs);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | null)?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        const fe = fsError(e, input);
        if (fe) throw fe;
      }
      throw new UserError(`File not found: ${input} (inside ${lex.root.real}). Paths are relative to that folder; find_steering_files lists the steering files.`);
    }
    const inside = this.contain(real);
    if (inside) return inside;
    throw new UserError(`Refused: ${input} is a symlink that resolves outside the allowed folder.`);
  }

  /** Opens a markdown or steering file read-only, with every check applied. */
  async open(p: string, baseDir?: string): Promise<OpenedFile> {
    return this.openChecked(p, baseDir, (rel) => policyRefusal(rel), () => this.maxFileBytes, " (raise it with --max-file-mb)");
  }

  /**
   * Opens a file of another read class (see ReadClass) read-only. The shared refusals apply first,
   * then the class policy, to the path as asked and to the real path. headBytes reads only the start
   * of the file (magic-byte checks) and then the size limit does not apply.
   */
  async openAs(readClass: ReadClass, p: string, opts: { baseDir?: string; headBytes?: number; grants?: ReadonlySet<string> } = {}): Promise<OpenedFile> {
    if (readClass === "markdown") return this.open(p, opts.baseDir);
    const policy = READ_POLICIES[readClass];
    const ctx: PolicyContext = { sandbox: this, grants: opts.grants ?? new Set() };
    const refuse = async (rel: string): Promise<string | null> => commonRefusal(rel) ?? (await policy.refusal(rel, ctx));
    const limit = (rel: string): number => Math.min(policy.maxBytesFor?.(rel) ?? policy.maxBytes, this.maxFileBytes);
    return this.openChecked(p, opts.baseDir, refuse, limit, ` for ${policy.label}`, opts.headBytes);
  }

  private async openChecked(
    p: string,
    baseDir: string | undefined,
    refuse: (relPosix: string) => string | null | Promise<string | null>,
    maxBytesFor: (relPosix: string) => number,
    limitHint: string,
    headBytes?: number,
  ): Promise<OpenedFile> {
    const input = this.validateInput(p);
    const lex = this.lexical(input, baseDir);
    if (lex) {
      const early = await refuse(lex.rel || path.basename(lex.abs));
      if (early) throw new UserError(`Refused: ${early}.`);
    }
    const r = await this.resolveReal(input, baseDir);
    const refusal = await refuse(r.rel);
    if (refusal) throw new UserError(`Refused: ${refusal}${r.rel !== lex?.rel ? ` (resolved from ${input})` : ""}.`);
    let before: Awaited<ReturnType<typeof fsp.stat>>;
    try {
      before = await fsp.stat(r.real);
    } catch (e) {
      throw fsError(e, input) ?? new UserError(`File not found: ${input}. It may have been moved or deleted just now.`);
    }
    if (!before.isFile()) throw new UserError(`Not a regular file: ${input}.`);
    const head = headBytes !== undefined;
    const maxBytes = maxBytesFor(r.rel);
    if (!head && before.size > maxBytes) {
      throw new UserError(`File too large: ${input} is ${mb(before.size)}; the limit is ${mb(maxBytes)}${limitHint}.`);
    }
    // O_NOFOLLOW refuses a final-component symlink swapped in after realpath;
    // the dev/ino comparison catches a swapped regular file.
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
    let fh: fsp.FileHandle;
    try {
      fh = await fsp.open(r.real, flags);
    } catch (e) {
      throw fsError(e, input) ?? new UserError(`Could not open ${input} for reading.`);
    }
    try {
      const st = await fh.stat();
      if (st.ino !== before.ino || st.dev !== before.dev || !st.isFile()) throw new UserError(`Refused: ${input} changed while it was being opened.`);
      if (!head && st.size > maxBytes) throw new UserError(`File too large: ${input} is ${mb(st.size)}; the limit is ${mb(maxBytes)}${limitHint}.`);
      const want = head ? Math.min(st.size, Math.max(0, headBytes)) : st.size;
      const buf = Buffer.alloc(want);
      let off = 0;
      while (off < want) {
        const { bytesRead } = await fh.read(buf, off, want - off, off);
        if (bytesRead === 0) break;
        off += bytesRead;
      }
      const out: OpenedFile = { ...r, buf: off === want ? buf : buf.subarray(0, off), stat: st };
      // Reached through a symlink: classify by the linked path, keep the real one for messages.
      if (lex && lex.rel && lex.root === r.root && lex.rel.toLowerCase() !== r.rel.toLowerCase()) {
        out.linkTarget = r.rel;
        out.rel = lex.rel;
        out.lexical = lex.abs;
      }
      return out;
    } finally {
      await fh.close();
    }
  }

  /**
   * Lists one folder inside a root without following symlinks and without reading any file.
   * For checks that need files the steering walk skips (scripts in a skill folder). Refuses
   * .git and node_modules; at most CAPS.walkMaxEntries entries are returned.
   */
  async listDir(p: string, baseDir?: string): Promise<{ rel: string; entries: Array<{ name: string; type: "file" | "dir" | "symlink" | "other" }>; truncated: boolean }> {
    const r = await this.resolveReal(p, baseDir);
    const parts = r.rel.toLowerCase().split("/");
    if (parts.includes(".git") || parts.includes("node_modules")) throw new UserError(`Refused: ${r.rel} is inside .git or node_modules; this server does not list them.`);
    let dirents;
    try {
      dirents = await fsp.readdir(r.real, { withFileTypes: true });
    } catch (e) {
      throw fsError(e, p) ?? new UserError(`Could not list ${p}.`);
    }
    const entries = dirents.slice(0, CAPS.walkMaxEntries).map((d) => ({
      name: d.name,
      type: d.isSymbolicLink() ? ("symlink" as const) : d.isDirectory() ? ("dir" as const) : d.isFile() ? ("file" as const) : ("other" as const),
    }));
    return { rel: r.rel, entries, truncated: dirents.length > entries.length };
  }

  /**
   * Checks whether a link or import target exists without reading it.
   * Targets outside the roots are reported, never touched.
   */
  async probe(target: string, baseDir: string): Promise<{ state: "ok" | "missing" | "outside"; size?: number; real?: string; rel?: string }> {
    const lex = this.lexical(target, baseDir);
    if (!lex) return { state: "outside" };
    let real: string;
    try {
      real = await fsp.realpath(lex.abs);
    } catch {
      return { state: "missing" };
    }
    const inside = this.contain(real);
    if (!inside) return { state: "outside" };
    const st = await fsp.stat(inside.real).catch(() => null);
    return st ? { state: "ok", size: st.isFile() ? st.size : 0, real: inside.real, rel: inside.rel } : { state: "missing" };
  }

  /** Display path of an opened file: the path as the agent tools see it, and where a symlink points. */
  displayFile(f: OpenedFile): string {
    if (!f.lexical || !f.linkTarget) return this.display(f.real);
    return `${this.display(f.lexical)} (symlink to ${f.linkTarget})`;
  }

  /** Root-relative display path for a real path inside a root. */
  display(real: string): string {
    for (const root of this.roots) {
      const rel = within(root.real, real);
      if (rel !== null) return this.roots.length > 1 && root !== this.primary ? path.join(root.real, rel) : toPosix(rel);
    }
    return real;
  }
}
