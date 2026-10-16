// Generates docs/rules/<id>.md for every active rule in src/rules/registry.ts, plus
// docs/rules/README.md as an index grouped by category. Owner: WP8.
//
// Usage, from packages/mcp:
//   node scripts/gen-rule-docs.mjs            write the pages
//   node scripts/gen-rule-docs.mjs --check    exit 1 and list the pages that are out of date
//
// Each page has seven sections. Summary, why and source come from the registry. The
// examples and the fix come from scripts/rule-docs/<id>.md, a hand-written fragment with
// "## Catches" (optional), "## Bad", "## Good" and "## Fix" headings. An active rule with no
// fragment is an error, so a half-written page never ships. Planned rules get no page; when a
// track activates a rule the next run picks it up (WP9 reruns this after the tracks merge).
//
// test/rule-docs.test.ts renders the pages in memory and compares them with the files on
// disk, so CI fails when someone edits the registry or a fragment and forgets to rerun this.

import { build } from "esbuild";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const repoRoot = path.resolve(pkgDir, "../..");

export const FRAGMENTS_DIR = path.join(here, "rule-docs");
export const OUT_DIR = path.join(repoRoot, "docs/rules");
/** Where SARIF helpUri points: these pages on GitHub (asitis.app has no rule pages yet). Matches RULE_DOCS in src/format/sarif.ts. */
export const SITE = "https://github.com/Katta041/asitis-agent-tools/blob/main/docs/rules/";

/** The day the vendor pages behind the registry's source URLs were last read and checked. */
const READ_ON = "14 October 2026";

/** Headings, in page order. The test checks every page has all seven. */
export const SECTIONS = ["What it catches", "Why it matters", "Bad example", "Good example", "How to fix", "Suppress or configure", "Source"];

export const CATEGORY_ORDER = ["format", "budget", "security", "drift", "config"];
const CATEGORY_TITLE = {
  format: "Format and vendor rules",
  budget: "Context budget",
  security: "Security",
  drift: "Drift",
  config: "Configuration",
};
const CATEGORY_BLURB = {
  format: "The file is not read the way its author expects: frontmatter, required fields, values a tool rejects, links and imports that go nowhere, bytes that are not UTF-8.",
  budget: "The file costs more context than it earns, or more than the tool will read.",
  security: "Content a reviewer does not see but an agent does, and other signs of a steering file that was tampered with. These rules can be turned off in `.asitisrc.json` or a baseline, never with a comment in the file.",
  drift: "Two instructions, in one file or across files, disagree.",
  config: "Problems in asitis's own configuration and suppression comments.",
};

