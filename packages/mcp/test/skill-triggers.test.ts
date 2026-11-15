// 0.4.0 track 2: skill trigger checks (skill-description-vague, -person, -overlap,
// skill-listing-budget, skill-shadowed-command), secret-in-steering, no fix diff that prints a
// secret (issue 32), and asitis lint --badge. Projects are written to temp folders at run time; fake
// keys are built from random parts so no key-shaped string sits in this file.
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { keyWords, looksEnglish, personProblem, splitExclusions, vagueDescription } from "../src/checks/skill-triggers.js";
import { BADGE_MARKDOWN, run, type CliIO } from "../src/cli/asitis.js";
import { parseJsonLines, validateConfig } from "../src/config.js";
import { Deadline } from "../src/discover.js";
import type { Finding } from "../src/findings.js";
import { fixPreview, suggestFixes } from "../src/fix.js";
import { CAPS } from "../src/limits.js";
import { placeholderKey } from "../src/lint.js";
import { Sandbox } from "../src/paths.js";
import { lintProject } from "../src/project.js";
import { FIXTURES, REPO, tempDir } from "./helpers.js";

const IDS = new Set(["skill-description-vague", "skill-description-person", "skill-description-overlap", "skill-listing-budget", "skill-shadowed-command", "secret-in-steering"]);

const temps: Array<() => void> = [];
afterAll(() => temps.forEach((c) => c()));
function project(files: Record<string, string>): string {
  const t = tempDir("asitis-skilltrig-");
  temps.push(t.cleanup);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(t.dir, rel)), { recursive: true });
    writeFileSync(path.join(t.dir, rel), body);
  }
  return t.dir;
}

async function lintAll(root: string, targets: string[] = []) {
  const sandbox = await Sandbox.create([root]);
  return lintProject(sandbox, { deadline: new Deadline(CAPS.callBudgetMs), targets: targets.map((t) => path.join(root, t)), maxFiles: CAPS.walkMaxFiles, trustRepoConfig: true });
}
async function found(root: string, targets: string[] = []): Promise<Finding[]> {
  return (await lintAll(root, targets)).findings().filter((f) => IDS.has(f.ruleId) && !f.suppressed);
}
const short = (fs: Finding[]): string[] => fs.map((f) => `${f.path}:${f.line} ${f.ruleId} ${f.severity}`);
const skill = (name: string, description: string, extra = ""): string => `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n${extra}---\n\n# ${name}\n\nSteps go here.\n`;

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** A random string with digits, upper and lower case, as generated keys have. */
function rnd(n: number, alphabet = ALNUM): string {
  for (;;) {
    const s = [...randomBytes(n)].map((b) => alphabet[b % alphabet.length]).join("");
    if (alphabet !== ALNUM || (/[0-9]/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s))) return s;
  }
}

// ---------------------------------------------------------------------------------------------

