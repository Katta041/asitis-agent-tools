// 0.4.0 leak audit, inside the opt-in agent config audit: secrets written into permission rules,
// local-only agent files that no .gitignore covers, and agent transcripts in the tree. Plus the
// .gitignore matcher, what the widened agent-config policy may and may not read, and linear time.
// Fake secrets are built from parts at run time and written to temp folders only.
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { localAgentFile, looksLikeTranscript, transcriptSignal } from "../src/checks/agent-leaks.js";
import { maskSecrets, permissionSecrets, words } from "../src/checks/permission-secrets.js";
import { Deadline } from "../src/discover.js";
import { buildReport, type Finding } from "../src/findings.js";
import { globMatch, IgnoreTree, parseGitignore } from "../src/gitignore.js";
import { CAPS } from "../src/limits.js";
import { Sandbox } from "../src/paths.js";
import { lintProject, type Include } from "../src/project.js";
import { formatSarif } from "../src/format/sarif.js";
import { connect, tempDir } from "./helpers.js";

const deadline = (): Deadline => new Deadline(CAPS.callBudgetMs);
const BUDGET_MS = Number(process.env["ASITIS_DOS_BUDGET_MS"] ?? 3000);

// Values shaped like the Apiiro cases, assembled so no file in the repo holds one in one piece.
const PW = ["T4ble", "-Sp00n", "-77"].join(""); // a database password
const TOKEN = ["7f3kQ9", "xLm2Vt", "8pRw4Zc6"].join(""); // a bearer token
const FAKE_GH = ["gh", "p_", "Zq9", "Xw8Vv7Uu6Tt5Ss4Rr3Qq2Pp1Oo0Nn9Mm8L"].join("");
const FAKE_OPENAI = ["sk", "-proj-", "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z"].join("");
const SERVICE_ROLE = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", Buffer.from('{"iss":"supabase","role":"service_role"}').toString("base64url"), "c2lnbmF0dXJlLXBhcnQtMTIzNDU2"].join(".");
const ANON = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", Buffer.from('{"iss":"supabase","role":"anon"}').toString("base64url"), "c2lnbmF0dXJlLXBhcnQtMTIzNDU2"].join(".");
const SECRETS = [PW, TOKEN, FAKE_GH, FAKE_OPENAI, SERVICE_ROLE];

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

/** Writes files into a fresh temp folder. A value of null makes a folder. */
function folder(files: Record<string, string | null>, opts: { git?: boolean } = {}): string {
  const { dir, cleanup } = tempDir("asitis-leak-");
  cleanups.push(cleanup);
  if (opts.git !== false) mkdirSync(path.join(dir, ".git"));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    if (text === null) {
      mkdirSync(abs, { recursive: true });
      continue;
    }
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return dir;
}

async function audit(dir: string, include: Include[] = ["config"], targets?: string[]): Promise<{ findings: Finding[]; notes: string[] }> {
  const sb = await Sandbox.create([dir]);
  const p = await lintProject(sb, { include, deadline: deadline(), ...(targets ? { targets } : {}) });
  return { findings: p.findings().filter((f) => f.path !== "CLAUDE.md"), notes: p.notes };
}

const J = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";
const allow = (...entries: string[]): Record<string, string> => ({ "CLAUDE.md": "# P\n", ".claude/settings.json": J({ permissions: { allow: entries } }) });
const ids = (f: Finding[]): string[] => f.map((x) => `${x.ruleId}:${x.severity}`);
const only = (f: Finding[], rule: string): Finding[] => f.filter((x) => x.ruleId === rule);

