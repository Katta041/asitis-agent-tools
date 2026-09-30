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
    asks(runHook(pre("Write", { file_path: CRLF_MDC, content: before.replace(/\r\n/g, "\n") })), /converts 6 CRLF line ending\(s\) to LF/);
  });
  test("dropping the BOM asks first", () => {
    const before = readFileSync(CRLF_BOM_SKILL, "utf8");
    asks(runHook(pre("Write", { file_path: CRLF_BOM_SKILL, content: before.slice(1) })), /removes the byte order mark/);
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
  test("an Edit that replaces a literal CRLF with LF asks first", () => {
    asks(runHook(pre("Edit", { file_path: CRLF_MDC, old_string: "paths.  \r\nKeep", new_string: "paths.  \nKeep" })), /converts 1 CRLF/);
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
    asks(runHook(pre("Edit", { file_path: CRLF_MDC, old_string: "\r\n", new_string: "\n", replace_all: true })), /converts 6 CRLF/);
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