describe("skill-description-vague", () => {
  test.each([
    "Helps with documents",
    "Processes data",
    "Does stuff with files",
    "Project Guidelines Skill (Example)",
    "A useful skill",
    "TODO",
    "Replace with description of the skill and when Claude should use it.",
    "[description here]",
  ])("flags %j", (d) => {
    expect(vagueDescription(d)).not.toBeNull();
  });

  test.each([
    // Anthropic's own examples of good descriptions
    "Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.",
    "Analyze Excel spreadsheets, create pivot tables, generate charts. Use when analyzing Excel files, spreadsheets, tabular data, or .xlsx files.",
    "Processes Excel files and generates reports",
    "Deploy Expo apps to production",
    "2D game development principles. Sprites, tilemaps, physics, camera.",
    "Search and replace with ripgrep across the repo",
    "Generates a brief description of each commit",
    "Write unit tests",
    "Helps with documents, spreadsheets and other files whenever someone asks for anything at all to be done",
  ])("leaves %j alone", (d) => {
    expect(vagueDescription(d)).toBeNull();
  });

  test("maxWords bounds what counts as short", () => {
    expect(vagueDescription("Helps with documents and files and data and tasks and other things and stuff")).toBeNull();
    expect(vagueDescription("Helps with documents and files and data and tasks and other things and stuff", 20)).not.toBeNull();
  });

  test("a template skill copied into .claude/skills is installed, so its placeholder is reported", async () => {
    const dir = project({ ".claude/skills/template-skill/SKILL.md": skill("template-skill", "Replace with description of the skill and when Claude should use it.") });
    const fs = await found(dir);
    expect(short(fs)).toEqual([".claude/skills/template-skill/SKILL.md:3 skill-description-vague note"]);
    expect(fs[0]!.message).toContain("still placeholder text");
  });

  test("a project finding, with the quote, on the description line; templates and tests are left alone", async () => {
    const dir = project({
      ".claude/skills/docs-helper/SKILL.md": skill("docs-helper", "Helps with documents"),
      "template-skill/SKILL.md": skill("template-skill", "Replace with description of the skill and when Claude should use it."),
      "template/SKILL.md": skill("template", "Replace with description of the skill and when Claude should use it."),
      "tests/fixtures/x/SKILL.md": skill("x", "Processes data"),
      ".claude/skills/manual/SKILL.md": skill("manual", "Processes data", "disable-model-invocation: true\n"),
    });
    const fs = await found(dir);
    expect(short(fs)).toEqual([".claude/skills/docs-helper/SKILL.md:3 skill-description-vague note"]);
    expect(fs[0]!.message).toContain('"Helps with documents"');
  });
});

describe("skill-description-person", () => {
  test.each([
    ["I can help you process Excel files", "I can"],
    ["You can use this to process Excel files", "You can use this"],
    ["Reviews TypeScript code. If a specialized expert is a better fit, I will recommend switching.", "I will"],
    ["I'm a Postgres tuning expert. Use for slow queries.", "I'm"],
    ["Let me handle your release notes.", "Let me"],
  ])("flags %j", (d, words) => {
    expect(personProblem(d)).toBe(words);
  });

  test.each([
    // anthropics/skills, current descriptions that must stay quiet
    "A set of resources to help me write all kinds of internal communications, using the formats that my company likes to use. Claude should use this skill whenever asked to write some sort of internal communications.",
    "Create beautiful visual art in .png and .pdf documents using design philosophy. You should use this skill when the user asks to create a poster, piece of art, design, or other static piece.",
    "After you give a substantive answer or draft that the user may act on, check this skill.",
    "Toolkit for styling artifacts with a theme. There are 10 pre-set themes with colors/fonts that you can apply to any artifact.",
    'Knowledge and utilities for creating animated GIFs optimized for Slack. Use when users request animated GIFs for Slack like "make me a GIF of X doing Y for Slack."',
    // addressed to Claude, or the user's own words
    "Use when you need population-scale cell metadata.",
    "Use when the user says 'what did I do yesterday' or asks for a standup.",
    "Use whenever the user asks is there a market, should I do this, or says pmarca mode.",
    "Assess SOC 2 Type I vs Type II readiness.",
    "Tables, FITS I/O and cosmology helpers.",
    "You MUST use this before any creative or build work.",
  ])("leaves %j alone", (d) => {
    expect(personProblem(d)).toBeNull();
  });
});

describe("Anthropic's published skills raise no vague or person notes", () => {
  test("the anthropics/skills fixture in this repo", async () => {
    const fs = await found(path.join(FIXTURES, "skills-benign", "anthropics"));
    expect(short(fs.filter((f) => f.ruleId === "skill-description-vague" || f.ruleId === "skill-description-person"))).toEqual([]);
  });
});