/** Readable names for the source URLs, keyed by URL. Anything else falls back to its host. */
const SOURCE_LABELS = {
  "https://code.claude.com/docs/en/memory": "Claude Code docs: How Claude remembers your project",
  "https://code.claude.com/docs/en/skills": "Claude Code docs: Skills",
  "https://code.claude.com/docs/en/sub-agents": "Claude Code docs: Subagents",
  "https://code.claude.com/docs/en/hooks": "Claude Code docs: Hooks",
  "https://code.claude.com/docs/en/settings": "Claude Code docs: Settings",
  "https://code.claude.com/docs/en/settings-reference": "Claude Code docs: Settings reference",
  "https://code.claude.com/docs/en/plugins-reference": "Claude Code docs: Plugins reference",
  "https://code.claude.com/docs/en/output-styles": "Claude Code docs: Output styles",
  "https://agentskills.io/specification": "Agent Skills specification",
  "https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview": "Claude API docs: Agent Skills overview",
  "https://cursor.com/docs/context/rules": "Cursor docs: Rules",
  "https://code.visualstudio.com/docs/agent-customization/custom-instructions": "VS Code docs: Custom instructions",
  "https://code.visualstudio.com/docs/agent-customization/prompt-files": "VS Code docs: Prompt files",
  "https://code.visualstudio.com/docs/agent-customization/custom-agents": "VS Code docs: Custom agents",
  "https://docs.github.com/en/copilot/reference/custom-agents-configuration": "GitHub docs: Custom agents configuration",
  "https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions": "GitHub docs: Repository custom instructions",
  "https://learn.chatgpt.com/docs/agent-configuration/agents-md": "Codex docs: AGENTS.md",
  "https://agents.md/": "agents.md",
  "https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/memport.md": "Gemini CLI docs: Memory import processor",
  "https://docs.devin.ai/desktop/cascade/memories": "Windsurf docs: Memories and rules",
  "https://docs.cline.bot/customization/cline-rules": "Cline docs: Rules",
  "https://github.blog/changelog/2025-05-01-github-now-provides-a-warning-about-hidden-unicode-text/": "GitHub changelog: Warning about hidden Unicode text",
  "https://www.pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor-how-hackers-can-weaponize-code-agents": "Pillar Security: Rules File Backdoor",
  "https://trojansource.codes/": "Trojan Source (Boucher and Anderson)",
  "https://www.rfc-editor.org/rfc/rfc3629": "RFC 3629: UTF-8",
  "https://git-scm.com/docs/gitattributes": "git docs: gitattributes",
  "https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks": "Invariant Labs: MCP tool poisoning attacks",
  "https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/": "Snyk: ToxicSkills, malicious AI agent skills",
  "https://nvd.nist.gov/vuln/detail/CVE-2025-59536": "NVD: CVE-2025-59536",
  "https://nvd.nist.gov/vuln/detail/CVE-2025-53773": "NVD: CVE-2025-53773",
  "https://nvd.nist.gov/vuln/detail/CVE-2025-55284": "NVD: CVE-2025-55284",
  "https://yaml.org/spec/1.2.2/#comments": "YAML 1.2.2 spec: Comments",
  "https://github.com/anthropics/claude-code/issues/96117": "claude-code issue 96117",
  "https://github.com/dyoshikawa/rulesync": "rulesync",
  "https://github.com/Katta041/asitis-agent-tools/blob/main/docs/cli-contract.md#suppression": "asitis CLI contract: Suppression",
};

const SCOPE_LABEL = { file: "one file", project: "several files or the folder layout" };

export function sourceLabel(url) {
  if (SOURCE_LABELS[url]) return SOURCE_LABELS[url];
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Parses a fragment: text under "## Catches", "## Bad", "## Good" and "## Fix" headings.
 * Headings inside fenced code blocks are content, not section starts.
 */
export function parseFragment(text, id) {
  const out = {};
  let current = null;
  let fence = null;
  for (const raw of text.split(/\r?\n/)) {
    // A fence closes on a run of the same character at least as long as the one that opened it.
    const fenceMark = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (fenceMark) {
      if (!fence) fence = fenceMark[1];
      else if (fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length) fence = null;
    }
    const h = !fence && /^## (Catches|Bad|Good|Fix)\s*$/.exec(raw);
    if (h) {
      current = h[1];
      out[current] = [];
      continue;
    }
    if (!current) {
      if (raw.trim() !== "") throw new Error(`rule-docs/${id}.md: text before the first "## Bad", "## Good", "## Fix" or "## Catches" heading`);
      continue;
    }
    out[current].push(raw);
  }
  const section = (name) => (out[name] ?? []).join("\n").trim();
  for (const name of ["Bad", "Good", "Fix"]) {
    if (!section(name)) throw new Error(`rule-docs/${id}.md: missing or empty "## ${name}" section`);
  }
  return { catches: section("Catches"), bad: section("Bad"), good: section("Good"), fix: section("Fix") };
}

/** Reads every fragment in scripts/rule-docs/. Returns a map of rule id to parsed fragment. */
export function loadFragments(dir = FRAGMENTS_DIR) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    const id = name.slice(0, -3);
    out.set(id, parseFragment(readFileSync(path.join(dir, name), "utf8"), id));
  }
  return out;
}

/** Ends a summary as a sentence: the registry keeps summaries without a final period. */
const sentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

