// Tests for the Claude Code PreToolUse accident guard (plugins/asitis/hooks/guard.mjs).
// Covers known bypasses: Edit and MultiEdit are
// checked, malformed input fails closed, and relative paths use the session cwd.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AGENTIC, FIXTURE_REPO, FIXTURES, PLUGIN, tempDir } from "./helpers.js";

const HOOK = path.join(PLUGIN, "hooks/guard.mjs");
const CRLF_BOM_SKILL = path.join(AGENTIC, "crlf-bom-skill/SKILL.md");
const CRLF_MDC = path.join(FIXTURE_REPO, ".cursor/rules/windows-crlf-bom.mdc");
const LF_SKILL = path.join(FIXTURE_REPO, ".claude/skills/pdf-export/SKILL.md");

interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
  json: Record<string, any> | null;
  ms: number;
}

function runHook(input: unknown, env: Record<string, string> = {}): HookRun {
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  const t0 = performance.now();
  const clean = { ...process.env };
  delete clean["ASITIS_GUARD_MODE"];
  delete clean["CLAUDE_PLUGIN_OPTION_GUARD_MODE"];
  const r = spawnSync(process.execPath, [HOOK], { input: raw, encoding: "utf8", env: { ...clean, ...env }, timeout: 15_000 });
  const ms = performance.now() - t0;
  let json: Record<string, any> | null = null;
  try {
    json = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  } catch {
    json = null;
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json, ms };
}

const pre = (tool_name: string, tool_input: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  session_id: "test",
  cwd: FIXTURE_REPO,
  hook_event_name: "PreToolUse",
  tool_name,
  tool_input,
  tool_use_id: "toolu_test",
  ...extra,
});

const asks = (r: HookRun, re: RegExp): void => {
  expect(r.status, r.stderr).toBe(0);
  expect(r.json?.["hookSpecificOutput"]?.["permissionDecision"]).toBe("ask");
  expect(r.json?.["hookSpecificOutput"]?.["permissionDecisionReason"]).toMatch(re);
  expect(r.json?.["systemMessage"]).toMatch(/not a security boundary/);
};
const passes = (r: HookRun): void => {
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout.trim()).toBe("");
};
const failsClosed = (r: HookRun, re: RegExp): void => {
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/^AsItIs guard: /);
  expect(r.stderr).toMatch(re);
  expect(r.stderr).toMatch(/blocked to be safe/);
};

