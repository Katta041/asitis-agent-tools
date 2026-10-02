#!/usr/bin/env node
// AsItIs markdown accident guard: a Claude Code PreToolUse hook for Write, Edit and MultiEdit.
//
// It warns when a change to an existing markdown file would also change bytes the
// agent probably did not mean to touch: line endings, trailing whitespace (hard
// line breaks), the BOM, the final newline, invalid UTF-8 bytes, or the
// frontmatter block. It is an ACCIDENT GUARD, NOT A SECURITY BOUNDARY: it does not
// see Bash (sed -i, redirects), other tools, or other programs, and anything that
// runs as you can bypass it.
//
// Modes (plugin option guard_mode, or env ASITIS_GUARD_MODE):
//   ask  (default) show the warning and ask you to allow or reject the change
//   deny           block the change and tell the agent to retry with a minimal edit
//   off            do nothing
// Any other value is treated as deny (the safest mode) and the guard says so.
//
// Fails closed: if the hook input cannot be read, the change is blocked (exit 2)
// with a message saying why. Claude Code runs the hook with a 10 s timeout and
// lets the change through when a hook times out, so the guard keeps its own 7 s
// budget: a check that cannot finish in time asks (or, in deny mode, blocks)
// instead of running into the timeout. Dependency-free, read-only: it never
// writes files.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const MAX_BYTES = 16 * 1024 * 1024;
const STARTED = Date.now();
/** Time budget for one check, well inside the 10 s hook timeout in hooks.json. */
const BUDGET_MS = Math.min(Number(process.env.ASITIS_GUARD_BUDGET_MS) > 0 ? Number(process.env.ASITIS_GUARD_BUDGET_MS) : 7000, 7000);
const MODES = new Set(["ask", "deny", "off"]);

class OutOfTime extends Error {}
function checkTime() {
  if (Date.now() - STARTED > BUDGET_MS) throw new OutOfTime();
}
const MARKDOWN = /\.(md|mdc|markdown|mdx)$/i;
const STEERING_NAMES = new Set([".cursorrules", ".windsurfrules", ".clinerules"]);

function block(message) {
  process.stderr.write(`AsItIs guard: ${message}\n`);
  process.exit(2);
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Facts about text, all single-pass.

function facts(text) {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) { crlf++; i++; } else cr++;
    } else if (c === 10) lf++;
  }
  const last = text.charCodeAt(text.length - 1);
  return { bom: text.charCodeAt(0) === 0xfeff, lf, crlf, cr, finalNewline: last === 10 || last === 13 };
}