describe("secret-in-permission-rule: what it finds", () => {
  test.each([
    [`Bash(PGPASSWORD=${PW} psql -h db.example.com -U app)`, "PGPASSWORD value"],
    [`Bash(mysql -u root -p${PW} shop)`, "database password (mysql -p)"],
    [`Bash(mysqldump --password=${PW} -h 10.1.2.3 shop)`, "database password (mysqldump --password)"],
    [`Bash(sshpass -p '${PW}' ssh deploy@203.0.113.9)`, "SSH password (sshpass -p)"],
    [`Bash(curl -H "Authorization: Bearer ${TOKEN}" https://api.example.com/v1)`, "bearer token"],
    [`Bash(curl -H "x-api-key: ${TOKEN}" https://api.example.com/v1)`, "x-api-key header"],
    [`Bash(curl -u admin:${PW} https://ci.example.com/job)`, "basic auth credentials (curl -u)"],
    [`Bash(git clone https://deploy:${PW}@git.example.com/a/b.git)`, "password in a URL"],
    [`Bash(psql postgresql://app:${PW}@db.example.com:5432/app)`, "password in a URL"],
    [`Bash(docker login -u me -p ${PW} registry.example.com)`, "registry password (docker login -p)"],
    [`Bash(redis-cli -h 10.0.0.5 -a ${PW} ping)`, "Redis password (redis-cli -a)"],
    [`Bash(vercel deploy --token ${TOKEN} --prod)`, "token (--token)"],
    [`Bash(export STRIPE_SECRET_KEY=${TOKEN} && node pay.js)`, "STRIPE_SECRET_KEY value"],
    [`Bash(OPENAI_API_KEY=${FAKE_OPENAI} python run.py)`, "OpenAI API key"],
    [`Bash(gh api -H "Authorization: token ${FAKE_GH}" /user)`, "GitHub token"],
    [`Bash(curl -H "apikey: ${SERVICE_ROLE}" https://xyz.supabase.co/rest/v1/items)`, "Supabase service-role key"],
    [`Bash(npm config set //registry.npmjs.org/:_authToken ${TOKEN})`, "npm token"],
    [`Bash(echo ${FAKE_GH} | gh auth login --with-token)`, "GitHub token"],
    [`Bash(sshpass -p ${PW} ssh root@203.0.113.9 "curl -s http://localhost:8080/health")`, "SSH password (sshpass -p)"], // localhost on the far side
    [`Bash(echo ${PW} | sudo -S systemctl restart app)`, "sudo password (echo | sudo -S)"],
  ])("%s", (entry, kind) => {
    const s = permissionSecrets(entry);
    expect(s.map((x) => x.kind)).toEqual([kind]);
    const masked = maskSecrets(entry, s);
    for (const v of SECRETS) expect(masked).not.toContain(v);
  });

  test.each([
    "Bash(npm test:*)",
    "Bash(mysql -u root -p shop)", // prompts for the password
    "Bash(mysql -u root --password shop)", // prompts too; "shop" is the database
    "Bash(PGPASSWORD=postgres psql -h db.example.com)", // a well-known default
    `Bash(PGPASSWORD=${PW} psql -h localhost -U app)`, // only this machine
    `Bash(psql postgresql://app:${PW}@localhost:5432/app)`,
    'Bash(curl -H "Authorization: Bearer $API_TOKEN" https://api.example.com)',
    'Bash(curl -H "Authorization: Bearer ${API_TOKEN}" https://api.example.com)',
    "Bash(curl -H \"Authorization: Bearer *\" https://api.example.com)",
    "Bash(TOKENIZERS_PARALLELISM=false python train.py)",
    "Bash(GIT_ASKPASS=/usr/local/bin/askpass git push)",
    "Bash(NEXT_PUBLIC_SUPABASE_ANON_KEY=abc123def456ghi789 npm run dev)",
    `Bash(curl -H "apikey: ${ANON}" https://xyz.supabase.co/rest/v1/items)`, // anon keys are public
    "Bash(gh auth login --with-token)",
    "Bash(mysql -h db -P3306 -u app -p)",
    "Bash(find . -name \"*.ts\" -exec grep -l token {} ;)",
    "Bash(docker login -u me --password-stdin registry.example.com)",
    "Bash(gcloud auth print-access-token)",
    "Bash(openssl rand -base64 32)",
    "Bash(git push https://github.com/acme/app.git main)",
    "Bash(curl -u admin https://ci.example.com)", // curl prompts
    "Bash(API_KEY=your-api-key-here npm start)",
    "Bash(SECRET_KEY=changeme python manage.py runserver)",
    "WebFetch(domain:docs.example.com)",
    "Read(./.env)",
    "mcp__github__create_issue",
    "Bash(echo hello | sudo tee /etc/hosts)",
    "Bash(curl -u elastic:Kq83mLz0Pw https://localhost:9200/_cat/indices)",
  ])("no finding: %s", (entry) => {
    expect(permissionSecrets(entry)).toEqual([]);
  });

  test("words() keeps quotes together and splits shell separators", () => {
    expect(words(`a "b c" 'd' e\\ f;g&&h|i`).map((w) => w.text)).toEqual(["a", "b c", "d", "e f", ";", "g", "&&", "h", "|", "i"]);
  });
});

