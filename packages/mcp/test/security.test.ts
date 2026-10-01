// Regression tests for path traversal, symlink escape, file-type scope, secret-file
// access and oversized input, plus the "no writes at all" guarantee.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { policyRefusal, Sandbox } from "../src/paths.js";
import { connect, tempDir, type Connected } from "./helpers.js";

const SECRET = "SECRET_VALUE_7f3a";
let t: ReturnType<typeof tempDir>;
let root: string;
let outside: string;
let c: Connected;

const WIN = process.platform === "win32";
/** False when this machine cannot create file symlinks (Windows without Developer Mode or admin). */
let fileLinks = true;

const isEperm = (e: unknown): boolean => (e as NodeJS.ErrnoException).code === "EPERM";

/** File symlink; returns false when the OS refuses for lack of privilege. */
function linkFile(target: string, p: string): boolean {
  try {
    symlinkSync(target, p, "file");
    return true;
  } catch (e) {
    if (WIN && isEperm(e)) return false;
    throw e;
  }
}

/** Directory symlink, or a junction where symlinks need a privilege (junctions never do). */
function linkDir(target: string, p: string): void {
  try {
    symlinkSync(target, p, "dir");
  } catch (e) {
    if (!(WIN && isEperm(e))) throw e;
    symlinkSync(target, p, "junction");
  }
}

function put(p: string, content: string): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

beforeAll(async () => {
  t = tempDir();
  root = path.join(t.dir, "project");
  outside = path.join(t.dir, "outside");
  put(path.join(outside, "secret.md"), `# outside\n${SECRET}\n`);
  put(path.join(outside, "CLAUDE.md"), `# outside claude\n${SECRET}\n`);
  put(path.join(root, "README.md"), "# Project\n");
  put(path.join(root, "CLAUDE.md"), "# Instructions\n\n@.env\n@.claude/settings.json\n@../outside/secret.md\n");
  put(path.join(root, ".env"), `TOKEN=${SECRET}\n`);
  put(path.join(root, ".env.local"), `TOKEN=${SECRET}\n`);
  put(path.join(root, ".envrc"), `export TOKEN=${SECRET}\n`);
  put(path.join(root, ".claude/settings.json"), `{"hooks":{"SessionStart":[]},"x":"${SECRET}"}\n`);
  put(path.join(root, ".claude/settings.local.json"), `{"x":"${SECRET}"}\n`);
  put(path.join(root, ".mcp.json"), `{"x":"${SECRET}"}\n`);
  put(path.join(root, "package.json"), `{"x":"${SECRET}"}\n`);
  put(path.join(root, ".git/config"), `[core]\n${SECRET}\n`);
  put(path.join(root, ".git/notes.md"), `${SECRET}\n`);
  put(path.join(root, "node_modules/pkg/README.md"), `${SECRET}\n`);
  put(path.join(root, "big.md"), "x".repeat(4096));
  // A real non-markdown file outside the root (the Unix /etc/hosts case, on any OS).
  put(path.join(outside, "hosts"), `127.0.0.1 localhost ${SECRET}\n`);
  linkDir(outside, path.join(root, "link-dir"));
  fileLinks = linkFile(path.join(outside, "secret.md"), path.join(root, "link-file.md"));
  if (fileLinks) {
    linkFile(path.join(root, ".env"), path.join(root, "innocent.md"));
    linkFile(path.join(root, ".claude/settings.json"), path.join(root, "settings-alias.md"));
    linkFile(path.join(outside, "hosts"), path.join(root, "hosts.md"));
    linkFile(path.join(root, "README.md"), path.join(root, "readme-alias.md"));
  } else {
    // No file symlinks without the privilege: prove the same escapes through junctions.
    linkDir(path.join(root, ".claude"), path.join(root, "claude-alias"));
    linkDir(root, path.join(root, "self-alias"));
  }
  c = await connect([root], { maxFileBytes: 2048 });
});

afterAll(async () => {
  await c.close();
  t.cleanup();
});

const refused = async (p: string, pattern: RegExp): Promise<void> => {
  const r = await c.call("read_markdown", { path: p });
  expect(r.isError, `${p} should be refused`).toBe(true);
  expect(r.blocks[0]).toMatch(pattern);
  expect(r.text).not.toContain(SECRET);
};