describe("Write", () => {
  test("converting CRLF to LF asks first", () => {
    const before = readFileSync(CRLF_MDC, "utf8");
    asks(runHook(pre("Write", { file_path: CRLF_MDC, content: before.replace(/\r\n/g, "\n") })), /converts 6 CRLF line endings to LF/);
  });
  test("a Write without the BOM passes, because Claude Code's Write keeps the file's BOM", () => {
    const before = readFileSync(CRLF_BOM_SKILL, "utf8");
    passes(runHook(pre("Write", { file_path: CRLF_BOM_SKILL, content: before.slice(1) })));
  });
  test("stripping trailing spaces asks first", () => {
    const before = readFileSync(CRLF_BOM_SKILL, "utf8");
    asks(runHook(pre("Write", { file_path: CRLF_BOM_SKILL, content: before.replace("hard break  \r\n", "hard break\r\n") })), /strips trailing whitespace on 1 line/);
  });
  test("breaking frontmatter asks first", () => {
    const before = readFileSync(LF_SKILL, "utf8");
    asks(runHook(pre("Write", { file_path: LF_SKILL, content: before.replace("---\n# PDF export", "# PDF export") })), /frontmatter without its closing ---/);
    asks(runHook(pre("Write", { file_path: LF_SKILL, content: "\n" + before })), /moves the frontmatter off line 1/);
  });
  test("dropping the final newline asks first", () => {
    const before = readFileSync(LF_SKILL, "utf8");
    asks(runHook(pre("Write", { file_path: LF_SKILL, content: before.trimEnd() })), /drops the final newline/);
  });
  test("flattening mixed line endings and removing lone CRs asks first", () => {
    const mixed = path.join(FIXTURES, "encodings/mixed-eol.md");
    asks(runHook(pre("Write", { file_path: mixed, content: readFileSync(mixed, "utf8").replace(/\r\n?/g, "\n") })), /CRLF line ending|flattens mixed line endings/);
    const lone = path.join(FIXTURES, "encodings/lone-cr.md");
    asks(runHook(pre("Write", { file_path: lone, content: readFileSync(lone, "utf8").replace(/\r(?!\n)/g, "\n") })), /lone CR/);
  });
  test("a byte-identical Write passes silently", () => {
    passes(runHook(pre("Write", { file_path: CRLF_BOM_SKILL, content: readFileSync(CRLF_BOM_SKILL, "utf8") })));
  });
  test("a Write that changes one word and nothing else passes", () => {
    const before = readFileSync(CRLF_BOM_SKILL, "utf8");
    passes(runHook(pre("Write", { file_path: CRLF_BOM_SKILL, content: before.replace("stay exactly", "remain exactly") })));
  });
  test("new files and non-markdown files are not checked", () => {
    passes(runHook(pre("Write", { file_path: path.join(FIXTURE_REPO, "brand-new.md"), content: "x" })));
    passes(runHook(pre("Write", { file_path: path.join(FIXTURE_REPO, ".claude/settings.json"), content: "{}" })));
  });
  test("a large rewrite of an existing file asks first", () => {
    const t = tempDir("asitis-hook-");
    try {
      const f = path.join(t.dir, "notes.md");
      writeFileSync(f, Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") + "\n");
      asks(runHook(pre("Write", { file_path: f, content: Array.from({ length: 40 }, (_, i) => `Line ${i}.`).join("\n") + "\n" })), /rewrites 100% of the 40 existing lines/);
    } finally {
      t.cleanup();
    }
  });
});

describe("Edit and MultiEdit, not only Write", () => {
  test("a minimal Edit on a CRLF + BOM file passes", () => {
    passes(runHook(pre("Edit", { file_path: CRLF_BOM_SKILL, old_string: "stay exactly", new_string: "remain exactly" })));
  });
  test("an Edit whose LF old_string matches CRLF text is assumed to keep CRLF", () => {
    passes(runHook(pre("Edit", { file_path: CRLF_MDC, old_string: "Use backslashes in Windows paths.  \nKeep", new_string: "Use backslashes in Windows paths.  \nAlways keep" })));
  });
  test("an Edit that swaps a literal CRLF for LF cannot change line endings (Claude Code re-applies the file's style)", () => {
    passes(runHook(pre("Edit", { file_path: CRLF_MDC, old_string: "paths.  \r\nKeep", new_string: "paths.  \nKeep" })));
  });
  test("an Edit that strips trailing spaces asks first", () => {
    asks(runHook(pre("Edit", { file_path: CRLF_BOM_SKILL, old_string: "hard break  ", new_string: "hard break" })), /strips trailing whitespace/);
  });
  test("an Edit that removes the opening --- asks first", () => {
    asks(runHook(pre("Edit", { file_path: LF_SKILL, old_string: "---\nname: pdf-export", new_string: "name: pdf-export" })), /frontmatter/);
  });
  test("an Edit that drops the BOM asks first", () => {
    asks(runHook(pre("Edit", { file_path: CRLF_BOM_SKILL, old_string: "﻿---", new_string: "---" })), /byte order mark/);
  });
  test("replace_all is simulated", () => {
    asks(runHook(pre("Edit", { file_path: CRLF_BOM_SKILL, old_string: "  \n", new_string: "\n", replace_all: true })), /strips trailing whitespace/);
    passes(runHook(pre("Edit", { file_path: CRLF_MDC, old_string: "\r\n", new_string: "\n", replace_all: true })));
  });
  test("MultiEdit applies edits in order and asks if any breaks the file", () => {
    asks(
      runHook(pre("MultiEdit", { file_path: CRLF_BOM_SKILL, edits: [{ old_string: "stay exactly", new_string: "remain exactly" }, { old_string: "hard break  ", new_string: "hard break" }] })),
      /strips trailing whitespace/,
    );
    passes(runHook(pre("MultiEdit", { file_path: CRLF_BOM_SKILL, edits: [{ old_string: "stay exactly", new_string: "remain exactly" }] })));
  });
  test("an Edit whose old_string is not in the file is left to the tool", () => {
    passes(runHook(pre("Edit", { file_path: LF_SKILL, old_string: "not in the file", new_string: "x" })));
  });
  test("files with invalid UTF-8 bytes are flagged on any text edit", () => {
    const f = path.join(FIXTURES, "encodings/invalid-utf8.md");
    const text = readFileSync(f, "utf8");
    const word = /[A-Za-z]{3,}/.exec(text)![0];
    asks(runHook(pre("Edit", { file_path: f, old_string: word, new_string: word.toUpperCase() })), /invalid UTF-8/);
  });
  test("relative paths resolve against the session cwd from the hook input", () => {
    const before = readFileSync(CRLF_MDC, "utf8");
    asks(runHook(pre("Write", { file_path: ".cursor/rules/windows-crlf-bom.mdc", content: before.replace(/\r\n/g, "\n") })), /converts 6 CRLF/);
  });
  test("other tools are ignored", () => {
    passes(runHook(pre("Read", { file_path: CRLF_MDC })));
    passes(runHook(pre("Bash", { command: "sed -i '' s/a/b/ notes.md" })));
  });
});

describe("modes", () => {
  const bad = () => pre("Write", { file_path: CRLF_MDC, content: readFileSync(CRLF_MDC, "utf8").replace(/\r\n/g, "\n") });
  test("deny blocks and tells the agent how to retry", () => {
    const r = runHook(bad(), { CLAUDE_PLUGIN_OPTION_GUARD_MODE: "deny" });
    expect(r.status).toBe(0);
    expect(r.json?.["hookSpecificOutput"]).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
    expect(r.json?.["hookSpecificOutput"]["permissionDecisionReason"]).toMatch(/Retry with an Edit/);
  });
  test("off disables the guard, even for malformed input", () => {
    passes(runHook(bad(), { ASITIS_GUARD_MODE: "off" }));
    passes(runHook("not json", { CLAUDE_PLUGIN_OPTION_GUARD_MODE: "off" }));
  });
  test("ask is the default and adds context for the agent", () => {
    const r = runHook(bad());
    expect(r.json?.["hookSpecificOutput"]["additionalContext"]).toMatch(/Retry with an Edit/);
  });
});

describe("fails closed on malformed input", () => {
  test.each([
    ["not json", /not valid JSON/],
    ["", /not valid JSON/],
    ["[1,2]", /not a JSON object/],
    ["{}", /no tool_name/],
    ["null", /not a JSON object/],
  ])("stdin %j", (raw, re) => failsClosed(runHook(raw), re));
  test("missing tool_input", () => failsClosed(runHook({ tool_name: "Write" }), /no tool_input/));
  test("missing file_path", () => failsClosed(runHook(pre("Edit", { old_string: "a", new_string: "b" })), /no file_path/));
  test("Write without content", () => failsClosed(runHook(pre("Write", { file_path: LF_SKILL })), /no string content/));
  test("Edit with a non-string new_string", () => failsClosed(runHook(pre("Edit", { file_path: LF_SKILL, old_string: "PDF", new_string: 7 })), /string old_string and new_string/));
  test("MultiEdit without an edits array", () => failsClosed(runHook(pre("MultiEdit", { file_path: LF_SKILL, edits: "x" })), /no edits array/));
});

describe("performance", () => {
  let t: ReturnType<typeof tempDir>;
  let big: string;
  beforeAll(() => {
    t = tempDir("asitis-hook-perf-");
    big = path.join(t.dir, "big.md");
    writeFileSync(big, "| a | b |  \r\n".repeat(400_000)); // about 5 MB, CRLF, trailing spaces
  });
  afterAll(() => t.cleanup());
  test("a 5 MB file is checked in under 3 s", () => {
    const content = readFileSync(big, "utf8").replace(/\r\n/g, "\n");
    const r = runHook(pre("Write", { file_path: big, content }));
    expect(r.json?.["hookSpecificOutput"]["permissionDecision"]).toBe("ask");
    expect(r.ms).toBeLessThan(3000);
  });
});

// Claude Code's Edit normalises CRLF to LF, applies the edit, and writes every line
// break back in one style picked from the first 4,096 characters (read from the
// Claude Code 2.1.285 binary). The guard must warn when that rewrites line endings.
describe("Edit line endings, the way Claude Code writes them", () => {
  let t: ReturnType<typeof tempDir>;
  beforeAll(() => {
    t = tempDir("asitis-hook-eol-");
  });
  afterAll(() => t.cleanup());
  const file = (name: string, content: string): string => {
    const f = path.join(t.dir, name);
    writeFileSync(f, content);
    return f;
  };

  test("a one-word Edit to a mixed-EOL file asks, because every break is rewritten", () => {
    const mixed = path.join(FIXTURES, "encodings/mixed-eol.md");
    asks(runHook(pre("Edit", { file_path: mixed, old_string: "line two", new_string: "line 2" })), /CRLF line ending|flattens mixed line endings/);
  });
  test("a mostly-CRLF file with one LF line asks too", () => {
    const f = file("mostly-crlf.md", "# Title\r\none\r\ntwo\r\nthree\nfour\r\n");
    asks(runHook(pre("Edit", { file_path: f, old_string: "one", new_string: "uno" })), /flattens mixed line endings|adds 1 CRLF/);
  });
  test("a CRLF file whose first 4,096 characters have no line break is rewritten to LF, and the guard says so", () => {
    const f = file("long-first-line.md", "x".repeat(5000) + "\r\nsecond\r\nthird\r\n");
    asks(runHook(pre("Edit", { file_path: f, old_string: "second", new_string: "2nd" })), /converts 3 CRLF line endings to LF/);
  });
  test("an all-CRLF and an all-LF file keep their style, so a text Edit passes", () => {
    passes(runHook(pre("Edit", { file_path: file("crlf.md", "# T\r\na\r\nb\r\n"), old_string: "a", new_string: "A" })));
    passes(runHook(pre("Edit", { file_path: file("lf.md", "# T\na\nb\n"), old_string: "a", new_string: "A" })));
  });
});

describe("guard_mode", () => {
  const mixed = path.join(FIXTURES, "encodings/mixed-eol.md");
  const edit = pre("Edit", { file_path: mixed, old_string: "line two", new_string: "line 2" });
  test.each([["Denied"], ["block"], ["yes"]])("unknown mode %j is treated as deny and warns", (m) => {
    const r = runHook(edit, { ASITIS_GUARD_MODE: m });
    expect(r.status, r.stderr).toBe(0);
    expect(r.json?.["hookSpecificOutput"]?.["permissionDecision"]).toBe("deny");
    expect(r.json?.["systemMessage"]).toMatch(/Unknown ASITIS_GUARD_MODE value .* uses deny, the safest mode/);
  });
  test("an unknown mode still warns when the edit is clean", () => {
    const r = runHook(pre("Edit", { file_path: LF_SKILL, old_string: "PDF export", new_string: "PDF export" }), { CLAUDE_PLUGIN_OPTION_GUARD_MODE: "strict" });
    expect(r.status).toBe(0);
    expect(r.json?.["hookSpecificOutput"]).toBeUndefined();
    expect(r.json?.["systemMessage"]).toMatch(/Unknown CLAUDE_PLUGIN_OPTION_GUARD_MODE value "strict"/);
  });
  test("the three documented modes are accepted as is", () => {
    expect(runHook(edit, { ASITIS_GUARD_MODE: "ask" }).json?.["hookSpecificOutput"]?.["permissionDecision"]).toBe("ask");
    expect(runHook(edit, { ASITIS_GUARD_MODE: " DENY " }).json?.["hookSpecificOutput"]?.["permissionDecision"]).toBe("deny");
    passes(runHook(edit, { ASITIS_GUARD_MODE: "off" }));
  });
});

describe("fails closed instead of timing out", () => {
  let t: ReturnType<typeof tempDir>;
  let big: string;
  beforeAll(() => {
    t = tempDir("asitis-hook-time-");
    big = path.join(t.dir, "big.md");
    // About 1 MB, CRLF, trailing spaces. The budget is lowered to 1 ms, so the size does not
    // matter for the outcome; a small file keeps the run fast on a busy machine.
    writeFileSync(big, "| a | b |  \r\n".repeat(80_000));
  });
  afterAll(() => t.cleanup());
  test("over its budget the guard asks (ask mode) or blocks (deny mode); it never lets the change through", () => {
    const e = pre("Edit", { file_path: big, old_string: "| a |", new_string: "| A |" });
    const r = runHook(e, { ASITIS_GUARD_BUDGET_MS: "1" });
    asks(r, /could not be checked within 1 ms/);
    const d = runHook(e, { ASITIS_GUARD_BUDGET_MS: "1", ASITIS_GUARD_MODE: "deny" });
    expect(d.json?.["hookSpecificOutput"]?.["permissionDecision"]).toBe("deny");
  });
  // Deterministic: the budget is lowered through ASITIS_GUARD_BUDGET_MS (which can only
  // lower it) and is counted from process start, so the budget is always spent before
  // the first check, whatever the machine speed. No wall-clock assertion.
  test("a MultiEdit too large to check answers on its own budget instead of finishing the check", () => {
    const f = path.join(t.dir, "clean.md");
    writeFileSync(f, "| a | b |\r\n".repeat(30_000)); // about 300 KB, CRLF, no trailing spaces: a clean edit
    const edits = Array.from({ length: 200 }, (_, i) => ({ old_string: "| a |", new_string: `| a${i} |` }));
    const e = pre("MultiEdit", { file_path: f, edits });
    passes(runHook(e)); // within the default budget the same MultiEdit is checked and clean
    asks(runHook(e, { ASITIS_GUARD_BUDGET_MS: "1" }), /MultiEdit on clean\.md could not be checked within 1 ms/);
    const d = runHook(e, { ASITIS_GUARD_BUDGET_MS: "1", ASITIS_GUARD_MODE: "deny" });
    expect(d.status, d.stderr).toBe(0);
    expect(d.json?.["hookSpecificOutput"]?.["permissionDecision"]).toBe("deny");
    expect(d.json?.["hookSpecificOutput"]?.["permissionDecisionReason"]).toMatch(/could not be checked within 1 ms/);
  });
  test("an invalid override falls back to the default budget instead of disabling the check", () => {
    const f = path.join(t.dir, "small.md");
    writeFileSync(f, "# T\r\na\r\nb\r\n");
    const e = pre("Edit", { file_path: f, old_string: "a", new_string: "A" });
    for (const v of ["0", "-5", "abc", ""]) passes(runHook(e, { ASITIS_GUARD_BUDGET_MS: v }));
  });
  test("the default budget leaves at least 3 s of the 10 s hook timeout for start-up and the last unchecked step", () => {
    const src = readFileSync(HOOK, "utf8");
    const m = /const DEFAULT_BUDGET_MS = (\d+);/.exec(src);
    expect(m).not.toBeNull();
    const budget = Number(m![1]);
    const hooks = JSON.parse(readFileSync(path.join(PLUGIN, "hooks/hooks.json"), "utf8"));
    const timeoutS = hooks.hooks.PreToolUse[0].hooks[0].timeout as number;
    expect(timeoutS).toBe(10);
    expect(budget).toBe(6000);
    expect(timeoutS * 1000 - budget).toBeGreaterThanOrEqual(3000);
    // The budget counts from process start, so node start-up is inside it.
    expect(src).toMatch(/const STARTED = Date\.now\(\) - Math\.round\(process\.uptime\(\) \* 1000\);/);
  });
  test("a file over 16 MB is not waved through unchecked", () => {
    const f = path.join(t.dir, "over.md");
    writeFileSync(f, "x".repeat(17 * 1024 * 1024));
    asks(runHook(pre("Edit", { file_path: f, old_string: "xx", new_string: "y" })), /larger than 16 MB/);
  });
});
