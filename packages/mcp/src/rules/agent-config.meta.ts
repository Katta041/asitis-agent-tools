// Audit of .claude/settings.json and MCP config files (F9). Owner: WP6. Opt-in through
// include: ["config"]; "config-local" adds .claude/settings.local.json. The checks are in
// checks/agent-config.ts, and each one cites the doc it rests on next to the code.
// Docs and advisories read on 14 October 2026.

import { rule, SRC, type RuleMeta } from "./types.js";

const MCP_DOC = "https://code.claude.com/docs/en/mcp";
const PERMISSIONS_DOC = "https://code.claude.com/docs/en/permissions";
const APIIRO = "https://apiiro.com/blog/coding-agents-leaking-secrets-github-dont-ask-again";

export const AGENT_CONFIG_RULES: RuleMeta[] = [
  rule({
    id: "sec-hook-config",
    category: "security",
    defaultSeverity: "error",
    summary: "Project hook or settings command fetches remote code, calls the network or redirects the API",
    why: "Hooks in a committed .claude/settings.json run on every developer's machine, and a claude -p run starts them without the trust prompt (CVE-2025-59536). An ANTHROPIC_BASE_URL in project settings sends the API key to that host (CVE-2026-21852). With extends: strict, plain hooks are listed too, so a reviewer knows they exist.",
    source: SRC.hooks,
    severityVaries: "error, warning or note, by what the hook or setting does",
  }),
  rule({
    id: "sec-permission-allow",
    category: "security",
    defaultSeverity: "error",
    summary: "Allow rule or trust flag skips the prompt for any shell command, network tool or interpreter",
    why: "An allow rule runs the command without asking, so text the agent reads can trigger it. CVE-2025-55284 leaked .env contents through allowlisted ping and nslookup. Bash and Bash(*) allow every command and are errors; network tools, interpreters with a wildcard and an unscoped WebFetch are warnings.",
    source: PERMISSIONS_DOC,
    severityVaries: "error for Bash or Bash(*); a warning for network tools, interpreters with a wildcard and an unscoped WebFetch",
  }),
  rule({
    id: "sec-permission-mode",
    category: "security",
    defaultSeverity: "warning",
    summary: "Settings turn on bypassPermissions or skip its confirmation",
    why: "bypassPermissions runs every tool without asking. Since Claude Code 2.1.257 it has no effect from project or local settings, but older versions honored it, and the line shows what the author wanted.",
    source: SRC.settingsRef,
  }),
  rule({
    id: "sec-no-secret-deny",
    category: "security",
    defaultSeverity: "note",
    summary: "The folder has a .env file but no permissions.deny rule keeps Claude Code out of it",
    why: "Claude Code reads files in the project without asking. The settings reference says to list files that hold keys and secrets in permissions.deny.",
    source: SRC.settingsRef,
  }),
  rule({
    id: "sec-mcp-launcher",
    category: "security",
    defaultSeverity: "warning",
    summary: "MCP server runs an unpinned package or image, a downloaded script, or connects over plain http",
    why: "npx, uvx or docker without an exact version or digest runs whatever was published last, after you approved an earlier one (the postmark-mcp backdoor shipped in version 1.0.16). mcp-remote before 0.1.16 has a command injection bug (CVE-2025-6514).",
    source: SRC.toolPoisoning,
  }),
  rule({
    id: "sec-mcp-inline-secret",
    category: "security",
    defaultSeverity: "error",
    summary: "A key or token is written in plain text in an MCP server or settings env block",
    why: "Committed keys leak to everyone who can read the repo. Every MCP config format can read the value from an environment variable instead. The message shows the key type and a redacted preview only.",
    source: MCP_DOC,
  }),
  // 0.4.0 leak audit. Docs read on 15 November 2026.
  rule({
    id: "secret-in-permission-rule",
    category: "security",
    defaultSeverity: "error",
    scope: "file",
    summary: "A password, token or key is written into a permission rule",
    why: "\"Yes, and don't ask again\" saves the whole approved command, password included, as an allow rule. Apiiro found secrets in 1,122 public settings.local.json files in November 2026, and gitleaks and TruffleHog both missed 19% of them. The message names the list, the entry and the kind of secret, never the value.",
    source: APIIRO,
  }),
  rule({
    id: "local-agent-file-not-ignored",
    category: "security",
    defaultSeverity: "warning",
    scope: "project",
    summary: "A local-only agent file is in the repo and no .gitignore covers it",
    why: "settings.local.json, CLAUDE.local.md and local subagent memory are personal by design. Claude Code ignores settings.local.json only through each user's global git excludes, so a clone or a second machine commits it. Sign-in files (.claude/.credentials.json, .codex/auth.json) are errors.",
    source: SRC.settings,
    severityVaries: "error for sign-in credential files and ~/.claude.json copies, a warning for the rest",
  }),
  rule({
    id: "agent-transcript-in-repo",
    category: "security",
    defaultSeverity: "warning",
    scope: "project",
    summary: "Agent session transcripts or copied agent state are in the repo",
    why: "Transcripts keep everything that passed through a tool in plain text: file contents, command output and pasted keys. Apiiro counted transcripts among the agent files that leaked 2,539 secrets on GitHub.",
    source: "https://code.claude.com/docs/en/claude-directory",
    severityVaries: "a note for SpecStory history, which is saved in the repo on purpose; a warning for the rest",
  }),
  rule({
    id: "config-json-invalid",
    category: "config",
    defaultSeverity: "error",
    summary: "Agent config file is not valid JSON",
    why: "Claude Code skips a settings file it cannot parse, and MCP clients drop the servers in it, so the permissions and servers are not what the author thinks.",
    source: SRC.settings,
  }),
];