function splitLines(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 13) {
      out.push(text.slice(start, i));
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

function trimWs(l) {
  let e = l.length;
  while (e > 0 && (l.charCodeAt(e - 1) === 32 || l.charCodeAt(e - 1) === 9)) e--;
  return l.slice(0, e);
}
const hasTrailingWs = (l) => l.length > 0 && (l.endsWith(" ") || l.endsWith("\t"));
const isFence = (l) => /^---[ \t]*$/.test(l);

/** Structural frontmatter check that needs no YAML parser. */
function frontmatterState(text) {
  const lines = splitLines(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (!lines.length || !isFence(lines[0])) return { present: false };
  for (let i = 1; i < lines.length && i < 2000; i++) {
    if (isFence(lines[i]) || lines[i] === "...") {
      const body = lines.slice(1, i);
      const tabIndent = body.some((l) => /^\t/.test(l));
      return { present: true, closed: true, keys: body.filter((l) => /^[A-Za-z_][\w.-]*\s*:/.test(l)).length, tabIndent };
    }
  }
  return { present: true, closed: false };
}

/** Counts invalid UTF-8 sequences in raw bytes. */
function invalidUtf8(buf) {
  let bad = 0;
  for (let i = 0; i < buf.length; ) {
    const b = buf[i];
    if (b < 0x80) { i++; continue; }
    let need = 0;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b === 0xe0) { need = 2; lo = 0xa0; }
    else if ((b >= 0xe1 && b <= 0xec) || b === 0xee || b === 0xef) need = 2;
    else if (b === 0xed) { need = 2; hi = 0x9f; }
    else if (b === 0xf0) { need = 3; lo = 0x90; }
    else if (b >= 0xf1 && b <= 0xf3) need = 3;
    else if (b === 0xf4) { need = 3; hi = 0x8f; }
    else { bad++; i++; continue; }
    let j = 1;
    for (; j <= need; j++) {
      const c = buf[i + j];
      if (c === undefined || c < (j === 1 ? lo : 0x80) || c > (j === 1 ? hi : 0xbf)) break;
    }
    if (j > need) i += need + 1;
    else { bad++; i += j; }
  }
  return bad;
}

// ---------------------------------------------------------------------------
// Simulating the edit tools on the current text.

/**
 * Claude Code's Edit and MultiEdit do not splice the raw file. As read from the
 * Claude Code 2.1.285 binary, they:
 *   1. pick one line-ending style from the first 4,096 characters (CRLF when it
 *      has more CRLF than bare LF breaks, otherwise LF),
 *   2. replace every CRLF in the file with LF and apply the edits to that text,
 *   3. write the result back with every LF turned into the chosen style.
 * So one Edit to a mixed-EOL file, or to a CRLF file whose first 4,096
 * characters have no line break, rewrites every line ending. The guard
 * simulates exactly that, then compares the before and after bytes.
 */
function editLineEnding(text) {
  const head = text.slice(0, 4096);
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < head.length; i++) {
    if (head.charCodeAt(i) !== 10) continue;
    if (i > 0 && head.charCodeAt(i - 1) === 13) crlf++;
    else lf++;
  }
  return crlf > lf ? "CRLF" : "LF";
}

const toLf = (s) => s.replace(/\r\n/g, "\n");

/**
 * Applies one edit to LF-normalised text. Returns the new text, or null when
 * old_string is not found (the tool itself will then fail, so there is nothing to guard).
 */
function applyEdit(normalised, oldStr, newStr, replaceAll) {
  if (typeof oldStr !== "string" || typeof newStr !== "string") throw new Error("Edit input needs string old_string and new_string");
  if (oldStr === "") return null;
  const needle = toLf(oldStr);
  const repl = toLf(newStr);
  const i = normalised.indexOf(needle);
  if (i < 0) return null;
  if (replaceAll) return normalised.split(needle).join(repl);
  return normalised.slice(0, i) + repl + normalised.slice(i + needle.length);
}

/** The file text Claude Code writes after these edits, or null when an edit does not apply. */
function simulateEdits(before, edits) {
  const style = editLineEnding(before);
  let text = toLf(before);
  for (const e of edits) {
    checkTime();
    const r = applyEdit(text, e.old_string, e.new_string, e.replace_all === true);
    if (r === null) return null;
    text = r;
  }
  return style === "CRLF" ? text.replace(/\n/g, "\r\n") : text;
}