function suppressSection(rule) {
  const lines = [];
  if (rule.category === "security") {
    lines.push(
      `\`${rule.id}\` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a \`suppression-not-allowed\` warning.`,
      "",
      "Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:",
      "",
      "```json",
      `{ "rules": { "${rule.id}": "off" } }`,
      "```",
      "",
      "Or accept the findings you have today in a baseline, so only new ones fail the build:",
      "",
      "```sh",
      "asitis lint --format json --write-baseline > .asitis-baseline.json",
      "asitis lint --baseline .asitis-baseline.json",
      "```",
    );
  } else {
    lines.push(
      "For one finding, put a comment on the line above it. The reason after `--` is optional but worth writing:",
      "",
      "```markdown",
      `<!-- asitis-disable-next-line ${rule.id} -- why this one is fine -->`,
      "```",
      "",
      "For a whole file:",
      "",
      "```markdown",
      `<!-- asitis-disable-file ${rule.id} -- why this file is an exception -->`,
      "```",
      "",
      "For every file, turn it off or change its severity in `.asitisrc.json`:",
      "",
      "```json",
      `{ "rules": { "${rule.id}": "off" } }`,
      "```",
    );
    if (rule.id === "length") {
      lines.push(
        "",
        "`length` also takes thresholds, so a team that keeps a longer CLAUDE.md on purpose can raise the line:",
        "",
        "```json",
        `{ "rules": { "length": ["warning", { "claudeMdLines": 300 }] } }`,
        "```",
        "",
        "The options are `claudeMdLines`, `skillMdLines`, `cursorRuleLines`, `codexBytes`, `windsurfChars` and `memoryIndexLines`.",
      );
    }
    lines.push(
      "",
      "A `.asitisrc.json` `overrides` entry limits a change to some paths, and a baseline (`asitis lint --format json --write-baseline`) accepts today's findings so only new ones fail the build.",
    );
  }
  return lines.join("\n");
}

function fixSection(rule, fragment) {
  const lines = [fragment.fix];
  if (rule.fixable === "safe") {
    lines.push("", "asitis can make this edit for you. `asitis lint --fix-preview` prints a unified diff that `git apply` accepts, and the `suggest_fixes` MCP tool returns the same diff; nothing is written to disk by either. The fix for this rule is marked safe: it does not change what the file says.");
  } else if (rule.fixable === "review") {
    lines.push("", "asitis can propose this edit. `asitis lint --fix-preview` prints a unified diff that `git apply` accepts, and the `suggest_fixes` MCP tool returns the same diff; nothing is written to disk by either. The fix for this rule needs review before you apply it, because it changes or removes content.");
  }
  return lines.join("\n");
}

export function renderPage(rule, fragment) {
  const catches = [sentence(rule.summary)];
  if (fragment.catches) catches.push("", fragment.catches);
  const facts = [
    `| Category | Severity | Decided from | Fix offered | Inline suppression |`,
    `|---|---|---|---|---|`,
    `| ${rule.category} | ${rule.severityVaries ? `${rule.defaultSeverity}, ${rule.severityBy === "location" ? "depends on location" : "varies"} (see below)` : rule.defaultSeverity} | ${SCOPE_LABEL[rule.scope]} | ${rule.fixable === false ? "no" : rule.fixable} | ${rule.suppressibleInline ? "yes" : "no (security rule)"} |`,
    ...(rule.severityVaries ? ["", `Severity: ${rule.severityVaries}.`] : []),
  ];
  const parts = [
    `# ${rule.id}`,
    "",
    ...facts,
    "",
    `## ${SECTIONS[0]}`,
    "",
    ...catches,
    "",
    `## ${SECTIONS[1]}`,
    "",
    rule.why,
    "",
    `## ${SECTIONS[2]}`,
    "",
    fragment.bad,
    "",
    `## ${SECTIONS[3]}`,
    "",
    fragment.good,
    "",
    `## ${SECTIONS[4]}`,
    "",
    fixSection(rule, fragment),
    "",
    `## ${SECTIONS[5]}`,
    "",
    suppressSection(rule),
    "",
    `## ${SECTIONS[6]}`,
    "",
    `[${sourceLabel(rule.source)}](${rule.source}), read on ${READ_ON}.`,
    "",
    "---",
    "",
    `Generated from the rule registry (\`packages/mcp/src/rules/\`) and \`packages/mcp/scripts/rule-docs/${rule.id}.md\` by \`scripts/gen-rule-docs.mjs\`. Edit those, not this file, then run \`node scripts/gen-rule-docs.mjs\` from \`packages/mcp\`. Other rules: [index](README.md).`,
    "",
  ];
  return parts.join("\n");
}