describe("path traversal", () => {
  test.each([
    ["../outside/secret.md"],
    ["../../../../../../etc/hosts"],
    ["docs/../../outside/secret.md"],
  ])("%s is refused as outside the folder", async (p) => refused(p, /outside the allowed folder/));

  test("absolute path outside the root is refused", async () => refused(path.join(outside, "secret.md"), /outside the allowed folder/));
  test("absolute /etc/hosts is refused", async () => refused("/etc/hosts", /outside the allowed folder|not a markdown file/));
  test("URL-encoded traversal is just a missing file", async () => refused("..%2foutside%2fsecret.md", /File not found/));
  test("NUL in a path is rejected", async () => refused("README.md\0.md", /NUL/));
  test("an absolute path inside the root works", async () => {
    const r = await c.call("read_markdown", { path: path.join(root, "README.md") });
    expect(r.isError).toBe(false);
  });
});

describe("symlink escape", () => {
  // Where file symlinks need a privilege the process lacks, an attacker running as the same
  // user cannot create them either; the junction variants below cover the same escapes.
  test("symlinked file that resolves outside is refused", async () =>
    fileLinks ? refused("link-file.md", /symlink that resolves outside/) : refused("link-dir/secret.md", /symlink that resolves outside/));
  test("file inside a symlinked directory that resolves outside is refused", async () => refused("link-dir/secret.md", /symlink that resolves outside/));
  test("symlink to a non-markdown system file outside the root is refused", async () =>
    fileLinks ? refused("hosts.md", /outside|not a markdown file/) : refused("link-dir/hosts", /outside|not a markdown file/));
  test.skipIf(!fileLinks)("markdown-named symlink to .env is refused by the real path", async () => refused("innocent.md", /environment file/));
  test("markdown-named symlink to .claude/settings.json is refused by the real path", async () =>
    fileLinks ? refused("settings-alias.md", /settings file/) : refused("claude-alias/settings.json", /settings file/));
  test("a symlink that stays inside the root is allowed", async () => {
    const r = await c.call("read_markdown", { path: fileLinks ? "readme-alias.md" : "self-alias/README.md" });
    expect(r.isError).toBe(false);
    expect(r.blocks[1]).toBe("# Project\n");
  });
  test("discovery never follows symlinked folders", async () => {
    const r = await c.call("find_steering_files", {});
    expect(r.text).not.toContain("link-dir");
    expect(r.structured["skippedSymlinks"]).toBeGreaterThanOrEqual(2);
  });
});

describe("file-type scope: settings, secrets and non-markdown files", () => {
  test.each([
    [".env", /environment file/],
    [".env.local", /environment file/],
    [".envrc", /environment file/],
    [".ENV", /environment file/],
    [".claude/settings.json", /settings file/],
    [".claude/settings.local.json", /settings file/],
    [".mcp.json", /not a markdown file/],
    ["package.json", /not a markdown file/],
    [".git/config", /inside \.git/],
    [".git/notes.md", /inside \.git/],
    ["node_modules/pkg/README.md", /node_modules/],
  ])("%s is refused", async (p, re) => refused(p, re));

  test("refused files are refused by every tool, not only read_markdown", async () => {
    for (const tool of ["outline", "lint_steering", "context_budget"]) {
      const r = await c.call(tool, { path: ".claude/settings.json" });
      expect(r.isError, tool).toBe(true);
      expect(r.text).not.toContain(SECRET);
    }
    const multi = await c.call("lint_steering", { paths: [".env", "README.md"] });
    expect(multi.text).toMatch(/\.env: not linted/);
    expect(multi.text).not.toContain(SECRET);
  });

  test("imports of secrets and settings are estimated from size, never read", async () => {
    const r = await c.call("context_budget", { path: "CLAUDE.md" });
    expect(r.text).not.toContain(SECRET);
    expect(r.text).toMatch(/WARNING: a secrets or settings file is imported/);
    expect(r.text).toMatch(/outside the allowed folder, not counted/);
  });

  test("size cap refuses oversized files with an actionable message", async () => refused("big.md", /File too large: big\.md is 4096 bytes; the limit is 2048/));
});