function analyse(before, after, tool, beforeBuf) {
  const problems = [];
  const fb = facts(before);
  const fa = facts(after);
  if (fb.bom && !fa.bom) problems.push("removes the byte order mark (BOM)");
  if (!fb.bom && fa.bom) problems.push("adds a byte order mark (BOM)");
  const kinds = (f) => [f.lf > 0, f.crlf > 0, f.cr > 0].filter(Boolean).length;
  if (fb.crlf > 0 && fa.crlf < fb.crlf && fa.lf > fb.lf) {
    problems.push(`converts ${fb.crlf - fa.crlf} CRLF line ending(s) to LF`);
  } else if (fb.crlf === 0 && fb.lf > 0 && fa.crlf > 0) {
    problems.push(`adds ${fa.crlf} CRLF line ending(s) to an LF file`);
  } else if (kinds(fb) > 1 && kinds(fa) === 1 && fa.lf + fa.crlf + fa.cr > 1) {
    problems.push(`flattens mixed line endings (${fb.crlf} CRLF, ${fb.lf} LF, ${fb.cr} CR) into one style`);
  }
  if (fb.cr > 0 && fa.cr < fb.cr) problems.push(`removes ${fb.cr - fa.cr} lone CR line break(s)`);
  if (fb.finalNewline && !fa.finalNewline) problems.push("drops the final newline");
  if (!fb.finalNewline && fa.finalNewline && before.length > 0) problems.push("adds a final newline the file did not have");

  checkTime();
  // Trailing whitespace: lines whose content survives but loses its trailing spaces.
  const lb = splitLines(before);
  const la = splitLines(after);
  const afterSet = new Map();
  for (const l of la) afterSet.set(l, (afterSet.get(l) ?? 0) + 1);
  const afterTrimmed = new Set(la.map(trimWs));
  let stripped = 0;
  for (const l of lb) {
    if (!hasTrailingWs(l)) continue;
    const k = afterSet.get(l);
    if (k) { afterSet.set(l, k - 1); continue; }
    if (afterTrimmed.has(trimWs(l))) stripped++;
  }
  if (stripped > 0) problems.push(`strips trailing whitespace on ${stripped} line(s) (two trailing spaces are a hard line break in markdown)`);

  checkTime();
  const fmB = frontmatterState(before);
  const fmA = frontmatterState(after);
  if (fmB.present && fmB.closed) {
    if (!fmA.present) problems.push("removes or moves the frontmatter off line 1 (tools only read frontmatter that starts on line 1)");
    else if (!fmA.closed) problems.push("leaves the frontmatter without its closing ---");
    else if (fmA.keys < fmB.keys) problems.push(`drops ${fmB.keys - fmA.keys} frontmatter key(s)`);
    else if (fmA.tabIndent && !fmB.tabIndent) problems.push("indents frontmatter with tabs, which YAML does not allow");
  }

  if (tool === "Write" && lb.length > 20) {
    const counts = new Map();
    for (const l of la) counts.set(l, (counts.get(l) ?? 0) + 1);
    let kept = 0;
    for (const l of lb) {
      const k = counts.get(l);
      if (k) { kept++; counts.set(l, k - 1); }
    }
    const churn = 1 - kept / lb.length;
    if (churn > 0.3) problems.push(`rewrites ${Math.round(churn * 100)}% of the ${lb.length} existing lines`);
  }
  checkTime();
  const bad = invalidUtf8(beforeBuf);
  if (bad > 0) problems.push(`the file has ${bad} invalid UTF-8 byte sequence(s) that a text tool will replace with U+FFFD`);
  return problems;
}

// ---------------------------------------------------------------------------