export function renderIndex(rules) {
  const byCategory = new Map(CATEGORY_ORDER.map((c) => [c, []]));
  for (const r of rules) byCategory.get(r.category)?.push(r);
  const lines = [
    "# asitis rules",
    "",
    `One page per rule: what it catches, why it matters, a bad and a good example, how to fix it, how to suppress or configure it, and the vendor page or incident it rests on. ${rules.length} rules are active in this build. Each finding in \`asitis lint --format sarif\` links to its page as \`${SITE}<rule-id>.md\`.`,
    "",
    "Severity is the default; `.asitisrc.json` can change it. Where it says \"depends on location\" or \"varies\", the rule reports some findings at a lower severity (a note in a README, a note for a CLAUDE.md just over 200 lines); the rule page says when. Security rules can be turned off in `.asitisrc.json` or in a baseline, never with a comment in the file.",
    "",
  ];
  for (const c of CATEGORY_ORDER) {
    const list = byCategory.get(c);
    if (!list?.length) continue;
    lines.push(`## ${CATEGORY_TITLE[c]}`, "", CATEGORY_BLURB[c], "", "| Rule | Severity | What it catches |", "|---|---|---|");
    for (const r of list) lines.push(`| [${r.id}](${r.id}.md) | ${r.severityVaries ? `${r.defaultSeverity}, ${r.severityBy === "location" ? "depends on location" : "varies"}` : r.defaultSeverity} | ${r.summary} |`);
    lines.push("");
  }
  lines.push(
    "---",
    "",
    "Generated by `packages/mcp/scripts/gen-rule-docs.mjs` from the rule registry. Rules whose status is still planned have no page. To add or change a page, edit `packages/mcp/src/rules/*.meta.ts` or `packages/mcp/scripts/rule-docs/<rule-id>.md`, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`.",
    "",
  );
  return lines.join("\n");
}

/**
 * Renders every page. Returns a map of file name (README.md, <id>.md) to content.
 * Throws when an active rule has no fragment, naming the rule.
 */
export function generate(rules, fragments = loadFragments()) {
  const active = rules.filter((r) => r.status === "active");
  const missing = active.filter((r) => !fragments.has(r.id)).map((r) => r.id);
  if (missing.length) {
    throw new Error(`no examples for ${missing.length === 1 ? "rule" : "rules"} ${missing.join(", ")}: add scripts/rule-docs/<id>.md with "## Bad", "## Good" and "## Fix" sections`);
  }
  const files = new Map();
  files.set("README.md", renderIndex(active));
  for (const r of active) files.set(`${r.id}.md`, renderPage(r, fragments.get(r.id)));
  return files;
}

/** Loads the TypeScript registry by bundling it in memory with esbuild (Node cannot import .ts directly on 22). */
export async function loadRegistry() {
  const r = await build({
    entryPoints: [path.join(pkgDir, "src/rules/registry.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
  });
  const code = r.outputFiles[0].text;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`);
  return [...mod.RULES.values()];
}

/** Pages on disk that differ from the rendered ones, plus stray files. */
export function diffAgainstDisk(files, outDir = OUT_DIR) {
  const stale = [];
  for (const [name, text] of files) {
    const p = path.join(outDir, name);
    if (!existsSync(p) || readFileSync(p, "utf8").replace(/\r\n/g, "\n") !== text) stale.push(name);
  }
  const stray = existsSync(outDir) ? readdirSync(outDir).filter((n) => n.endsWith(".md") && !files.has(n)) : [];
  return { stale, stray };
}

async function main() {
  const check = process.argv.includes("--check");
  const rules = await loadRegistry();
  const files = generate(rules);
  const { stale, stray } = diffAgainstDisk(files);
  if (check) {
    if (!stale.length && !stray.length) {
      console.log(`docs/rules is up to date (${files.size - 1} rules)`);
      return;
    }
    for (const n of stale) console.error(`out of date: docs/rules/${n}`);
    for (const n of stray) console.error(`no active rule for: docs/rules/${n}`);
    console.error("Run: node scripts/gen-rule-docs.mjs (from packages/mcp)");
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, text] of files) writeFileSync(path.join(OUT_DIR, name), text);
  for (const n of stray) rmSync(path.join(OUT_DIR, n));
  console.log(`Wrote ${files.size - 1} rule pages and the index to ${path.relative(repoRoot, OUT_DIR)}${stale.length ? ` (${stale.length} changed)` : " (no changes)"}${stray.length ? `, removed ${stray.join(", ")}` : ""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`gen-rule-docs: ${e.message}`);
    process.exit(1);
  });
}