describe("non-English descriptions are skipped", () => {
  test.each([
    ["Procesa datos", false],
    ["中文产品决策 Agent。用于产品规划", false],
    ["Erstellt Berichte aus Tabellen und schickt sie per Mail an das Team", false],
    ["Processes Excel files and generates reports for the finance team", true],
  ] as const)("%j is English: %s", (d, en) => {
    expect(looksEnglish(d)).toBe(en);
  });
});

// ---------------------------------------------------------------------------------------------

describe("skill-description-overlap", () => {
  const backendEngineer = "Backend engineering orchestrator. Walks the seven forcing questions (read/write ratio, tenancy, sync vs async, data sensitivity, recovery targets), picks the profile and forks into specialist reviewers for API design and database design.";
  const backendReview = "Backend engineering review. Walks the seven forcing questions (read/write ratio, tenancy, sync vs async, data sensitivity, recovery targets), picks the profile and forks into specialist reviewers for API design and database design.";

  test("near-identical descriptions in one skills folder: a warning on the later one", async () => {
    const dir = project({ ".claude/skills/backend-engineer/SKILL.md": skill("backend-engineer", backendEngineer), ".claude/skills/backend-review/SKILL.md": skill("backend-review", backendReview) });
    const fs = await found(dir);
    expect(short(fs)).toEqual([".claude/skills/backend-review/SKILL.md:3 skill-description-overlap warning"]);
    expect(fs[0]!.message).toContain(".claude/skills/backend-engineer/SKILL.md");
    expect(fs[0]!.message).toMatch(/\d+% of key words shared, such as /);
  });

  test("a partial overlap is a note", async () => {
    const dir = project({
      ".claude/skills/test-and-lint/SKILL.md": skill("test-and-lint", "Run the project's test suite and lint and format checks the way CI does. Use before committing non-trivial changes, when tests or ruff fail."),
      ".claude/skills/dev-check/SKILL.md": skill("dev-check", "Run the full local verification gate: ruff lint, ruff format check and pytest, the same checks CI enforces. Use before committing non-trivial changes, or when asked to check, lint, run the tests or verify the build."),
    });
    expect(short(await found(dir))).toEqual([".claude/skills/test-and-lint/SKILL.md:3 skill-description-overlap note"]);
  });

  test("a name word only one of them uses, or opposite operations, tells them apart", async () => {
    const dir = project({
      ".claude/skills/mobile-android-design/SKILL.md": skill("mobile-android-design", "Design mobile screens for Android with Material components, navigation patterns, accessibility, typography and spacing. Use when designing Android app screens."),
      ".claude/skills/mobile-ios-design/SKILL.md": skill("mobile-ios-design", "Design mobile screens for iOS with native components, navigation patterns, accessibility, typography and spacing. Use when designing iOS app screens."),
      ".claude/skills/profiler-start/SKILL.md": skill("profiler-start", "Enable the runtime profiler and open the profiler window. Idempotent: calling when already enabled returns the current state without error."),
      ".claude/skills/profiler-stop/SKILL.md": skill("profiler-stop", "Disable the runtime profiler. Idempotent: calling when already disabled returns the current state without error."),
    });
    expect(short(await found(dir))).toEqual([]);
  });

  test("pairs told apart by a 'do not use for' clause or by naming each other are not reported", async () => {
    const dir = project({
      ".agents/skills/frontend-code-review/SKILL.md": skill("frontend-code-review", "Review frontend code under `web/` or `packages/ui/` when the user explicitly requests a review or audit. Supports PRs, branches, pending changes, files, and pasted diffs. Do not use for implementation-only requests, diagnosis without review intent, or backend-only code."),
      ".agents/skills/backend-code-review/SKILL.md": skill("backend-code-review", "Use only when the user explicitly requests a review or audit of backend code under `api/`. Supports pending-change, file-focused, and pasted-diff reviews. Do not use for implementation-only requests, diagnosis without review intent, frontend code, or backend code outside `api/`."),
      ".github/skills/sweeper-plan/SKILL.md": skill("sweeper-plan", "Plan a Sweeper agent-ready issue with the maintainer: fetch the review record from its state repo, put the open decisions to the maintainer, and write a plan file; it writes no code, and the sweeper-implement skill implements the approved plan."),
      ".github/skills/sweeper-implement/SKILL.md": skill("sweeper-implement", "Implement a Sweeper agent-ready issue: fetch the review record from its state repo, implement the change from the review brief or an approved plan file, validate the diff, and open a draft PR after the maintainer reviews it."),
    });
    expect(short(await found(dir))).toEqual([]);
  });

  test("splitExclusions cuts each exclusion clause to the end of its sentence", () => {
    expect(splitExclusions("Review code. Do not use for backend code. Supports diffs.")).toEqual({ kept: "Review code. . Supports diffs.", excluded: " Do not use for backend code" });
    expect(splitExclusions("Formats SQL; not for Python; fast").kept).toBe("Formats SQL; ; fast");
    expect(splitExclusions("Plain text with no clause")).toEqual({ kept: "Plain text with no clause", excluded: "" });
  });

  test("a wrapper that invokes the other as an agent, or a name inside a phrase, still counts as overlap", async () => {
    const dir = project({
      ".claude/skills/stress-test/SKILL.md": skill("stress-test", "Runs macro-financial stress tests: scenario design, satellite models, bank and sector results, network contagion, policy implications."),
      ".claude/skills/team-stress-test/SKILL.md": skill("team-stress-test", "Orchestrates a macro-financial stress-test exercise: scenario design, satellite models, network contagion, bank and sector results and policy options."),
    });
    expect(short(await found(dir)).length).toBe(1);
  });

  test("mirrored copies for other agents report the pair once, in .claude", async () => {
    const files: Record<string, string> = {};
    for (const root of [".claude", ".agents", ".gemini"]) {
      files[`${root}/skills/backend-engineer/SKILL.md`] = skill("backend-engineer", backendEngineer);
      files[`${root}/skills/backend-review/SKILL.md`] = skill("backend-review", backendReview);
    }
    expect(short(await found(project(files)))).toEqual([".claude/skills/backend-review/SKILL.md:3 skill-description-overlap warning"]);
  });

  test("skills in different folders, nested stages and manual-only skills are not compared", async () => {
    const dir = project({
      "plugins/a/skills/backend-engineer/SKILL.md": skill("backend-engineer", backendEngineer),
      "plugins/b/skills/backend-review/SKILL.md": skill("backend-review", backendReview),
      ".claude/skills/pipeline/SKILL.md": skill("pipeline", backendEngineer),
      ".claude/skills/pipeline/stages/review/SKILL.md": skill("review", backendReview),
      ".claude/skills/manual/SKILL.md": skill("manual", backendReview, "disable-model-invocation: true\n"),
    });
    expect(short(await found(dir))).toEqual([]);
  });

  test("thresholds and the skill cap come from .asitisrc.json", async () => {
    const files = {
      ".claude/skills/backend-engineer/SKILL.md": skill("backend-engineer", backendEngineer),
      ".claude/skills/backend-review/SKILL.md": skill("backend-review", backendReview),
    };
    const strictTo = project({ ...files, ".asitisrc.json": '{"rules": {"skill-description-overlap": ["note", {"notePercent": 99, "warnPercent": 100}]}}' });
    expect(short(await found(strictTo))).toEqual([]);
    const capped = project({ ...files, ".asitisrc.json": '{"rules": {"skill-description-overlap": ["note", {"maxSkills": 2}]}}' });
    const p = await lintAll(capped);
    expect(p.findings().filter((f) => f.ruleId === "skill-description-overlap")).toHaveLength(1);
    const over = project({ ...files, ".claude/skills/third/SKILL.md": skill("third", "Formats SQL migrations for Postgres."), ".asitisrc.json": '{"rules": {"skill-description-overlap": ["note", {"maxSkills": 2}]}}' });
    const q = await lintAll(over);
    expect(q.findings().filter((f) => f.ruleId === "skill-description-overlap")).toHaveLength(0);
    expect(q.notes.join("\n")).toContain("skill-description-overlap skipped .claude/skills (3)");
  });

  test("keyWords stems plurals so app meets apps and databases meets database", () => {
    expect([...keyWords("Connect apps and databases").keys()]).toEqual(["connect", "app", "database"]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("skill-listing-budget", () => {
  const long = (i: number): string => `Generates report number ${i} from warehouse tables with column mapping, partitioning by date, incremental watermarks and Parquet output. ${"Use when the user asks for that report or anything close to it. ".repeat(6)}`;
  const many = (root: string, n: number): Record<string, string> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${root}/skills/report-${i}/SKILL.md`, skill(`report-${i}`, long(i))]));

  test(".claude skills over 8,000 characters: one note on the longest, naming the biggest", async () => {
    const dir = project({ ...many(".claude", 20), ".claude/skills/report-7/SKILL.md": skill("report-7", `${long(7)} Extra words make this the longest one.`) });
    const fs = await found(dir);
    const b = fs.filter((f) => f.ruleId === "skill-listing-budget");
    expect(short(b)).toEqual([".claude/skills/report-7/SKILL.md:3 skill-listing-budget note"]);
    expect(b[0]!.message).toMatch(/The 20 skills and commands in \.claude list [\d,]+ characters/);
    expect(b[0]!.message).toContain("Longest: report-7");
  });

  test("under the budget, manual-only skills, and a named-files run stay quiet", async () => {
    expect((await found(project(many(".claude", 3)))).filter((f) => f.ruleId === "skill-listing-budget")).toEqual([]);
    const manual = Object.fromEntries(Object.entries(many(".claude", 20)).map(([k, v]) => [k, v.replace("---\n\n#", "disable-model-invocation: true\n---\n\n#")]));
    expect((await found(project(manual))).filter((f) => f.ruleId === "skill-listing-budget")).toEqual([]);
    const dir = project(many(".claude", 20));
    expect((await found(dir, [".claude/skills/report-1/SKILL.md", ".claude/skills/report-2/SKILL.md"])).filter((f) => f.ruleId === "skill-listing-budget")).toEqual([]);
  });

  test("a plugin counts only with .claude-plugin/plugin.json; other agents' folders never", async () => {
    const without = project({ ...many("plugins/p", 20), ...many(".gemini", 20) });
    expect((await found(without)).filter((f) => f.ruleId === "skill-listing-budget")).toEqual([]);
    const withManifest = project({ ...many("plugins/p", 20), "plugins/p/.claude-plugin/plugin.json": '{"name": "p"}' });
    expect(short((await found(withManifest)).filter((f) => f.ruleId === "skill-listing-budget"))).toHaveLength(1);
  });

  test("commands count toward the .claude listing, and budgetChars comes from .asitisrc.json", async () => {
    const dir = project({
      ".claude/skills/a/SKILL.md": skill("a", "Formats SQL migrations for Postgres and checks them against the schema."),
      ".claude/commands/deploy.md": "---\ndescription: Deploy the staging stack and post the link in the release channel\n---\nSteps.\n",
      ".asitisrc.json": '{"rules": {"skill-listing-budget": ["note", {"budgetChars": 100}]}}',
    });
    const b = (await found(dir)).filter((f) => f.ruleId === "skill-listing-budget");
    expect(b).toHaveLength(1);
    expect(b[0]!.message).toContain("The 2 skills and commands in .claude");
    expect(b[0]!.message).toContain("100 characters by the budget this project sets in .asitisrc.json");
  });
});

// ---------------------------------------------------------------------------------------------

describe("skill-shadowed-command", () => {
  test("a command with a skill's folder name or frontmatter name, any case, is a warning", async () => {
    const dir = project({
      ".claude/skills/run-app/SKILL.md": skill("run-app", "Run the server locally and smoke-test it. Use when asked to start or serve the app."),
      ".claude/skills/release-notes/SKILL.md": skill("notes", "Write release notes from merged pull requests since the last tag."),
      ".claude/commands/run-app.md": "---\ndescription: Start the server\n---\nRun it.\n",
      ".claude/commands/Notes.md": "Write notes.\n",
      ".claude/commands/frontend/run-app.md": "Run the frontend.\n",
      ".claude/commands/other.md": "Other.\n",
    });
    const fs = await found(dir);
    expect(short(fs)).toEqual([".claude/commands/Notes.md:1 skill-shadowed-command warning", ".claude/commands/run-app.md:1 skill-shadowed-command warning"]);
    expect(fs[1]!.message).toContain("/run-app never runs this command");
  });

  test("a plugin's commands/ and skills/ and a skill in another .claude folder are not compared", async () => {
    const dir = project({
      "plugins/p/skills/deploy/SKILL.md": skill("deploy", "Deploy the staging stack and post the link."),
      "plugins/p/commands/deploy.md": "Deploy.\n",
      "apps/web/.claude/skills/build/SKILL.md": skill("build", "Build the web app with Vite and report bundle sizes."),
      ".claude/commands/build.md": "Build.\n",
    });
    expect(short(await found(dir))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("secret-in-steering", () => {
  const gh = (): string => `ghp_${rnd(36)}`;
  const aws = (): string => `AKIA${rnd(16, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")}`;
  const pem = (): string => ["-----BEGIN RSA PRIVATE KEY-----", rnd(64, ALNUM + "+/"), rnd(64, ALNUM + "+/"), "-----END RSA PRIVATE KEY-----"].join("\n");

  test("real-looking keys are errors with type and column, and nothing of the key in any output", async () => {
    const k1 = gh();
    const k2 = aws();
    const key = pem();
    const dir = project({ "CLAUDE.md": `# Project\n\nUse token ${k1} for the API.\nAWS: ${k2}\n\n${key}\n` });
    const fs = await found(dir);
    expect(short(fs)).toEqual(["CLAUDE.md:3 secret-in-steering error", "CLAUDE.md:4 secret-in-steering error", "CLAUDE.md:6 secret-in-steering error"]);
    expect(fs[0]!.message).toContain("GitHub token");
    expect(fs[0]!.column).toBe(11);
    expect(fs[0]!.endColumn).toBe(11 + k1.length);
    for (const f of fs) {
      for (const k of [k1, k2, key.split("\n")[1]!]) for (let i = 0; i + 4 <= k.length; i += 4) expect(f.message).not.toContain(k.slice(i, i + 8));
    }
    for (const format of ["text", "json", "sarif", "github"]) {
      const r = await cliIn(dir, ["lint", "--format", format, "--fail-on", "never"]);
      expect(r.out + r.err).not.toContain(k1.slice(4, 16));
      expect(r.out + r.err).not.toContain(k2.slice(4, 16));
    }
  });

  test("the fingerprint does not depend on the key, so a baseline holds nothing derived from it", async () => {
    const a = (await found(project({ "CLAUDE.md": `Token ${gh()}\n` })))[0]!;
    const b = (await found(project({ "CLAUDE.md": `Token ${gh()}\n` })))[0]!;
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  test.each([
    ["the AWS docs example key", `AKIAIOSFODNN7${"EXAMPLE"}`],
    ["an x placeholder", `sk-ant-${"x".repeat(32)}`],
    ["a your-key placeholder", `ghp_${"YOUR"}TOKEN${"HERE"}abcd1234efgh5678ijkl9012mnop`],
    ["a typed sequence", `sk_live_${"1234567890abcdef"}`],
    ["hyphenated words", `sk-${"governance"}-specialist-agent`],
  ])("skips %s", async (_label, value) => {
    expect(placeholderKey(value)).toBe(true);
    expect(await found(project({ "CLAUDE.md": `Example: ${value}\n` }))).toEqual([]);
  });

  test("a PEM header in prose, a key in plain markdown and a comment cannot hide it", async () => {
    expect(await found(project({ "CLAUDE.md": "Never commit files that contain -----BEGIN PRIVATE KEY----- blocks.\n" }))).toEqual([]);
    expect(await found(project({ "docs/notes.md": `Token ${gh()}\n` }), ["docs/notes.md"])).toEqual([]);
    const dir = project({ "AGENTS.md": `<!-- asitis-disable-next-line secret-in-steering -->\nToken ${gh()}\n` });
    expect(short(await found(dir))).toEqual(["AGENTS.md:2 secret-in-steering error"]);
  });
});

describe("no fix diff for a line that holds a secret (issue 32)", () => {
  test("a trailing-whitespace fix on the key's line is withheld with the reason; other lines are still fixed", async () => {
    const k = gh2();
    const dir = project({ "CLAUDE.md": `# Project\n\nToken ${k}   \n\n\n\n\n\n\nRun tests before you push.   \n` });
    const p = await lintAll(dir);
    const diff = fixPreview(p, "all");
    expect(diff).toContain("Run tests before you push.");
    expect(diff).not.toContain(k.slice(4, 16));
    const sandbox = await Sandbox.create([dir]);
    const out = await suggestFixes(sandbox, { path: "CLAUDE.md" }, new Deadline(CAPS.callBudgetMs));
    expect(out.text).not.toContain(k.slice(4, 16));
    expect(JSON.stringify(out.structured)).not.toContain(k.slice(4, 16));
    expect(out.text).toContain("Lines next to a secret were left out of this fix");
  });

  test("when every edit is next to the key, no fix is offered and the reason is given", async () => {
    const k = gh2();
    const dir = project({ "CLAUDE.md": `# Project

Token ${k}   
` });
    const p = await lintAll(dir);
    expect(fixPreview(p, "all")).toBe("");
    const sandbox = await Sandbox.create([dir]);
    const out = await suggestFixes(sandbox, { path: "CLAUDE.md" }, new Deadline(CAPS.callBudgetMs));
    expect(out.text).toContain("looks like it holds a secret");
    expect(out.text + JSON.stringify(out.structured)).not.toContain(k.slice(4, 16));
  });
});
function gh2(): string {
  return `ghp_${rnd(36)}`;
}

// ---------------------------------------------------------------------------------------------

async function cliIn(cwd: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const io: CliIO = { out: (t) => void (out += t), err: (t) => void (err += t), cwd, nodeVersion: process.versions.node, debug: false };
  const code = await run(args, io);
  return { code, out, err };
}

describe("asitis lint --badge", () => {
  test("a clean run prints the snippet, the same one the READMEs show", async () => {
    const dir = project({ "CLAUDE.md": "# Project\n\nRun `npm test` before every commit.\n" });
    const r = await cliIn(dir, ["lint", "--badge"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(BADGE_MARKDOWN);
    for (const readme of ["README.md", "action/README.md"]) expect(readFileSync(path.join(REPO, readme), "utf8")).toContain(BADGE_MARKDOWN);
  });

  test("a run with a warning gets no badge and one line saying why", async () => {
    const dir = project({ "CLAUDE.md": "# Project\n\nSee [the guide](docs/missing.md).\n" });
    const r = await cliIn(dir, ["lint", "--badge"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("img.shields.io");
    expect(r.err).toBe("asitis: no badge yet: fix the 1 error or warning above, then run --badge again\n");
  });

  test.each([
    [["lint", "--badge", "--format", "json"], "asitis: --badge only applies to --format text\n"],
    [["lint", "--badge", "--fix-preview"], "asitis: --badge cannot be combined with --fix-preview\n"],
    [["budget", "--badge"], "asitis: --badge only applies to asitis lint\n"],
  ])("%j is a usage error", async (args, msg) => {
    const r = await cliIn(REPO, args);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toBe(msg);
  });
});

// ---------------------------------------------------------------------------------------------

describe(".asitisrc.json options for the new rules", () => {
  const load = (text: string) => validateConfig(parseJsonLines(text, ".asitisrc.json"), ".asitisrc.json");
  test("accepted", () => {
    const c = load('{"rules": {"skill-description-overlap": ["warning", {"notePercent": 60, "minSharedWords": 8}], "skill-listing-budget": ["note", {"budgetChars": 40000}], "skill-description-vague": ["note", {"maxWords": 8}]}}');
    expect(c.rules["skill-description-overlap"]).toEqual({ severity: "warning", options: { notePercent: 60, minSharedWords: 8 } });
    expect(c.rules["skill-listing-budget"]).toEqual({ severity: "note", options: { budgetChars: 40000 } });
  });
  test.each([
    ['{"rules": {"skill-listing-budget": ["note", {"budget": 1}]}}', '.asitisrc.json line 1: unknown option "budget" for skill-listing-budget'],
    ['{"rules": {"skill-description-overlap": ["note", {"notePercent": 0}]}}', ".asitisrc.json line 1: rules.skill-description-overlap[1].notePercent must be a whole number from 1 to 100, not 0"],
    ['{"rules": {"skill-description-person": ["note", {"x": 1}]}}', '.asitisrc.json line 1: rules.skill-description-person takes no options; only "length", "skill-description-vague", "skill-description-overlap", "skill-listing-budget" have options'],
  ])("%s is refused", (text, msg) => {
    expect(() => load(text)).toThrow(msg);
  });
  test("the JSON schema lists the same options", () => {
    const schema = JSON.parse(readFileSync(path.join(REPO, "packages/mcp/schema/asitisrc-1.json"), "utf8"));
    expect(Object.keys(schema.$defs.skillOverlapOptions.properties)).toEqual(["notePercent", "warnPercent", "minSharedWords", "maxSkills"]);
    expect(Object.keys(schema.$defs.skillListingOptions.properties)).toEqual(["budgetChars", "maxDescChars"]);
    expect(Object.keys(schema.$defs.skillVagueOptions.properties)).toEqual(["maxWords"]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("new text scanners stay linear", () => {
  const MB = 1024 * 1024;
  const cases: Record<string, string> = {
    quotes: '"'.repeat(MB),
    "open-quote-words": `"${"a ".repeat(MB / 2)}`,
    apostrophes: "' a".repeat(MB / 3),
    "i-clauses": ", I ".repeat(MB / 4),
    brackets: "[description ".repeat(MB / 13),
    braces: "{{ ".repeat(MB / 3),
    "long-word": "a".repeat(MB),
    unicode: "é".repeat(MB),
    exclusions: "do not use for ".repeat(MB / 15),
    "exclusion-no-stop": `not for ${"x ".repeat(MB / 2)}`,
  };
  test.each(Object.keys(cases))("%s", (name) => {
    const s = cases[name]!;
    const t0 = performance.now();
    vagueDescription(s);
    personProblem(s);
    looksEnglish(s);
    keyWords(s);
    splitExclusions(s);
    placeholderKey(s);
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  test("a steering file of key prefixes and PEM headers lints within the call budget", async () => {
    const dir = project({
      "CLAUDE.md": `${"ghp_AKIAsk-ant-xoxb-npm_AIza ".repeat(40000)}\n${"-----BEGIN RSA PRIVATE KEY-----\n".repeat(30000)}`,
    });
    const t0 = performance.now();
    await lintAll(dir);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe("the corpus fixture of benign skills raises no warning from the new rules", () => {
  test("test-fixtures/skills-benign", async () => {
    const root = path.join(FIXTURES, "skills-benign");
    expect(readdirSync(root).length).toBeGreaterThan(0);
    const fs = await found(root);
    expect(short(fs.filter((f) => f.severity !== "note"))).toEqual([]);
  });
});