function main() {
  const asked = String(process.env.CLAUDE_PLUGIN_OPTION_GUARD_MODE ?? process.env.ASITIS_GUARD_MODE ?? "ask").trim().toLowerCase() || "ask";
  const mode = MODES.has(asked) ? asked : "deny";
  const modeNote = MODES.has(asked)
    ? ""
    : ` Unknown guard_mode "${asked.slice(0, 40).replace(/[^\x20-\x7e]/g, "?")}", so the guard uses deny, the safest mode; set guard_mode to ask, deny or off.`;
  if (mode === "off") process.exit(0);
  // Nothing to report: exit silently, or only with the unknown-mode warning.
  const pass = () => (modeNote ? emit({ systemMessage: `AsItIs guard:${modeNote}` }) : process.exit(0));

  let raw;
  try {
    raw = readFileSync(0, "utf8");
  } catch (e) {
    block(`could not read the hook input (${e.message}). The change was blocked to be safe; set the plugin option guard_mode to off to disable this guard.`);
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    block("the hook input is not valid JSON. The change was blocked to be safe; set the plugin option guard_mode to off to disable this guard.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) block("the hook input is not a JSON object. The change was blocked to be safe.");
  const tool = input.tool_name;
  if (typeof tool !== "string" || tool === "") block("the hook input has no tool_name. The change was blocked to be safe.");
  if (tool !== "Write" && tool !== "Edit" && tool !== "MultiEdit") process.exit(0);
  const ti = input.tool_input;
  if (!ti || typeof ti !== "object") block(`the ${tool} input has no tool_input object. The change was blocked to be safe.`);
  if (typeof ti.file_path !== "string" || ti.file_path === "") block(`the ${tool} input has no file_path. The change was blocked to be safe.`);

  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  const file = path.resolve(cwd, ti.file_path);
  const base = path.basename(file).toLowerCase();
  if (!MARKDOWN.test(file) && !STEERING_NAMES.has(base)) process.exit(0);

  let st;
  try {
    st = statSync(file);
  } catch {
    pass(); // new file: nothing to preserve
  }
  if (!st.isFile()) pass();
  const name = path.basename(file);
  const decide = (summary, advice) => {
    if (mode === "deny") {
      emit({
        ...(modeNote ? { systemMessage: `AsItIs guard:${modeNote}` } : {}),
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `AsItIs guard: ${summary} ${advice}` },
      });
    }
    emit({
      systemMessage: `AsItIs guard (accident guard, not a security boundary): ${summary}`,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: `AsItIs guard: ${summary} Allow only if you meant this.`,
        additionalContext: `AsItIs guard warned the user: ${summary} ${advice}`,
      },
    });
  };

  if (st.size > MAX_BYTES) {
    // Too large to check: ask (or block in deny mode) rather than wave it through.
    decide(`${tool} on ${name} was not checked: the file is larger than 16 MB.${modeNote}`, "Split the change into smaller Edits, or set the plugin option guard_mode to off for this change.");
  }
  const beforeBuf = readFileSync(file);
  const before = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(beforeBuf);

  let after;
  let problems;
  try {
    if (tool === "Write") {
      if (typeof ti.content !== "string") block("the Write input has no string content. The change was blocked to be safe.");
      after = ti.content;
    } else {
      let edits;
      if (tool === "Edit") edits = [ti];
      else {
        if (!Array.isArray(ti.edits) || ti.edits.length === 0) block("the MultiEdit input has no edits array. The change was blocked to be safe.");
        for (const e of ti.edits) if (!e || typeof e !== "object") block("a MultiEdit edit is not an object. The change was blocked to be safe.");
        edits = ti.edits;
      }
      after = simulateEdits(before, edits);
      if (after === null) pass();
    }
    problems = analyse(before, after, tool, beforeBuf);
  } catch (e) {
    if (e instanceof OutOfTime) {
      // Fail closed: never let the 10 s hook timeout wave the change through unchecked.
      decide(
        `${tool} on ${name} could not be checked within ${BUDGET_MS >= 1000 ? `${Math.round(BUDGET_MS / 1000)} s` : `${BUDGET_MS} ms`} (the file or the edit is very large), so the guard could not confirm it keeps line endings, trailing spaces, BOM and frontmatter.${modeNote}`,
        "Split the change into smaller Edits, or set the plugin option guard_mode to off for this change.",
      );
    }
    block(`${e.message}. The change was blocked to be safe.`);
  }

  if (!problems.length) pass();

  const summary = `${tool} on ${name} ${problems.join("; ")}.${modeNote}`;
  const advice = "Retry with an Edit whose old_string and new_string differ only in the text you mean to change, keeping the file's line endings, trailing spaces, BOM and frontmatter exactly as they are.";
  decide(summary, advice);
}

try {
  main();
} catch (e) {
  block(`unexpected error (${e && e.message ? e.message : String(e)}). The change was blocked to be safe; set the plugin option guard_mode to off to disable this guard.`);
}
