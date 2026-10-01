// Root confinement and file-type policy. Every file this server touches goes
// through Sandbox. The server has no write path at all; this module only opens
// files read-only.

import { constants, promises as fsp, type Stats } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CAPS } from "./limits.js";

export class UserError extends Error {
  override readonly name = "UserError";
}

export const MARKDOWN_EXTENSIONS = [".md", ".mdc", ".markdown", ".mdx"] as const;
/** Steering files without a markdown extension that are still read. */
export const EXTENSIONLESS_STEERING = [".cursorrules", ".windsurfrules", ".clinerules"] as const;

export interface Root {
  /** The path as given at startup (for messages). */
  given: string;
  /** realpath of the root. */
  real: string;
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
}

const toPosix = (p: string): string => p.split(path.sep).join("/");

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
    return `${relPosix} is not a markdown file; this server only reads ${MARKDOWN_EXTENSIONS.join(", ")} and ${EXTENSIONLESS_STEERING.join(", ")}`;
  }
  return null;
}

/** Reserved DOS device names, with or without an extension (compared case-insensitively). */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$) *(\..*)?$/i;

export interface SandboxOptions {
  allowBroadRoot?: boolean;
  maxFileBytes?: number;
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
    const homes = new Set<string>([path.resolve(os.homedir())]);
    try {
      homes.add(await fsp.realpath(os.homedir()));
    } catch {
      // not readable; the lexical path is enough
    }
    for (const g of given) {
      let real: string;
      try {
        real = await fsp.realpath(path.resolve(g));
      } catch {
        throw new UserError(`Root folder not found: ${g}. Pass an existing folder with --root.`);
      }
      const st = await fsp.stat(real);
      if (!st.isDirectory()) throw new UserError(`Root is not a folder: ${g}. Pass a folder with --root.`);
      if (!opts.allowBroadRoot) {
        if (path.parse(real).root === real) throw new UserError(`Refusing the filesystem root (${real}) as the allowed folder. Pass your project folder with --root, or add --allow-broad-root.`);
        if (homes.has(real)) throw new UserError(`Refusing your home folder (${real}) as the allowed folder. Pass your project folder with --root, or add --allow-broad-root.`);
      }
      roots.push({ given: g, real });
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
    for (const root of this.roots) {
      const rel = within(root.real, abs);
      if (rel !== null) return { abs, root, rel: toPosix(rel) };
    }
    // The agent may pass the root as given (for example through a symlinked path).
    for (const root of this.roots) {
      const givenAbs = path.resolve(root.given);
      const rel = within(givenAbs, abs);
      if (rel !== null) return { abs: path.join(root.real, rel), root, rel: toPosix(rel) };
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
    } catch {
      throw new UserError(`File not found: ${input} (inside ${lex.root.real}).`);
    }
    for (const root of this.roots) {
      const rel = within(root.real, real);
      if (rel !== null) return { real, rel: toPosix(rel), root };
    }
    throw new UserError(`Refused: ${input} is a symlink that resolves outside the allowed folder.`);
  }

  /** Opens a markdown or steering file read-only, with every check applied. */
  async open(p: string, baseDir?: string): Promise<OpenedFile> {
    const input = this.validateInput(p);
    const lex = this.lexical(input, baseDir);
    if (lex) {
      const early = policyRefusal(lex.rel || path.basename(lex.abs));
      if (early) throw new UserError(`Refused: ${early}.`);
    }
    const r = await this.resolveReal(input, baseDir);
    const refusal = policyRefusal(r.rel);
    if (refusal) throw new UserError(`Refused: ${refusal}${r.rel !== lex?.rel ? ` (resolved from ${input})` : ""}.`);
    const before = await fsp.stat(r.real);
    if (!before.isFile()) throw new UserError(`Not a regular file: ${input}.`);
    if (before.size > this.maxFileBytes) {
      throw new UserError(`File too large: ${input} is ${before.size} bytes; the limit is ${this.maxFileBytes} bytes (--max-file-mb).`);
    }
    // O_NOFOLLOW refuses a final-component symlink swapped in after realpath;
    // the dev/ino comparison catches a swapped regular file.
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
    let fh: fsp.FileHandle;
    try {
      fh = await fsp.open(r.real, flags);
    } catch {
      throw new UserError(`Could not open ${input} for reading.`);
    }
    try {
      const st = await fh.stat();
      if (st.ino !== before.ino || st.dev !== before.dev || !st.isFile()) throw new UserError(`Refused: ${input} changed while it was being opened.`);
      if (st.size > this.maxFileBytes) throw new UserError(`File too large: ${input} is ${st.size} bytes; the limit is ${this.maxFileBytes} bytes.`);
      const buf = Buffer.alloc(st.size);
      let off = 0;
      while (off < st.size) {
        const { bytesRead } = await fh.read(buf, off, st.size - off, off);
        if (bytesRead === 0) break;
        off += bytesRead;
      }
      return { ...r, buf: off === st.size ? buf : buf.subarray(0, off), stat: st };
    } finally {
      await fh.close();
    }
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
    for (const root of this.roots) {
      const rel = within(root.real, real);
      if (rel !== null) {
        const st = await fsp.stat(real).catch(() => null);
        return st ? { state: "ok", size: st.isFile() ? st.size : 0, real, rel: toPosix(rel) } : { state: "missing" };
      }
    }
    return { state: "outside" };
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