describe("secret-in-permission-rule: through the audit", () => {
  test("an allow rule in the shared settings is an error that names the list and index, never the value", async () => {
    const { findings } = await audit(folder(allow("Bash(npm test)", `Bash(PGPASSWORD=${PW} psql -h db.example.com -U app)`)));
    expect(ids(findings)).toEqual(["secret-in-permission-rule:error"]);
    expect(findings[0]!.message).toMatch(/^permissions\.allow\[1\] holds a secret in plain text \(PGPASSWORD value\); anyone who can read the repo/);
    expect(findings[0]!.message).not.toContain(PW);
    expect(findings[0]!.message).not.toContain("psql"); // the rule is not quoted
    expect(findings[0]!.line).toBe(5);
  });

  test("ask and deny lists count, and the local file needs config-local", async () => {
    const files = { "CLAUDE.md": "# P\n", ".claude/settings.local.json": J({ permissions: { ask: [`Bash(sshpass -p ${PW} ssh root@203.0.113.9)`], deny: [`Bash(curl -H "Authorization: Bearer ${TOKEN}" https://api.example.com)`] } }) };
    const dir = folder({ ...files, ".gitignore": ".claude/settings.local.json\n" });
    expect(only((await audit(dir, ["config"])).findings, "secret-in-permission-rule")).toEqual([]);
    const f = only((await audit(dir, ["config-local"])).findings, "secret-in-permission-rule");
    expect(f.map((x) => x.message.slice(0, 22))).toEqual(["permissions.ask[0] hol", "permissions.deny[0] ho"]);
    expect(f[0]!.message).toContain("Claude Code saved the whole approved command here");
  });

  test("Cursor CLI and Gemini CLI rule lists", async () => {
    const dir = folder({
      "CLAUDE.md": "# P\n",
      ".cursor/cli.json": J({ permissions: { allow: ["Shell(ls)", `Shell(mysql -uroot -p${PW} shop)`], deny: [] } }),
      ".gemini/settings.json": J({ tools: { allowed: ["run_shell_command(git status)", `run_shell_command(curl -H "Authorization: Bearer ${TOKEN}" https://api.example.com)`] }, excludeTools: [`run_shell_command(PGPASSWORD=${PW} psql -h db.example.com)`] }),
    });
    const f = only((await audit(dir)).findings, "secret-in-permission-rule");
    expect(f.map((x) => `${x.path} ${x.message.split(" holds")[0]}`)).toEqual([".cursor/cli.json permissions.allow[1]", ".gemini/settings.json tools.allowed[1]", ".gemini/settings.json excludeTools[0]"]);
  });

  test("sec-permission-allow still fires on the same rule, with the secret masked in its quote", async () => {
    const { findings } = await audit(folder(allow(`Bash(curl -H "Authorization: Bearer ${TOKEN}" *)`)));
    expect(ids(findings).sort()).toEqual(["sec-permission-allow:warning", "secret-in-permission-rule:error"]);
    for (const f of findings) expect(f.message).not.toContain(TOKEN);
  });

  test("the fingerprint does not depend on the secret, so a short password cannot be guessed from it", async () => {
    const a = (await audit(folder(allow(`Bash(mysql -u root -p${PW} shop)`)))).findings[0]!;
    const b = (await audit(folder(allow(`Bash(mysql -u root -p${PW.replace("7", "8")} shop)`)))).findings[0]!;
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  test("no raw secret in text, JSON, SARIF, structured output or notes", async () => {
    const dir = folder({
      "CLAUDE.md": "# P\n",
      ".claude/settings.json": J({ permissions: { allow: SECRETS.map((s, i) => (i % 2 ? `Bash(curl -H "Authorization: Bearer ${s}" https://api.example.com)` : `Bash(PGPASSWORD=${s} psql -h db.example.com)`)) } }),
      ".claude/settings.local.json": J({ permissions: { allow: [`Bash(mysql -uroot -p${PW} shop)`, `Bash(sshpass -p ${PW} ssh a@203.0.113.9)`] } }),
    });
    const sb = await Sandbox.create([dir]);
    const p = await lintProject(sb, { include: ["config-local"], deadline: deadline() });
    const report = JSON.stringify(buildReport(".", p.results.length, p.findings()));
    const sarif = formatSarif(buildReport(".", p.results.length, p.findings()));
    const c = await connect([dir], { structured: true });
    const r = await c.call("lint_steering", { include: ["config-local"] });
    await c.close();
    expect(only(p.findings(), "secret-in-permission-rule").length).toBe(7);
    for (const out of [report, sarif, r.text, JSON.stringify(r.structured), p.notes.join("\n")]) {
      for (const key of SECRETS) {
        expect(out).not.toContain(key);
        expect(out).not.toContain(key.slice(2, 12));
      }
    }
  });
});

describe("gitignore matching", () => {
  const tree = (files: Record<string, string>): IgnoreTree => {
    const t = new IgnoreTree();
    for (const [dir, text] of Object.entries(files)) t.add(dir, parseGitignore(text));
    return t;
  };

  test.each([
    // [root .gitignore, path, ignored]
    [".claude/settings.local.json", ".claude/settings.local.json", true],
    [".claude/settings.local.json", "pkg/.claude/settings.local.json", false], // anchored
    ["**/.claude/settings.local.json", "pkg/.claude/settings.local.json", true],
    ["settings.local.json", "a/b/.claude/settings.local.json", true], // a bare name matches at any depth
    [".claude/", ".claude/settings.local.json", true],
    [".claude/*\n!.claude/settings.json", ".claude/settings.local.json", true],
    [".claude/*\n!.claude/settings.json", ".claude/settings.json", false],
    [".claude\n!.claude/settings.local.json", ".claude/settings.local.json", true], // the folder is excluded: no way back in
    ["*.local.*", "CLAUDE.local.md", true],
    ["CLAUDE.local.md   ", "CLAUDE.local.md", true], // trailing spaces dropped
    ["CLAUDE.local.md\\ ", "CLAUDE.local.md", false], // an escaped space stays
    ["\\#notes", "#notes", true],
    ["# CLAUDE.local.md", "CLAUDE.local.md", false],
    ["[Cc]laude.local.md", "claude.local.md", true],
    ["[!C]LAUDE.local.md", "CLAUDE.local.md", false],
    ["CLAUDE.local.m?", "CLAUDE.local.md", true],
    ["a/**/b", "a/b", true],
    ["a/**/b", "a/x/y/b", true],
    ["a/**/b", "ab", false],
    ["**/foo", "xfoo", false],
    ["foo/**", "foo", false],
    ["foo/**", "foo/x/y", true],
    ["foo/", "foo", false], // a file named foo is not a folder
    ["/root-only", "sub/root-only", false],
    ["*", "anything/at/all", true],
  ])("%j on %s -> %s", (gi, p, want) => {
    expect(tree({ "": gi }).ignored(p)).toBe(want);
  });

  test("a deeper .gitignore wins, and its patterns are relative to its folder", () => {
    const t = tree({ "": "*.local.md\n", pkg: "!CLAUDE.local.md\n/only-here\n" });
    expect(t.ignored("CLAUDE.local.md")).toBe(true);
    expect(t.ignored("pkg/CLAUDE.local.md")).toBe(false);
    expect(t.ignored("pkg/only-here")).toBe(true);
    expect(t.ignored("only-here")).toBe(false);
    expect(t.ignored("pkg/sub/only-here")).toBe(false);
  });

  test("CRLF, a BOM and a trailing backslash", () => {
    const pats = parseGitignore("\ufeffa.md\r\nb.md\r\nbad\\\n");
    expect(pats.length).toBe(2);
    expect(tree({ "": "\ufeffa.md\r\n" }).ignored("a.md")).toBe(true);
  });

  test("hostile patterns and paths stay linear", () => {
    const pat = parseGitignore("*a".repeat(500) + "b\n")[0]!;
    const long = "a".repeat(4000);
    let t0 = performance.now();
    expect(globMatch(pat.toks, long)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
    const deep = parseGitignore("**/".repeat(300) + "x\n")[0]!;
    t0 = performance.now();
    expect(globMatch(deep.toks, "a/".repeat(2000) + "y")).toBe(false);
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
    t0 = performance.now();
    const many = parseGitignore("[a-\n[!\n\\\n**\n!*\n".repeat(400_000)); // about 10 MB
    expect(many.length).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
  });
});

describe("local-agent-file-not-ignored", () => {
  test("settings.local.json and CLAUDE.local.md that no .gitignore covers are warnings", async () => {
    const dir = folder({ "CLAUDE.md": "# P\n", "CLAUDE.local.md": "# mine\n", ".claude/settings.local.json": "{}\n", ".gitignore": "node_modules/\n" });
    const f = only((await audit(dir)).findings, "local-agent-file-not-ignored");
    expect(f.map((x) => `${x.path}:${x.severity}`)).toEqual([".claude/settings.local.json:warning", "CLAUDE.local.md:warning"]);
    expect(f[0]!.message).toMatch(/no \.gitignore in the repo covers it/);
    expect(f[0]!.message).toContain('add "**/.claude/settings.local.json" to .gitignore');
  });

  test("covered by the root or a nested .gitignore, or kept on purpose with a negation: nothing", async () => {
    expect(only((await audit(folder({ "CLAUDE.md": "# P\n", ".claude/settings.local.json": "{}\n", ".gitignore": "**/.claude/settings.local.json\n" }))).findings, "local-agent-file-not-ignored")).toEqual([]);
    expect(only((await audit(folder({ "CLAUDE.md": "# P\n", "app/.claude/settings.local.json": "{}\n", "app/.gitignore": ".claude/settings.local.json\n" }))).findings, "local-agent-file-not-ignored")).toEqual([]);
    const neg = folder({ "CLAUDE.md": "# P\n", ".claude/settings.local.json": "{}\n", ".gitignore": ".claude/*\n!.claude/settings.local.json\n" });
    expect(only((await audit(neg)).findings, "local-agent-file-not-ignored")).toEqual([]);
    // A negation for something else does not count.
    const other = folder({ "CLAUDE.md": "# P\n", ".claude/settings.local.json": "{}\n", ".gitignore": ".claude/*\n!.claude/settings.json\n!.claude/settings.local.json.example\n" });
    expect(only((await audit(other)).findings, "local-agent-file-not-ignored")).toEqual([]); // .claude/* covers it
    const nested = folder({ "CLAUDE.md": "# P\n", "app/.claude/settings.local.json": "{}\n", ".gitignore": ".claude/*\n" });
    expect(only((await audit(nested)).findings, "local-agent-file-not-ignored").map((x) => x.path)).toEqual(["app/.claude/settings.local.json"]); // anchored to the root
  });

  test("credential files are errors; templates and other names are not reported", async () => {
    const dir = folder({
      "CLAUDE.md": "# P\n",
      ".claude/.credentials.json": "{}\n",
      ".codex/auth.json": "{}\n",
      ".gemini/oauth_creds.json": "{}\n",
      ".claude/settings.local.json.bak": "{}\n",
      ".claude/settings.local.json.template": "{}\n",
      ".claude/settings.local.json.example": "{}\n",
      ".claude/agent-memory-local/reviewer/MEMORY.md": "# m\n",
      "docs/settings.local.json": "{}\n",
    });
    const f = only((await audit(dir)).findings, "local-agent-file-not-ignored");
    expect(f.map((x) => `${x.path}:${x.severity}`)).toEqual([
      ".claude/.credentials.json:error",
      ".claude/agent-memory-local/reviewer/MEMORY.md:warning",
      ".claude/settings.local.json.bak:warning",
      ".codex/auth.json:error",
      ".gemini/oauth_creds.json:error",
    ]);
  });

  test("not at the top of a git checkout: nothing is checked", async () => {
    const dir = folder({ "CLAUDE.md": "# P\n", "CLAUDE.local.md": "# mine\n", ".claude/settings.local.json": "{}\n" }, { git: false });
    const r = await audit(dir);
    expect(only(r.findings, "local-agent-file-not-ignored")).toEqual([]);
    expect(r.notes.join("\n")).not.toMatch(/Leak scan/);
  });

  test("folders a .gitignore excludes are not walked, and nested repositories are skipped", async () => {
    const dir = folder({ "CLAUDE.md": "# P\n", "tmp/CLAUDE.local.md": "# x\n", "third_party/lib/.git/HEAD": "ref\n", "third_party/lib/CLAUDE.local.md": "# x\n", ".gitignore": "tmp/\n" });
    expect(only((await audit(dir)).findings, "local-agent-file-not-ignored")).toEqual([]);
  });

  test("without include config nothing extra runs", async () => {
    const dir = folder({ "CLAUDE.md": "# P\n", "CLAUDE.local.md": "# mine\n" });
    const sb = await Sandbox.create([dir]);
    const p = await lintProject(sb, { deadline: deadline() });
    expect(p.findings().filter((f) => f.ruleId === "local-agent-file-not-ignored")).toEqual([]);
  });

  test("named files: a staged settings.local.json is reported and claimed", async () => {
    const dir = folder({ "CLAUDE.md": "# P\n", ".claude/settings.local.json": "{}\n", ".gitignore": "dist/\n" });
    const sb = await Sandbox.create([dir]);
    const p = await lintProject(sb, { include: ["config"], deadline: deadline(), targets: [".claude/settings.local.json"] });
    expect(ids(p.findings())).toEqual(["local-agent-file-not-ignored:warning"]);
    expect(p.failures).toEqual([]);
  });

  test("classification", () => {
    expect(localAgentFile(".claude/settings.local.json")?.credential).toBe(false);
    expect(localAgentFile("a/b/.claude/settings.local.json~")).not.toBeNull();
    expect(localAgentFile(".claude/settings.local.json.sample")).toBeNull();
    expect(localAgentFile(".claude/settings.json")).toBeNull();
    expect(localAgentFile("CLAUDE.md")).toBeNull();
    expect(localAgentFile(".claude.json")?.credential).toBe(true);
  });
});

describe("agent-transcript-in-repo", () => {
  const UUID = "3f2a9c4e-8b1d-4e6f-a2c7-5d9e0b1f4a6c";
  const UUID2 = "9b1c2d3e-4f50-4a6b-8c7d-0e1f2a3b4c5d";
  const line = (o: Record<string, unknown>): string => JSON.stringify(o) + "\n";
  const transcript = line({ parentUuid: null, isSidechain: false, userType: "external", cwd: "/home/dev/shop", sessionId: UUID, type: "user", message: { role: "user", content: "zebra-canary-words" } });

  test("a copied ~/.claude/projects folder is one warning per project folder, with a count", async () => {
    const dir = folder({ "CLAUDE.md": "# P\n", [`notes/-home-dev-shop/${UUID}.jsonl`]: transcript, [`notes/-home-dev-shop/${UUID2}.jsonl`]: transcript, "notes/-home-dev-shop/memory/MEMORY.md": "# m\n" });
    const f = only((await audit(dir)).findings, "agent-transcript-in-repo");
    expect(f.map((x) => `${x.path}:${x.severity}`)).toEqual([`notes/-home-dev-shop/${UUID}.jsonl:warning`, "notes/-home-dev-shop/memory/MEMORY.md:warning"]);
    expect(f[0]!.message).toMatch(/^notes\/-home-dev-shop\/ \(2 files\) holds Claude Code session transcripts/);
    expect(f[0]!.message).not.toContain("zebra-canary"); // content is never quoted
  });

  test("a bare <uuid>.jsonl counts only when its first bytes look like a transcript", async () => {
    const dir = folder({ "CLAUDE.md": "# P\n", [`logs/${UUID}.jsonl`]: transcript, [`data/${UUID2}.jsonl`]: line({ id: 1, text: "row" }) });
    const f = only((await audit(dir)).findings, "agent-transcript-in-repo");
    expect(f.map((x) => x.path)).toEqual([`logs/${UUID}.jsonl`]);
  });

  test("Codex rollouts, Aider history, and SpecStory as a note", async () => {
    const dir = folder({
      "CLAUDE.md": "# P\n",
      [`sessions/2026/11/02/rollout-2026-11-02T10-11-12-${UUID}.jsonl`]: "{}\n",
      ".aider.chat.history.md": "# aider chat\n",
      ".specstory/history/2026-11-01_10-00-00Z-fix-login.md": "# chat\n",
      ".specstory/.what-is-this.md": "# info\n",
    });
    const f = only((await audit(dir)).findings, "agent-transcript-in-repo");
    expect(f.map((x) => `${x.path}:${x.severity}`)).toEqual([".aider.chat.history.md:warning", ".specstory/history/2026-11-01_10-00-00Z-fix-login.md:note", `sessions/2026/11/02/rollout-2026-11-02T10-11-12-${UUID}.jsonl:warning`]);
  });

  test("ignored transcripts and look-alikes are not reported", async () => {
    const dir = folder({
      "CLAUDE.md": "# P\n",
      ".aider.chat.history.md": "# aider\n",
      [`.claude/projects/-home-dev-shop/${UUID}.jsonl`]: transcript,
      ".gitignore": ".aider*\n.claude/projects/\n",
      "docs/history.jsonl": "{}\n",
      "test/fixtures/session.jsonl": transcript,
      "memory/MEMORY.md": "# not a copied memory folder\n",
    });
    expect(only((await audit(dir)).findings, "agent-transcript-in-repo")).toEqual([]);
  });

  test("one finding per copy: a whole ~/.claude/projects backup, Codex days, Aider files in one folder", async () => {
    const dir = folder({
      "CLAUDE.md": "# P\n",
      [`backup/.claude/projects/-home-a-x/${UUID}.jsonl`]: transcript,
      [`backup/.claude/projects/-home-a-y/${UUID2}.jsonl`]: transcript,
      [`.codex/sessions/2026/11/01/rollout-2026-11-01T10-11-12-${UUID}.jsonl`]: "{}\n",
      [`.codex/sessions/2026/11/02/rollout-2026-11-02T10-11-12-${UUID2}.jsonl`]: "{}\n",
      ".aider.chat.history.md": "# a\n",
      ".aider.input.history": "a\n",
    });
    const f = only((await audit(dir)).findings, "agent-transcript-in-repo");
    expect(f.map((x) => x.message.split(" holds")[0])).toEqual([".aider* (2 files)", ".codex/sessions/ (2 files)", "backup/.claude/projects/ (2 files)"]);
  });

  test("test fixtures, examples and templates are left alone", async () => {
    const dir = folder({
      "CLAUDE.md": "# P\n",
      [`fixtures/claude/-home-dev-x/${UUID}.jsonl`]: transcript,
      "test/data/.aider.chat.history.md": "# a\n",
      "templates/CLAUDE.local.md": "# template\n",
      "examples/app/.claude/settings.local.json": "{}\n",
    });
    const f = (await audit(dir)).findings;
    expect(only(f, "agent-transcript-in-repo")).toEqual([]);
    expect(only(f, "local-agent-file-not-ignored")).toEqual([]);
  });

  test("signals and the transcript shape", () => {
    expect(transcriptSignal(`.claude/projects/-Users-me-app/${UUID}.jsonl`)?.what).toMatch(/copied from ~\/\.claude\/projects/);
    expect(transcriptSignal(`x/C--Users-me-app/${UUID}.jsonl`)?.what).toBe("Claude Code session transcripts");
    expect(transcriptSignal(".claude/history.jsonl")?.what).toBe("Claude Code prompt history");
    expect(transcriptSignal(".claude/skills/x/SKILL.md")).toBeNull();
    expect(transcriptSignal(`data/${UUID}.jsonl`)?.needsHead).toBe(true);
    expect(looksLikeTranscript(transcript)).toBe(true);
    expect(looksLikeTranscript('{"sessionId":"x"}')).toBe(false);
  });
});

describe("what the widened policy reads", () => {
  test(".gitignore files are read only with include config, and only files named exactly .gitignore", async () => {
    const dir = folder({ ".gitignore": "x\n", "a/b/.gitignore": "y\n", ".gitignore.bak": "z\n", "x.gitignore": "z\n", ".GITIGNORE": "z\n", "notes.txt": "n\n", "a/.gitignore-old": "z\n" });
    const sb = await Sandbox.create([dir]);
    await expect(sb.openAs("agent-config", ".gitignore")).rejects.toThrow(/not enabled without include "config"/);
    const g = new Set(["config"]);
    await expect(sb.openAs("agent-config", ".gitignore", { grants: g })).resolves.toBeTruthy();
    await expect(sb.openAs("agent-config", "a/b/.gitignore", { grants: g })).resolves.toBeTruthy();
    for (const rel of [".gitignore.bak", "x.gitignore", "notes.txt", "a/.gitignore-old"]) {
      await expect(sb.openAs("agent-config", rel, { grants: g })).rejects.toThrow(/not one of the agent config files/);
    }
    // .GITIGNORE: refused on a case-sensitive file system; on macOS and Windows it is the same file as .gitignore.
    const upper = await sb.openAs("agent-config", ".GITIGNORE", { grants: g }).then(
      () => "read",
      () => "refused",
    );
    expect(["read", "refused"]).toContain(upper);
  });

  test("a .gitignore that is a symlink to a secret or outside the root is refused", async () => {
    const outside = folder({ "secret.txt": "s\n" }, { git: false });
    const dir = folder({ ".env": "TOKEN=x\n", "notes.txt": "n\n" });
    try {
      symlinkSync(path.join(dir, ".env"), path.join(dir, "a.gitignore-link"));
      mkdirSync(path.join(dir, "p"));
      mkdirSync(path.join(dir, "q"));
      mkdirSync(path.join(dir, "r"));
      symlinkSync(path.join(dir, ".env"), path.join(dir, "p", ".gitignore"));
      symlinkSync(path.join(dir, "notes.txt"), path.join(dir, "q", ".gitignore"));
      symlinkSync(path.join(outside, "secret.txt"), path.join(dir, "r", ".gitignore"));
    } catch {
      return; // no symlink permission (Windows without developer mode)
    }
    const sb = await Sandbox.create([dir]);
    const g = new Set(["config"]);
    await expect(sb.openAs("agent-config", "p/.gitignore", { grants: g })).rejects.toThrow(/environment file/);
    await expect(sb.openAs("agent-config", "q/.gitignore", { grants: g })).rejects.toThrow(/not one of the agent config files/);
    await expect(sb.openAs("agent-config", "r/.gitignore", { grants: g })).rejects.toThrow(/outside the allowed folder/);
  });

  test(".gitignore inside .git or node_modules, and paths outside the root, are refused", async () => {
    const dir = folder({ ".git/info/.gitignore": "x\n", "node_modules/pkg/.gitignore": "x\n" });
    const sb = await Sandbox.create([dir]);
    const g = new Set(["config"]);
    await expect(sb.openAs("agent-config", ".git/info/.gitignore", { grants: g })).rejects.toThrow(/inside \.git/);
    await expect(sb.openAs("agent-config", "node_modules/pkg/.gitignore", { grants: g })).rejects.toThrow(/node_modules/);
    await expect(sb.openAs("agent-config", "../.gitignore", { grants: g })).rejects.toThrow(/outside the allowed folder/);
  });

  test("transcript-named files: only a 4 KB head with config; other .jsonl files never", async () => {
    const UUID = "3f2a9c4e-8b1d-4e6f-a2c7-5d9e0b1f4a6c";
    const dir = folder({ [`${UUID}.jsonl`]: "x".repeat(10_000), "small.jsonl": "{}\n", [`${UUID}.json`]: "{}\n" });
    const sb = await Sandbox.create([dir]);
    await expect(sb.openAs("agent-config", `${UUID}.jsonl`, { headBytes: 4096 })).rejects.toThrow(/not enabled/);
    const g = new Set(["config"]);
    const f = await sb.openAs("agent-config", `${UUID}.jsonl`, { grants: g, headBytes: 4096 });
    expect(f.buf.length).toBe(4096);
    await expect(sb.openAs("agent-config", `${UUID}.jsonl`, { grants: g })).rejects.toThrow(/File too large/);
    for (const rel of ["small.jsonl", `${UUID}.json`]) await expect(sb.openAs("agent-config", rel, { grants: g })).rejects.toThrow(/not one of the agent config files/);
  });

  test("the local files themselves are still never read without config-local", async () => {
    const dir = folder({ ".claude/settings.local.json": "{}\n", "CLAUDE.local.md": "# m\n", ".claude/.credentials.json": "{}\n", ".codex/auth.json": "{}\n" });
    const sb = await Sandbox.create([dir]);
    const g = new Set(["config"]);
    await expect(sb.openAs("agent-config", ".claude/settings.local.json", { grants: g })).rejects.toThrow(/config-local/);
    for (const rel of [".claude/.credentials.json", ".codex/auth.json"]) await expect(sb.openAs("agent-config", rel, { grants: g })).rejects.toThrow(/not one of the agent config files/);
  });
});

describe("linear time", () => {
  const big = 300 * 1024;
  const fill = (unit: string, n = big): string => unit.repeat(Math.ceil(n / unit.length));
  const cases: Record<string, string> = {
    "bearer runs": fill("bearer "),
    "bearer then long value": "bearer " + "a1".repeat(big / 2),
    "authorization headers": fill("Authorization: "),
    "header flags": fill("-H x-api-key: "),
    "header names": "-H " + "a".repeat(big),
    "url schemes": fill("a://"),
    "url userinfo": fill("a://" + "b".repeat(300) + ":" + "c".repeat(1000)),
    "url at signs": fill("https://u:p@"),
    "assignments": fill("API_KEY=x "),
    "long assignment": "API_KEY=" + "a1".repeat(big / 2),
    "quotes": fill('"'),
    "single quotes": fill("'a"),
    "backslashes": fill("\\"),
    "separators": fill(";|&"),
    "mysql flags": "mysql " + fill("-pa1b2c3 "),
    "long flags": fill("--api-key "),
    "jwt-ish": fill("eyJ" + "a".repeat(20) + "."),
    "npm tokens": fill(":_authToken "),
    "localhost and urls": fill("localhost ://"),
    "localhost and ssh targets": "localhost " + fill(" a@b.c"),
    "localhost and long user parts": "localhost " + fill(" " + "a".repeat(70) + "@"),
    "localhost and dotted hosts": "localhost x@" + fill("a.", big),
    "localhost and -h flags": "localhost " + fill("-h a.b "),
    "echo and sudo": fill("echo Qz9pLm2xWw | sudo -S x; "),
  };
  test.each(Object.keys(cases))("permissionSecrets: %s", (k) => {
    const t0 = performance.now();
    permissionSecrets(`Bash(${cases[k]!})`);
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
  });

  test("a 256 KB settings file of hostile rules goes through the whole audit within budget", async () => {
    const entries = Array.from({ length: 200 }, (_, i) => (i % 2 ? `Bash(${"bearer ".repeat(150)})` : `Bash(${"a://b:c@".repeat(100)})`));
    const dir = folder({ "CLAUDE.md": "# P\n", ".claude/settings.json": J({ permissions: { allow: entries } }) });
    const t0 = performance.now();
    await audit(dir);
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS * 2);
  });

  test("the walk stays within its limits on a wide tree", async () => {
    const files: Record<string, string> = { "CLAUDE.md": "# P\n" };
    for (let i = 0; i < 400; i++) files[`d${i}/f.txt`] = "x\n";
    const dir = folder(files);
    const t0 = performance.now();
    await audit(dir);
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS * 2);
  });
});