describe("root confinement at startup", () => {
  test("the filesystem root is refused", async () => {
    await expect(Sandbox.create([path.parse(process.cwd()).root])).rejects.toThrow(/Refusing the filesystem root/);
  });
  test("the home folder is refused", async () => {
    await expect(Sandbox.create([os.homedir()])).rejects.toThrow(/Refusing your home folder/);
  });
  test("broad roots can be allowed explicitly", async () => {
    await expect(Sandbox.create([os.homedir()], { allowBroadRoot: true })).resolves.toBeInstanceOf(Sandbox);
  });
  test("a missing root is an actionable one-liner", async () => {
    await expect(Sandbox.create([path.join(t.dir, "nope")])).rejects.toThrow(/Root folder not found: .*Pass an existing folder with --root\./);
  });
  test("a file is not accepted as a root", async () => {
    await expect(Sandbox.create([path.join(root, "README.md")])).rejects.toThrow(/Root is not a folder/);
  });
});

describe("no writes at all", () => {
  function snapshot(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isSymbolicLink()) out.set(p, "link");
        else {
          const st = statSync(p);
          out.set(p, `${createHash("sha256").update(readFileSync(p)).digest("hex")} ${st.mtimeMs} ${st.mode}`);
        }
      }
      out.set(d, `dir ${readdirSync(d).length}`);
    };
    walk(dir);
    return out;
  }

  test("running every tool leaves the folder byte-identical, with no temp files", async () => {
    const before = snapshot(t.dir);
    for (const [name, args] of [
      ["find_steering_files", {}],
      ["lint_steering", {}],
      ["context_budget", {}],
      ["read_markdown", { path: "README.md" }],
      ["outline", { path: "CLAUDE.md" }],
      ["lint_steering", { path: "CLAUDE.md" }],
    ] as const) {
      await c.call(name, args as Record<string, unknown>);
    }
    expect(snapshot(t.dir)).toEqual(before);
  });

  test("hardlinks inside the root read the same file (documented residual: reads only, never writes)", async () => {
    linkSync(path.join(root, "README.md"), path.join(root, "hard.md"));
    const r = await c.call("read_markdown", { path: "hard.md" });
    expect(r.isError).toBe(false);
  });
});

