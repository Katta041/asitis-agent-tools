// Guard hook fixes from the 0.2.5 QA pass in real Claude Code sessions (2.1.299):
// F1 wrong advice when any Edit rewrites line endings, F2 old Node, F3 whole-file
// rewrites through Edit or MultiEdit, F4 small files, F5 hard breaks on changed lines,
// F6 Write keeps the BOM, F7 mode variables, F8 order-aware churn, and a deny reason
// that reads as a deliberate decision when Claude Code labels it "hook error".
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PLUGIN, tempDir } from "./helpers.js";

const HOOK = path.join(PLUGIN, "hooks/guard.mjs");

interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
  json: Record<string, any> | null;
}

function runHook(input: unknown, env: Record<string, string> = {}, node = process.execPath): HookRun {
  const clean = { ...process.env };
  delete clean["ASITIS_GUARD_MODE"];
  delete clean["CLAUDE_PLUGIN_OPTION_GUARD_MODE"];
  const r = spawnSync(node, [HOOK], { input: JSON.stringify(input), encoding: "utf8", env: { ...clean, ...env }, timeout: 15_000 });
  let json: Record<string, any> | null = null;
  try {
    json = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  } catch {
    json = null;
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

let t: ReturnType<typeof tempDir>;
beforeAll(() => {
  t = tempDir("asitis-guard-025-");
});
afterAll(() => t.cleanup());

const file = (name: string, content: string): string => {
  const f = path.join(t.dir, name);
  writeFileSync(f, content);
  return f;
};
const pre = (tool_name: string, tool_input: Record<string, unknown>) => ({ session_id: "t", cwd: t.dir, hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id: "toolu_t" });
const reason = (r: HookRun): string => String(r.json?.["hookSpecificOutput"]?.["permissionDecisionReason"] ?? "");
const context = (r: HookRun): string => String(r.json?.["hookSpecificOutput"]?.["additionalContext"] ?? "");
const decision = (r: HookRun): string | undefined => r.json?.["hookSpecificOutput"]?.["permissionDecision"];
const passes = (r: HookRun): void => {
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout.trim()).toBe("");
};
const lines = <T = string>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

describe("F1: when any Edit rewrites the line endings, the advice is to ask the user", () => {
  test("a mostly-LF mixed file: 'flattens', never 'retry with an Edit'", () => {
    const f = file("mixed-lf.md", lines(30, (i) => `- Rule ${i}\r\n`).join("") + lines(32, (i) => `- Item ${i}\n`).join(""));
    const r = runHook(pre("Edit", { file_path: f, old_string: "- Rule 5\n", new_string: "- Rule five\n" }));
    expect(decision(r)).toBe("ask");
    expect(reason(r)).toMatch(/flattens mixed line endings \(30 CRLF, 32 LF\) into all LF/);
    expect(context(r)).toMatch(/any Edit flattens them\. Ask the user/);
    expect(context(r)).not.toMatch(/Retry with an Edit/);
  });
  test("a CRLF file with no line break in its first 4,096 characters: any Edit converts it, so ask", () => {
    const f = file("long-first.md", "x".repeat(5000) + "\r\nsecond\r\nthird\r\n");
    const r = runHook(pre("Edit", { file_path: f, old_string: "second", new_string: "2nd" }));
    expect(reason(r)).toMatch(/converts 3 CRLF line endings to LF/);
    expect(context(r)).toMatch(/first 4,096 characters.*any Edit converts its CRLF line endings\. Ask the user/);
    expect(context(r)).not.toMatch(/Retry with an Edit/);
  });
  test("a Write that converts an all-CRLF file still gets the Edit retry advice (an Edit would keep CRLF)", () => {
    const f = file("all-crlf.md", "# T\r\none\r\ntwo\r\n");
    const r = runHook(pre("Write", { file_path: f, content: "# T\none\ntwo\n" }), { ASITIS_GUARD_MODE: "deny" });
    expect(reason(r)).toMatch(/converts 3 CRLF line endings to LF\. Retry with an Edit/);
  });
});

describe("F2: the guard runs on old Node instead of failing open with a syntax error", () => {
  // The scratch QA folder keeps old Node builds; CI machines do not, so this only runs where one exists.
  const roots = [process.env["ASITIS_OLD_NODE_DIR"] ?? ""].filter((d) => d && existsSync(d));
  const olds = roots.flatMap((d) => readdirSync(d).map((v) => path.join(d, v, "bin", "node"))).filter((p) => existsSync(p));
  test("the file uses no syntax newer than Node 12 (no ?? or ?.)", () => {
    const src = readFileSync(HOOK, "utf8");
    const code = src.replace(/\/\/[^\n]*|\/\*[^]*?\*\//g, "");
    expect(code).not.toMatch(/\?\?|\?\.(?!\d)/);
  });
  test.each(olds.length ? olds : ["(none available)"])("old Node %s parses and asks before a bad Write", (node) => {
    if (!existsSync(node)) return;
    const f = file("old-node.md", "# T\r\na\r\n");
    const r = runHook(pre("Write", { file_path: f, content: "# T\na\n" }), {}, node);
    expect(r.status, r.stderr).toBe(0);
    expect(decision(r)).toBe("ask");
  });
});

describe("F3: a whole-file rewrite through Edit or MultiEdit is churn too", () => {
  const original = lines(62, (i) => `* item ${i}`).join("\n") + "\n";
  test("an Edit whose old_string is the whole file", () => {
    const f = file("edit-whole.md", original);
    const r = runHook(pre("Edit", { file_path: f, old_string: original, new_string: original.replace(/^\* /gm, "- ") }));
    expect(decision(r)).toBe("ask");
    expect(reason(r)).toMatch(/rewrites 100% of the 62 existing lines/);
    expect(context(r)).toMatch(/Ask the user before reformatting/);
    expect(context(r)).not.toMatch(/Retry with an Edit/);
  });
  test("a MultiEdit that reformats 60 of 62 lines", () => {
    const f = file("multi-reformat.md", original);
    const edits = lines(60, (i) => ({ old_string: `* item ${i}\n`, new_string: `- item ${i}\n` }));
    const r = runHook(pre("MultiEdit", { file_path: f, edits }));
    expect(reason(r)).toMatch(/rewrites 97% of the 62 existing lines/);
  });
  test("a deny for churn does not point Claude to an Edit", () => {
    const f = file("deny-churn.md", original);
    const r = runHook(pre("Edit", { file_path: f, old_string: original, new_string: original.toUpperCase() }), { ASITIS_GUARD_MODE: "deny" });
    expect(decision(r)).toBe("deny");
    expect(reason(r)).toMatch(/do not get around this check with a large Edit/);
    expect(reason(r)).not.toMatch(/Retry with an Edit/);
  });
  test("an ordinary Edit of a few lines in a long file passes", () => {
    const f = file("edit-small.md", original);
    passes(runHook(pre("Edit", { file_path: f, old_string: "* item 3\n* item 4\n", new_string: "* item three\n* item four\n" })));
  });
  test("an Edit that replaces one section of a 20-line file passes", () => {
    const text = lines(20, (i) => `Line ${i} of the notes.`).join("\n") + "\n";
    const f = file("edit-section.md", text);
    const old = lines(4, (i) => `Line ${i + 5} of the notes.`).join("\n");
    passes(runHook(pre("Edit", { file_path: f, old_string: old, new_string: "A rewritten paragraph.\nWith two lines." })));
  });
});

describe("F4: small files get the Write churn check", () => {
  const small = ["Title", "=====", "", "* one", "* two", "* three", "", "| a | b |", "|---|---|", "| 1 | 2 |", "", "Some text.", "More text.", "End."].join("\n") + "\n";
  test("a 14-line reformat (setext to ATX, * to -, table padding) asks", () => {
    const f = file("small-reformat.md", small);
    const after = ["# Title", "", "- one", "- two", "- three", "", "| a   | b   |", "| --- | --- |", "| 1   | 2   |", "", "Some text.", "More text.", "End."].join("\n") + "\n";
    const r = runHook(pre("Write", { file_path: f, content: after }));
    expect(decision(r)).toBe("ask");
    expect(reason(r)).toMatch(/rewrites \d+% of the 14 existing lines/);
  });
  test("a small genuine Write (two lines changed) passes", () => {
    const f = file("small-edit.md", small);
    passes(runHook(pre("Write", { file_path: f, content: small.replace("* two", "* deux").replace("End.", "The end.") })));
  });
  test("a 3-line file with one line changed passes", () => {
    const f = file("tiny.md", "# T\n\nHello.\n");
    passes(runHook(pre("Write", { file_path: f, content: "# T\n\nHello there.\n" })));
  });
});

describe("F5: a hard break is reported when the words on that line change too", () => {
  const poem = "# Poem\n\nRoses are red  \nViolets are blue  \nSugar is sweet\n";
  test("Write: 'Violets are blue  ' becomes 'Violets are purple'", () => {
    const f = file("poem-write.md", poem);
    const r = runHook(pre("Write", { file_path: f, content: poem.replace("Violets are blue  ", "Violets are purple") }));
    expect(reason(r)).toMatch(/strips trailing whitespace on 1 line \(line 4\)/);
  });
  test("Edit: the same change", () => {
    const f = file("poem-edit.md", poem);
    const r = runHook(pre("Edit", { file_path: f, old_string: "Violets are blue  ", new_string: "Violets are purple" }));
    expect(reason(r)).toMatch(/strips trailing whitespace on 1 line \(line 4\)/);
  });
  test("changing the words but keeping the hard break passes", () => {
    const f = file("poem-keep.md", poem);
    passes(runHook(pre("Edit", { file_path: f, old_string: "Violets are blue  ", new_string: "Violets are purple  " })));
    passes(runHook(pre("Edit", { file_path: f, old_string: "Violets are blue  ", new_string: "Violets are purple\\" })));
  });
  test("trailing spaces before a blank line are not a hard break, so a reworded line passes", () => {
    const f = file("para-end.md", "# T\n\nEnd of paragraph.  \n\nNext.\n");
    passes(runHook(pre("Edit", { file_path: f, old_string: "End of paragraph.  ", new_string: "End of the paragraph." })));
  });
});

describe("F6: Claude Code's Write keeps an existing BOM", () => {
  const bom = "﻿# Notes\n\n- one\n- two\n";
  test("a Write without the BOM passes", () => {
    const f = file("bom-write.md", bom);
    passes(runHook(pre("Write", { file_path: f, content: bom.slice(1).replace("one", "first") })));
  });
  test("an Edit that removes the BOM character still asks", () => {
    const f = file("bom-edit.md", bom);
    expect(reason(runHook(pre("Edit", { file_path: f, old_string: "﻿# Notes", new_string: "# Notes" })))).toMatch(/removes the byte order mark/);
  });
  test("a Write that adds a BOM to a file without one still asks", () => {
    const f = file("no-bom.md", "# Notes\n");
    expect(reason(runHook(pre("Write", { file_path: f, content: "﻿# Notes\n" })))).toMatch(/adds a byte order mark/);
  });
});

describe("F7: ASITIS_GUARD_MODE wins, and an empty plugin option is ignored", () => {
  const bad = (): Record<string, unknown> => {
    const f = file("mode.md", "# T\r\na\r\n");
    return pre("Write", { file_path: f, content: "# T\na\n" });
  };
  test("an empty CLAUDE_PLUGIN_OPTION_GUARD_MODE does not override ASITIS_GUARD_MODE", () => {
    expect(decision(runHook(bad(), { CLAUDE_PLUGIN_OPTION_GUARD_MODE: "", ASITIS_GUARD_MODE: "deny" }))).toBe("deny");
    passes(runHook(bad(), { CLAUDE_PLUGIN_OPTION_GUARD_MODE: "  ", ASITIS_GUARD_MODE: "off" }));
  });
  test("ASITIS_GUARD_MODE wins over the old plugin option", () => {
    passes(runHook(bad(), { CLAUDE_PLUGIN_OPTION_GUARD_MODE: "deny", ASITIS_GUARD_MODE: "off" }));
  });
  test("the old plugin option is still read when the variable is unset", () => {
    expect(decision(runHook(bad(), { CLAUDE_PLUGIN_OPTION_GUARD_MODE: "deny" }))).toBe("deny");
  });
  test("an invalid value names the variable that was set", () => {
    expect(runHook(bad(), { ASITIS_GUARD_MODE: "strict" }).json?.["systemMessage"]).toMatch(/Unknown ASITIS_GUARD_MODE value "strict"/);
    expect(runHook(bad(), { CLAUDE_PLUGIN_OPTION_GUARD_MODE: "strict" }).json?.["systemMessage"]).toMatch(/Unknown CLAUDE_PLUGIN_OPTION_GUARD_MODE value "strict"/);
  });
});

describe("F8: churn is order-aware", () => {
  const text = lines(30, (i) => `Line number ${i}.`).join("\n") + "\n";
  test("a file reversed line by line is a rewrite", () => {
    const f = file("reverse.md", text);
    const r = runHook(pre("Write", { file_path: f, content: lines(30, (i) => `Line number ${29 - i}.`).join("\n") + "\n" }));
    expect(reason(r)).toMatch(/rewrites \d+% of the 30 existing lines/);
  });
  test("moving one line passes", () => {
    const f = file("move-one.md", text);
    const l = text.split("\n");
    const moved = [l[0], l[5], ...l.slice(1, 5), ...l.slice(6)].join("\n");
    passes(runHook(pre("Write", { file_path: f, content: moved })));
  });
});

describe("the reason reads as a deliberate guard decision", () => {
  test("ask and deny say it is on purpose, not a failure", () => {
    const f = file("wording.md", "# T\r\na\r\n");
    const ask = runHook(pre("Write", { file_path: f, content: "# T\na\n" }));
    expect(reason(ask)).toMatch(/^AsItIs guard flagged this change on purpose \(a guard decision, not a failure\): Write on wording\.md converts 2 CRLF line endings to LF\. Allow it only if you meant this\.$/);
    const deny = runHook(pre("Write", { file_path: f, content: "# T\na\n" }), { ASITIS_GUARD_MODE: "deny" });
    expect(reason(deny)).toMatch(/^AsItIs guard blocked this change on purpose \(a guard decision, not a failure\): /);
  });
});