// Windows path forms that could alias a file outside the root, or a refused file inside it.
// Every one must be refused (or not found) without ever returning the secret.
describe.runIf(WIN)("Windows path tricks", () => {
  const safe = async (p: string, pattern: RegExp = /Refused|File not found|not a markdown file/): Promise<void> => refused(p, pattern);
  /** 8.3 short path of an existing file or folder, or null when short names are off on this volume. */
  const shortPath = (p: string): string | null => {
    const kind = statSync(p).isDirectory() ? "GetFolder" : "GetFile";
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(New-Object -ComObject Scripting.FileSystemObject).${kind}('${p.replace(/'/g, "''")}').ShortPath`], {
      encoding: "utf8",
      timeout: 30_000,
    });
    const out = r.stdout?.trim();
    return r.status === 0 && out && out.toLowerCase() !== p.toLowerCase() ? out : null;
  };
  let longOutside: string;

  beforeAll(() => {
    symlinkSync(outside, path.join(root, "junction-dir"), "junction");
    longOutside = path.join(t.dir, "outside-with-a-long-name");
    put(path.join(longOutside, "secret-document.md"), `# outside\n${SECRET}\n`);
    writeFileSync(path.join(root, "README.md:hidden.md"), `${SECRET}\n`);
  });

  test("a junction to a folder outside the root is refused", async () => refused("junction-dir\\secret.md", /symlink that resolves outside/));
  test("discovery never follows junctions", async () => {
    const r = await c.call("find_steering_files", {});
    expect(r.text).not.toContain("junction-dir");
    expect(r.text).not.toContain(SECRET);
  });

  test.each([["..\\outside\\secret.md"], ["docs\\..\\..\\outside\\secret.md"], ["..\\OUTSIDE\\SECRET.MD"], ["..\\Project\\..\\outside\\secret.md"]])(
    "backslash and case-folded traversal %s is refused",
    async (p) => refused(p, /outside the allowed folder/),
  );
  test("case-folded absolute paths: inside works, outside is refused", async () => {
    const r = await c.call("read_markdown", { path: path.join(root.toUpperCase(), "README.MD") });
    expect(r.isError, r.text).toBe(false);
    await refused(path.join(outside.toUpperCase(), "SECRET.MD"), /outside the allowed folder/);
  });
  test.each([[".CLAUDE\\SETTINGS.JSON", /settings file/], [".Git\\notes.md", /inside \.git/], [".ENV.LOCAL", /environment file/], ["NODE_MODULES\\pkg\\README.md", /node_modules/]])(
    "case-folded refused file %s stays refused",
    async (p, re) => refused(p, re),
  );

  test("8.3 short names cannot alias an outside file or a refused file", async (ctx) => {
    const outShort = shortPath(path.join(longOutside, "secret-document.md"));
    const settingsShort = shortPath(path.join(root, ".claude", "settings.json"));
    if (!outShort && !settingsShort) ctx.skip(); // 8.3 names disabled on this volume
    if (outShort) {
      await safe(outShort);
      await safe(path.relative(root, outShort));
    }
    if (settingsShort) await safe(settingsShort, /settings file|not a markdown file|outside the allowed folder/);
  });

  test.each([["README.md:hidden.md"], ["README.md::$DATA"], ["README.md:hidden.md:$DATA"], [".env:x.md"], [".claude\\settings.json:x.md"], ["CLAUDE.md:$I30:$INDEX_ALLOCATION"]])(
    "alternate data stream %s is refused",
    async (p) => refused(p, /alternate data stream|environment file|not a markdown file/),
  );

  test.each([
    ["\\\\?\\" + "OUTSIDE_SECRET"],
    ["\\\\.\\" + "OUTSIDE_SECRET"],
    ["\\\\?\\" + "ROOT_DOTDOT"],
    ["\\\\?\\UNC\\localhost\\" + "DRIVE_SHARE"],
    ["\\\\localhost\\" + "DRIVE_SHARE"],
    ["\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1\\secret.md"],
    ["\\\\.\\PhysicalDrive0"],
  ])("device and UNC path %s is refused", async (template) => {
    const secret = path.join(outside, "secret.md");
    const p = template
      .replace("OUTSIDE_SECRET", secret)
      .replace("ROOT_DOTDOT", `${root}\\..\\outside\\secret.md`)
      .replace("DRIVE_SHARE", secret.replace(/^([A-Za-z]):/, "$1$"));
    await safe(p, /Refused|File not found|outside the allowed folder/);
  });

  test.each([[".. \\outside\\secret.md"], [".. .\\outside\\secret.md"], ["... \\outside\\secret.md"], ["link-dir.\\secret.md"], ["junction-dir \\secret.md"]])(
    "trailing dots and spaces in %s cannot escape",
    async (p) => safe(p),
  );
  test.each([[".env."], [".env "], [".claude.\\settings.json"], [".claude \\settings.json"], [".claude\\settings.json."], ["node_modules.\\pkg\\README.md"], [".git \\notes.md"]])(
    "trailing dots and spaces in %s do not unlock a refused file",
    async (p) => safe(p, /Refused|File not found/),
  );

  test.each([["CON"], ["con.md"], ["NUL.md"], ["aux.md"], ["COM1.md"], ["LPT1.md"], ["CONIN$"], ["docs\\PRN.md"]])(
    "reserved device name %s is refused without opening a device",
    async (p) => refused(p, /reserved Windows device name|not a markdown file/),
  );
});

// The Windows-only refusals are pure string checks, so they are exercised on every OS too.
describe("Windows path policy (checked on every OS)", () => {
  test.each([["README.md:hidden.md"], ["README.md::$DATA"], ["docs/a.md:x"], [".claude/settings.json:x.md"]])("%s is refused as a stream", (p) => {
    expect(policyRefusal(p, "win32")).toMatch(/alternate data stream/);
  });
  test.each([["CON"], ["con.md"], ["Nul.md"], ["aux.markdown"], ["COM9.md"], ["lpt1.md"], ["CONOUT$"], ["docs/PRN.md"], ["nul .md"], ["con.md."]])(
    "%s is refused as a device",
    (p) => expect(policyRefusal(p, "win32")).toMatch(/reserved Windows device name/),
  );
  test.each([["console.md"], ["docs/connect.md"], ["com10.md"], ["nullable.md"], ["README.md"]])("%s is an ordinary name", (p) => {
    expect(policyRefusal(p, "win32")).toBeNull();
  });
  test("other platforms keep colons (valid in Unix names)", () => expect(policyRefusal("a:b.md", "linux")).toBeNull());
});
