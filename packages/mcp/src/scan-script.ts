// Linear-time scanner for scripts and markdown in skill folders (F8). Owner: WP5.
// Same rules as scan.ts: forward indexOf, bounded slices, no nested or lazy quantifiers over
// unbounded input; test/skills-dos.test.ts holds it to the 3 s budget on 10 MB inputs.
//
// This is a capability inventory, not malware detection. Every pattern below is a fixed shape
// that real malicious skills used; a new payload written another way will not match.
//
// Sources, all read 14 October 2026:
// - Snyk ToxicSkills (https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/) and
//   OpenSourceMalware, "Malicious ClawHub Skills" (https://opensourcemalware.com/blog/clawdbot-skills-ganked-your-crypto):
//   "Prerequisites" sections with curl piped to bash, base64-decoded one-liners, password-protected
//   ZIPs, scripts that download, chmod +x and run (threat catalogue T10, T13, T24).
// - Snyk, "Weaponizing AI coding agents in the Nx package"
//   (https://snyk.io/blog/weaponizing-ai-coding-agents-for-malware-in-the-nx-malicious-package/):
//   claude --dangerously-skip-permissions, gemini --yolo and q chat --trust-all-tools (T21).
// - Claude Code CLI reference (https://code.claude.com/docs/en/cli-reference): --dangerously-skip-permissions
//   is "Equivalent to --permission-mode bypassPermissions"; --allow-dangerously-skip-permissions adds it to the mode cycle.
// - Codex CLI reference (https://developers.openai.com/codex/cli/reference): --dangerously-bypass-approvals-and-sandbox,
//   alias --yolo, "Run every command without approvals or sandboxing"; sandbox mode danger-full-access.
// - Gemini CLI reference (docs/cli/cli-reference.md in google-gemini/gemini-cli): --yolo "Auto-approve all
//   actions", and --approval-mode yolo.
// - Invariant Labs, tool poisoning (https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks):
//   reading ~/.ssh and MCP config and passing it on without telling the user (T14, used for sec-secret-egress).
// - Liu et al., "Do Not Mention This to the User" (https://arxiv.org/abs/2602.06547): covert instructions in skill
//   files and bundled scripts (T12, used for sec-script-instruction).
// - Aikido, "Glassworm returns" (https://www.aikido.dev/blog/glassworm-returns-unicode-attack-github-npm-vscode):
//   payloads packed into variation selectors inside code (T4, used for sec-script-invisible).
// - Claude Code skills docs (https://code.claude.com/docs/en/skills), "Inject dynamic context": the
//   !`<command>` syntax and ```! blocks "run shell commands before the skill content is sent to Claude".
//   Checked by hand on Claude Code (14 October 2026): with !`echo got-$ARGUMENTS-end` in a skill body,
//   /argtest "a;echo hello" printed "got-a" and then "hello-end", so the argument text reached the shell.

import { preview } from "./redact.js";
import { q } from "./escape.js";
import { LineIndex } from "./text.js";
import { fenceMask } from "./scan.js";

export type HitSeverity = "error" | "warning" | "info";

export interface ScriptHit {
  ruleId: string;
  severity: HitSeverity;
  /** 1-based. */
  line: number;
  column: number;
  endColumn: number;
  /** The whole message. File text appears only inside q() quotes, at most 80 characters in total, redacted. */
  message: string;
}

/**
 * script: a file with a script extension or a #! line. skill-md: the body of SKILL.md or a Claude Code
 * command, which the agent follows and whose !`...` lines run in a shell. skill-doc: other markdown in a
 * skill folder (references the skill points the agent to). readme: README.md in a skill folder, which
 * people read; install snippets there are expected, so findings are notes.
 */
export type ScriptSource = "script" | "skill-md" | "skill-doc" | "readme";

export interface ScanOptions {
  /** markdown only: 0-based last line of frontmatter, skipped. */
  skipUntilLine?: number;
  /** script only: true for shell scripts (by extension or #! line), which enables backtick substitution. */
  shell?: boolean;
  /** skill-md only: names declared in the arguments frontmatter key, for $name placeholders. */
  argNames?: readonly string[];
}

/** Findings kept per rule per file; one more note says how many were left out. */
export const MAX_HITS_PER_RULE = 50;
/** File text quoted in one message, at most. */
export const QUOTE_BUDGET = 80;
/** Long lines are scanned in windows this long, overlapping by WINDOW_OVERLAP, so per-line work stays bounded. */
const WINDOW = 8192;
const WINDOW_OVERLAP = 512;
/** Backslash-continued lines joined into one logical line, at most. */
const MAX_JOIN_LINES = 50;
const MAX_JOIN_CHARS = 64 * 1024;
/** Encoded runs decoded per file, and characters decoded per run. */
const MAX_DECODES = 256;
const MAX_DECODE_CHARS = 4096;

// ---------------------------------------------------------------------------
// Quoting

/** Spends a fixed budget of quoted file text across one message. */
class Quote {
  private left = QUOTE_BUDGET;
  /** q(preview(text)) cut to at most max characters of what is left. */
  take(text: string, max = QUOTE_BUDGET): string {
    const n = Math.max(0, Math.min(max, this.left));
    if (n < 4) return '""';
    const p = preview(text.trim(), n);
    this.left -= p.length;
    return q(p, 4 * QUOTE_BUDGET); // p is already cut to n; q must not cut it again after escaping
  }
}

// ---------------------------------------------------------------------------
// Word lists and patterns. Every pattern is a literal alternation or has bounded repeats.

const DOWNLOADER = /\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b|\.Download(?:String|Data|File)\b/i;
/** Interpreters that run code they read on stdin. Lower case, path and .exe stripped. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "fish", "csh", "tcsh", "busybox"]);
const SCRIPTERS = new Set(["python", "python2", "python3", "py", "node", "nodejs", "perl", "ruby", "php", "deno", "bun", "osascript"]);
const PWSH = new Set(["pwsh", "powershell"]);
const IEX = new Set(["iex", "invoke-expression"]);
const DECODER = /\bbase64\s{1,8}(?:-[a-zA-Z]{0,4}[dD]\b|--decode\b)|\bxxd\s{1,8}(?:-[a-z]{1,4}\s{1,8}){0,3}-r|\bopenssl\s{1,8}(?:base64|enc)\b[^|]{0,40}\s-d\b|\bcertutil\s{1,8}-decode\b|\buudecode\b/i;
const CODE_DECODE = /\bb64decode\s*\(|\bdecodebytes\s*\(|\bbase64\.(?:urlsafe_|standard_)?b(?:64|32|85)decode|\ba85decode\s*\(|\batob\s*\(|Buffer\.from\s*\([^)\n]{0,120}["'](?:base64|hex)["']|FromBase64String|\bbytes\.fromhex\s*\(|\bunhexlify\s*\(|\bcodecs\.decode\s*\(|\bzlib\.decompress\s*\(|\bmarshal\.loads\s*\(/;
const CODE_SINK = /(?<![.\w$])(?:exec|eval|compile)\s*\(|\bnew\s+Function\s*\(|\bvm\.runIn\w{0,20}\s*\(|\bos\.(?:system|popen)\s*\(|\bsubprocess\.\w{1,20}\s*\(|\.(?:execSync|spawnSync|execFile|spawn)\s*\(|\bInvoke-Expression\b|(?<![\w-])iex\b|\bpickle\.loads\s*\(/i;
const FETCHED = /\burlopen\s*\(|\brequests\.(?:get|post)\s*\(|\bhttpx\.(?:get|post)\s*\(|\burllib\.request\b|\bfetch\s*\(|\baxios(?:\.get)?\s*\(|\bhttps?\.get\s*\(|\.Download(?:String|Data)\b|\bInvoke-(?:WebRequest|RestMethod)\b|(?<![\w-])i(?:wr|rm)\b/i;
const PS_ENCODED = /\b(?:pwsh|powershell)(?:\.exe)?\b[^\n]{0,80}\s-(?:e|ec|enc|encodedcommand)\s{1,8}[A-Za-z0-9+/=]{16}/i;
const UNZIP_PASSWORD = /\bunzip\s{1,8}(?:-[a-zA-Z]{1,6}\s{1,8}){0,4}-P\s{0,4}\S|\b7z\s{1,8}[xe]\b[^\n]{0,80}\s-p\S/;
const QUARANTINE = /\bxattr\s{1,8}(?:-[a-z]{1,3}\s{1,8}){0,3}(?:-d\s{1,8}com\.apple\.quarantine|-c\b|-cr\b)/;

const SAFETY_OFF = /--(?:allow-)?dangerously-skip-permissions\b|\bbypassPermissions\b|--dangerously-bypass-approvals-and-sandbox\b|--approval-mode[= ]["']?yolo\b|--trust-all-tools\b|\bdanger-full-access\b|chat\.tools\.(?:global\.)?autoApprove["']?\s{0,4}:\s{0,4}true\b|--yolo\b/;
const AGENT_CLI = /\b(?:claude|codex|gemini|qwen|cursor-agent|copilot|opencode|crush|amp)\b/i;

/** Secret sources that are dangerous to read at all: keys, credential stores, wallets. */
const STRONG_SOURCE: ReadonlyArray<[RegExp, string]> = [
  [/\bid_(?:rsa|dsa|ecdsa|ed25519)\b(?!\.pub)/, "SSH private key"],
  [/(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%|expanduser\(["']~)[/\\]\.ssh(?:[/\\]\*|[/\\]?["'`)\s]|[/\\]?$)/, "the ~/.ssh folder"],
  [/\.aws[/\\]credentials\b/, "AWS credentials file"],
  [/\.config[/\\]gcloud\b|\.azure[/\\](?:accessTokens|msal_token_cache)/, "cloud CLI credentials"],
  [/\.kube[/\\]config\b/, "Kubernetes config"],
  [/\.docker[/\\]config\.json\b/, "Docker credentials"],
  [/\.git-credentials\b|(?:~|\$HOME)[/\\]\.netrc\b/, "git or netrc credentials"],
  [/\.claude[/\\]\.credentials\.json\b|(?:~|\$HOME)[/\\]\.claude\.json\b|\.cursor[/\\]mcp\.json\b/, "agent credentials or MCP config"],
  [/\bsecurity\s{1,8}(?:find-generic-password|find-internet-password|dump-keychain)\b|Library[/\\]Keychains\b/, "the macOS keychain"],
  [/Login Data\b|[/\\]Cookies["'\s]|Local State["'\s]/, "browser password or cookie store"],
  [/\bwallet\.dat\b|\.electrum\b|Exodus[/\\]|\.bitcoin[/\\]|MetaMask|\bkeystore[/\\]UTC--/, "a crypto wallet"],
  [/\/etc\/shadow\b/, "/etc/shadow"],
  [/\.gnupg\b|\.password-store\b/, "GPG keys or a password store"],
];
/** Any strong source, tested before the per-source loop. */
const STRONG_ANY = new RegExp(STRONG_SOURCE.map(([re]) => `(?:${re.source})`).join("|"));
/** Lines that use a key without reading it out (ssh -i key host, ssh-keygen -f key). */
const KEY_USE = /\b(?:ssh-keygen|ssh-add|ssh-keyscan|ssh-copy-id)\b|\b(?:ssh|scp|sftp|rsync)\s[^\n]{0,80}-i\s|IdentityFile|known_hosts|authorized_keys|GIT_SSH_COMMAND/;
/** Weaker sources: count only when the same line also sends data out (cat .env | curl). */
const WEAK_SOURCE: ReadonlyArray<[RegExp, string]> = [
  [/(?:\bcat|\bless|\bhead|\btail|Get-Content|\bopen\s*\(|readFileSync\s*\(|read_text\s*\(|<|@)\s{0,4}["']?(?:[\w./~-]{0,80}[/\\])?\.env\b(?!\.example|\.sample|\.template)/, "a .env file"],
  [/\bprintenv\b|(?:^|[;&|(]\s*)env\s*(?:\||$)|JSON\.stringify\s*\(\s*process\.env\b|json\.dumps\s*\(\s*(?:dict\s*\(\s*)?os\.environ\b|Get-ChildItem\s{1,4}env:/, "every environment variable"],
  [/\bgh\s{1,4}auth\s{1,4}token\b/, "the GitHub CLI token"],
  [/\.npmrc\b|\.pypirc\b/, "a package registry token file"],
];
const SINK = /\b(?:curl|wget|nc|ncat|netcat|socat|scp|sftp|rsync|nslookup|dig|Invoke-WebRequest|Invoke-RestMethod|smtplib|sendmail|aiohttp|httpx|axios|XMLHttpRequest|urlopen)\b|(?<![\w-])i(?:wr|rm)\b|\/dev\/tcp\/|\brequests\.(?:post|put|patch|get|request)\b|urllib\.request|http\.client|\bhttps?\.request\b|\bfetch\s*\(|Net\.WebClient|\bgh\s{1,4}gist\s{1,4}create\b|discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com|webhook\.site|requestbin|pipedream\.net|ngrok|interact\.sh|burpcollaborator/i;
/** Prose that sends something somewhere: "send it to https://...". Markdown only. */
const PROSE_SINK = /\b(?:send|upload|post|exfiltrate|transmit|forward|submit)\b[^\n]{0,80}https?:\/\//i;
const NET_API = /\b(?:curl|wget|nc|ncat|socat|Invoke-WebRequest|Invoke-RestMethod|urlopen|aiohttp|httpx|axios|XMLHttpRequest|WebSocket|websockets?)\b|(?<![\w-])i(?:wr|rm)\b|\/dev\/tcp\/|\brequests\.(?:get|post|put|patch|delete|head|request|Session)\b|urllib\.request|urllib3|http\.client|\bhttps?\.(?:request|get)\s*\(|\bfetch\s*\(|Net\.WebClient|\bsocket\.(?:create_connection|socket)\b|\bnet\.(?:connect|createConnection)\s*\(/i;
const URL_HOST = /\bhttps?:\/\/([^\s/"'`<>()\]\\?#]{1,253})/gi;

/** Instructions aimed at the agent, in a tight form that ordinary code comments do not use. */
const INSTRUCTION: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:ignore|disregard|forget|override)\s{1,8}(?:all\s{1,8}|any\s{1,8})?(?:the\s{1,8}|your\s{1,8})?(?:previous|prior|above|earlier|system|other|original)\s{1,8}(?:instructions|prompts?|rules|directions|guidelines)\b/i, "tells the agent to ignore its other instructions"],
  [/\b(?:do\s{1,4}not|don't|dont|never)\s{1,8}(?:tell|mention|reveal|show|inform|notify|alert|disclose)\s{1,8}(?:this\s{1,8}|it\s{1,8}|anything\s{1,8})?(?:to\s{1,8})?(?:the\s{1,8})?user\b/i, "tells the agent to hide something from the user"],
  [/\bwithout\s{1,8}(?:telling|asking|informing|notifying|alerting)\s{1,8}(?:the\s{1,8})?user\b/i, "tells the agent to act without telling the user"],
  [/\bif\s{1,8}you\s{1,8}are\s{1,8}(?:an?\s{1,8})?(?:ai|llm|language\s{1,4}model|claude|copilot|cursor|gemini|codex|chatgpt|ai\s{1,4}(?:assistant|agent)|coding\s{1,4}agent)\b/i, "gives the agent instructions that depend on which AI it is"],
  [/(?:^|#|\/\/|\/\*|\*|--|REM\s)\s{0,8}(?:note\s{1,4}(?:to|for)\s{1,4}(?:the\s{1,4})?)?(?:ai|llm|claude|assistant|ai\s{1,4}agent|coding\s{1,4}agent)\s{0,2}[:,]\s{1,8}(?:you|please|always|never|do|run|ignore|execute|send|read|upload|delete)\b/i, "speaks to the AI agent directly"],
];

/**
 * A line that matches neither trigger cannot produce a finding, so the detectors are skipped for it.
 * Each alternative is a word or a short fixed shape that some detector needs.
 */
const TRIGGER = /[|`]|\$\(|<\(|curl|wget|\bi[wr][rm]\b|invoke-|download|base64|b64|atob|fromhex|unhexlify|codecs|zlib|marshal|exec|eval|compile|function|vm\.run|system|popen|subprocess|spawn|\biex\b|powershell|pwsh|unzip|\b7z\b|xattr|dangerously|bypasspermissions|yolo|approval-mode|trust-all|danger-full|autoapprove|instruction|prompt|rules|directions|guidelines|\buser\b|you\s{1,8}are|(?:ai|llm|claude|assistant|agent)\s{0,2}[:,]|\\x[0-9a-f]{2}|fromcharcode|[A-Za-z0-9+/_-]{24}/i;
const EGRESS_TRIGGER = /ssh|id_|\.aws|gcloud|\.azure|\.kube|\.docker|credentials|netrc|\.claude|\.cursor|security\s|keychain|login data|cookies|local state|wallet|electrum|exodus|bitcoin|metamask|keystore|shadow|gnupg|password-store|\.env|printenv|\benv\b|environ|gh\s{1,4}auth|npmrc|pypirc|curl|wget|\bn(?:c|cat|etcat)\b|socat|scp|sftp|rsync|nslookup|\bdig\b|invoke-|\bi[wr][rm]\b|smtp|sendmail|aiohttp|httpx|axios|xmlhttprequest|urlopen|\/dev\/tcp|requests\.|urllib|http|fetch|webclient|gist|webhook|requestbin|pipedream|ngrok|interact\.sh|burpcollaborator|send|upload|post|exfiltrat|transmit|forward|submit/i;

/** A download command that writes a file (curl -o, -O, --output, a redirect, wget, -OutFile). */
const OUTPUT_FLAG = /\s-[a-zA-Z]{0,6}[oO]\b|--output|>|-OutFile|\bwget\b/i;
const downloadsToFile = (t: string): boolean => DOWNLOADER.test(t) && OUTPUT_FLAG.test(t);
/** Something an encoded run needs: a long base64 or hex run, an escape run, or a decoder word (short runs). */
const BLOB_GATE = /[A-Za-z0-9+/_-]{24}|\\x[0-9a-fA-F]{2}|fromCharCode|base64|b64|atob|fromhex|unhexlify|xxd|certutil|uudecode|openssl/;

// ---------------------------------------------------------------------------
// Small helpers

const NEGATION = /\b(?:never|not|don't|dont|do\s{1,4}not|must\s{1,4}not|mustn't|should\s{1,4}not|shouldn't|avoid|avoiding|without|refuse|forbid|forbidden|prohibited|disallow|deny|instead\s{1,4}of)\b/gi;

/**
 * True when a negation governs the text at idx: "Never use --dangerously-skip-permissions",
 * "do not pipe curl ... | sh". The negation must come before idx in the same clause (no . ; : ! ? or
 * comma in between, so "Don't worry, run X" still fires) and within 80 characters.
 */
function classifyNegation(s: string, idx: number): boolean {
  const from = Math.max(0, idx - 80);
  const before = s.slice(from, idx);
  NEGATION.lastIndex = 0;
  let last = -1;
  for (const m of before.matchAll(NEGATION)) last = m.index + m[0].length;
  if (last < 0) return false;
  return !/[.;:!?,]/.test(before.slice(last));
}

/** The start of the word at or after pos (pos clamped to 0), so a quote never begins mid-word. */
function wordStart(s: string, pos: number): number {
  if (pos <= 0) return 0;
  const sp = s.indexOf(" ", pos);
  return sp === -1 || sp >= pos + 20 ? pos : sp + 1; // pos + 20 is the match itself
}

/** A markdown table row: starts with a pipe. */
const isTableRow = (s: string): boolean => /^\s{0,3}\|/.test(s);

const lc = (s: string): string => s.toLowerCase();

/** The command word of a shell segment, after sudo, env assignments and similar prefixes. */
function commandWords(seg: string): string[] {
  const words = seg.trim().split(/\s+/, 24).map(cleanToken).filter((w) => w.length > 0);
  let i = 0;
  while (i < words.length) {
    const w = lc(words[i]!);
    if (w === "sudo" || w === "doas" || w === "exec" || w === "command" || w === "nohup" || w === "time" || w === "then" || w === "do" || w === "-") {
      i++;
      while (i < words.length && words[i]!.startsWith("-") && w === "sudo") i++;
      continue;
    }
    if (w === "env" || /^[A-Za-z_][A-Za-z0-9_]{0,60}=/.test(words[i]!)) {
      i++;
      continue;
    }
    if ((w === "/usr/bin/env" || w.endsWith("/env")) && i + 1 < words.length) {
      i++;
      continue;
    }
    break;
  }
  return words.slice(i);
}

/** Quotes, backticks, brackets and statement ends around a token, and a trailing .exe. */
function cleanToken(t: string): string {
  let a = 0;
  let b = t.length;
  while (a < b && "\"'`({[$".includes(t[a]!)) a++;
  while (b > a && "\"'`)}];,&".includes(t[b - 1]!)) b--;
  return t.slice(a, b).replace(/\.exe$/i, "");
}

const base = (w: string): string => lc(w.slice(Math.max(w.lastIndexOf("/"), w.lastIndexOf("\\")) + 1));

/**
 * True when the segment runs an interpreter that reads its program from stdin:
 * `sh`, `bash -s`, `python3 -`, `node`, `iex`. `python3 script.py` and `sh -c '...'` read stdin as data.
 */
function readsStdinCode(seg: string): string | null {
  // In markdown a closing backtick ends the command: `curl ... | bash` (or ...).
  let a = 0;
  while (a < seg.length && (seg.charCodeAt(a) === 32 || seg.charCodeAt(a) === 9)) a++;
  const tick = seg.indexOf("`", seg.charCodeAt(a) === 96 ? a + 1 : a);
  const words = commandWords(tick === -1 ? seg : seg.slice(0, tick));
  if (!words.length) return null;
  const cmd = base(words[0]!);
  if (IEX.has(cmd)) return words[0]!;
  const isShell = SHELLS.has(cmd);
  const isScripter = SCRIPTERS.has(cmd) || /^python\d(?:\.\d{1,2})?$/.test(cmd);
  const isPwsh = PWSH.has(cmd);
  if (!isShell && !isScripter && !isPwsh) return null;
  for (let i = 1; i < words.length; i++) {
    const a = words[i]!;
    const la = lc(a);
    if (a === "-" || (isShell && a === "-s")) return words[0]!;
    if (a === "--") return isShell ? words[0]! : null;
    if (a.startsWith("-")) {
      if (isShell && /^-[a-z]*c/.test(a)) return null; // sh -c '...'
      if (isScripter && /^-(?:c|e|m|r|E|x|p)$/.test(a)) return null; // python -c, node -e, python -m mod
      if (isPwsh && /^-(?:c|command|f|file|enc|encodedcommand)$/.test(la)) return la === "-command" || la === "-c" ? (words[i + 1] === "-" ? words[0]! : null) : null;
      continue;
    }
    return null; // a script file name: stdin is data for it
  }
  return words[0]!;
}

/** The host of the first URL in text, or "". */
function firstHost(text: string): string {
  URL_HOST.lastIndex = 0;
  const m = URL_HOST.exec(text);
  return m ? cleanHost(m[1]!) : "";
}

function cleanHost(h: string): string {
  const at = h.lastIndexOf("@");
  let host = at >= 0 ? h.slice(at + 1) : h;
  if (!host.startsWith("[")) {
    const colon = host.indexOf(":");
    if (colon >= 0) host = host.slice(0, colon);
  }
  return lc(host);
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

/** Splits a line at single pipes (not ||). Returns segments with their start offsets. */
function pipeSegments(s: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let start = 0;
  let i = s.indexOf("|");
  while (i !== -1) {
    const dbl = s.charCodeAt(i + 1) === 124 || (i > 0 && s.charCodeAt(i - 1) === 124);
    if (!dbl) {
      out.push({ text: s.slice(start, i), start });
      start = s.charCodeAt(i + 1) === 38 ? i + 2 : i + 1; // |& in bash
    }
    i = s.indexOf("|", dbl ? i + 2 : i + 1);
  }
  out.push({ text: s.slice(start), start });
  return out;
}

/** Splits a line into simple commands at ;, && and ||, with their start offsets. */
function commandSegments(s: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 59 /* ; */) {
      out.push({ text: s.slice(start, i), start });
      start = i + 1;
    } else if ((c === 38 || c === 124) && s.charCodeAt(i + 1) === c) {
      out.push({ text: s.slice(start, i), start });
      start = i + 2;
      i++;
    }
  }
  out.push({ text: s.slice(start), start });
  return out;
}

// ---------------------------------------------------------------------------
// Encoded text

const PRINTABLE_MIN = 0.95;

/** Decoded bytes as text when they are mostly printable ASCII, else null. */
function printable(bytes: Uint8Array): string | null {
  if (bytes.length < 6) return null;
  let ok = 0;
  for (const b of bytes) if ((b >= 32 && b < 127) || b === 9 || b === 10 || b === 13) ok++;
  if (ok / bytes.length < PRINTABLE_MIN) return null;
  return Buffer.from(bytes).toString("latin1");
}

function decodeBase64(run: string): string | null {
  let r = run.length > MAX_DECODE_CHARS ? run.slice(0, MAX_DECODE_CHARS) : run;
  r = r.replace(/-/g, "+").replace(/_/g, "/");
  if (r.length % 4 === 1) r = r.slice(0, -1);
  return printable(Buffer.from(r, "base64"));
}

function decodeHex(run: string): string | null {
  const r = run.length > MAX_DECODE_CHARS ? run.slice(0, MAX_DECODE_CHARS) : run;
  return printable(Buffer.from(r.length % 2 ? r.slice(0, -1) : r, "hex"));
}

const COMMAND_WORDS = /^\s*(?:echo|printf|curl|wget|bash|sh|zsh|rm|python3?|node|nc|ncat|chmod|powershell|pwsh|iex|cat|eval|exec|sudo|perl|ruby|osascript|open|import\s|require\s*\(|from\s+\w+\s+import|os\.system|subprocess|Invoke-|IEX|cmd(?:\.exe)?\s+\/c|mkfifo|nohup|crontab|launchctl|security\s)/i;

/** What decoded text does, by the same rules as plain text, or null. Never recurses further. */
function judgeDecoded(text: string): string | null {
  const t = text.length > MAX_DECODE_CHARS ? text.slice(0, MAX_DECODE_CHARS) : text;
  for (const line of t.split(/\r?\n/, 64)) {
    const segs = pipeSegments(line);
    let dl = false;
    for (const s of segs) {
      if (dl && readsStdinCode(s.text)) return "downloads code and runs it";
      if (DOWNLOADER.test(s.text)) dl = true;
    }
    if (SAFETY_OFF.test(line)) return "turns off the agent's permission checks";
    for (const [re] of STRONG_SOURCE) if (re.test(line) && !KEY_USE.test(line)) return "reads a secret";
    for (const [re, label] of INSTRUCTION) if (re.test(line)) return label;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The scan

interface Line {
  /** 0-based physical line where the logical line starts. */
  first: number;
  /** Logical text: backslash-continued lines joined, at most MAX_JOIN_CHARS. */
  text: string;
  /** Inside a fenced code block (markdown) or a script. */
  code: boolean;
  /** Shell syntax: shell scripts and shell or untagged fences. */
  shell: boolean;
  /** Markdown table row outside code. */
  table: boolean;
}

interface Download {
  line: number;
  file: string;
}

export function scanScript(text: string, source: ScriptSource, opts: ScanOptions = {}): ScriptHit[] {
  const lines = new LineIndex(text);
  const isMd = source !== "script";
  const skip = opts.skipUntilLine ?? -1;
  const fence = isMd ? fenceMask(lines, skip) : new Uint8Array(0);
  const hits: ScriptHit[] = [];
  const perRule = new Map<string, number>();
  const seen = new Set<string>();
  const add = (h: ScriptHit): void => {
    const key = `${h.ruleId}\0${h.line}`;
    if (seen.has(key)) return;
    seen.add(key);
    const n = perRule.get(h.ruleId) ?? 0;
    perRule.set(h.ruleId, n + 1);
    if (n < MAX_HITS_PER_RULE) hits.push(h);
    else if (n === MAX_HITS_PER_RULE) hits.push({ ...h, severity: "info", message: `More ${h.ruleId} findings in this file were not listed` });
  };
  /** True once a rule has hit its cap in this file: its detectors are skipped from then on. */
  const capped = (rule: string): boolean => (perRule.get(rule) ?? 0) > MAX_HITS_PER_RULE;
  /** True when a hit for this rule on this 0-based line would be dropped, so its message is not built. */
  const full = (rule: string, line0: number): boolean => (perRule.get(rule) ?? 0) > MAX_HITS_PER_RULE || seen.has(`${rule}\0${line0 + 1}`);
  const lineLen = (i: number): number => lines.end(i) - lines.start(i);
  const at = (i: number, col0: number, len: number): Pick<ScriptHit, "line" | "column" | "endColumn"> => {
    const L = lineLen(i);
    if (col0 < 0 || col0 >= L) return { line: i + 1, column: 1, endColumn: L + 1 };
    return { line: i + 1, column: col0 + 1, endColumn: Math.min(L, col0 + Math.max(1, len)) + 1 };
  };
  // Download-and-run in SKILL.md and scripts is what the agent runs: error. In other markdown it is
  // nearly always a vendor install snippet a person reads (a README, a setup reference): a note.
  const sev = (kind: "exec" | "install" | "soft"): HitSeverity => {
    if (source === "readme") return "info";
    if (kind === "install") return source === "skill-doc" ? "info" : "error";
    if (kind === "exec") return source === "skill-doc" ? "warning" : "error";
    return "warning";
  };
  const where = source === "script" ? "this script" : source === "skill-md" ? "this skill" : "this file";

  // Fence language per line, for shell syntax in markdown.
  const fenceShell = isMd ? shellFences(lines, fence) : null;

  // Logical lines.
  const logical: Line[] = [];
  for (let i = skip + 1; i < lines.count; i++) {
    const code = !isMd || fence[i] === 1;
    const len = lines.end(i) - lines.start(i);
    // Lines under 4 characters cannot hold a finding. In markdown a blank line still ends a block.
    if (len < 4 && !(code && len > 0 && lines.text.charCodeAt(lines.end(i) - 1) === 92)) {
      if (isMd && (len === 0 || !lines.line(i).trim()) && logical.length && logical[logical.length - 1]!.text !== "") logical.push({ first: i, text: "", code, shell: false, table: false });
      continue;
    }
    if (isMd && code && isFenceLine(lines.line(i))) continue;
    let t = lines.line(i);
    const first = i;
    let joined = 1;
    if (code) {
      while (endsWithContinuation(t) && i + 1 < lines.count && joined < MAX_JOIN_LINES && t.length < MAX_JOIN_CHARS && (!isMd || fence[i + 1] === 1)) {
        i++;
        joined++;
        t = t.slice(0, -1) + " " + lines.line(i);
      }
    }
    if (t.length > MAX_JOIN_CHARS + WINDOW) t = t.slice(0, MAX_JOIN_CHARS + WINDOW);
    const shell = isMd ? (code ? fenceShell![first] === 1 : false) : !!opts.shell;
    const table = isMd && !code && isTableRow(t);
    // Long lines are cut into overlapping windows; each window is scanned as its own line.
    if (t.length <= WINDOW) logical.push({ first, text: t, code, shell, table });
    else for (let w = 0; w < t.length; w += WINDOW - WINDOW_OVERLAP) logical.push({ first, text: t.slice(w, w + WINDOW), code, shell, table });
  }

  const downloads: Download[] = [];
  let decodes = 0;
  let decoderVar: { name: string; line: number } | null = null;

  for (const L of logical) {
    const s = L.text;
    const li = L.first;
    // Markdown table rows: only code spans are commands.
    const scanText = L.table ? codeSpans(s) : s;
    if (!scanText) continue;
    if (!downloads.length && !TRIGGER.test(scanText)) continue;
    const execCapped = capped("sec-remote-exec") && capped("sec-encoded-blob");
    if (execCapped && capped("sec-safety-off") && (source !== "script" || capped("sec-script-instruction"))) break;
    // Cheap gates: each detector needs a character or word that most lines do not have.
    const hasPipe = scanText.includes("|");
    const hasParen = scanText.includes("(");
    const hasTick = scanText.includes("`");

    // sec-safety-off
    if (!capped("sec-safety-off")) {
      const m = SAFETY_OFF.exec(scanText);
      if (m && !full("sec-safety-off", li) && (m[0] !== "--yolo" || AGENT_CLI.test(scanText)) && !classifyNegation(scanText, m.index)) {
        const Q = new Quote();
        if (!full("sec-safety-off", li)) add({ ruleId: "sec-safety-off", severity: source === "readme" ? "info" : "warning", ...at(li, L.table ? -1 : m.index, m[0].length), message: `Turns off the agent's permission checks (${m[0]}): ${Q.take(scanText.slice(wordStart(scanText, m.index - 20)))}; with checks off, any instruction the agent reads can run commands without asking you; remove it, or run it only inside a throwaway container` });
      }
    }

    // Pipelines: download | interpreter, decode | interpreter.
    const segs = hasPipe && !execCapped ? pipeSegments(scanText) : [];
    if (segs.length > 1) {
      let dl: { start: number; text: string } | null = null;
      let dec: { start: number } | null = null;
      for (const seg of segs) {
        const interp = dl || dec ? readsStdinCode(seg.text) : null;
        if (interp) {
          if (dl) {
            if (full("sec-remote-exec", li) || classifyNegation(scanText, dl.start)) break;
            // Prose that talks about the pattern ("curl ... | bash") names no URL or variable to fetch.
            if (isMd && !L.code && !/https?:\/\/|\$\{?[A-Za-z_]/.test(dl.text)) break;
            const host = firstHost(dl.text);
            const Q = new Quote();
            if (!full("sec-remote-exec", li)) add({ ruleId: "sec-remote-exec", severity: sev("install"), ...at(li, L.table ? -1 : dl.start, seg.start + seg.text.length - dl.start), message: `Downloads code${host ? ` from ${Q.take(host, 40)}` : ""} and pipes it straight into ${Q.take(base(interp), 20)}${dec ? " after decoding it" : ""}: ${Q.take(scanText.slice(dl.start))}; whoever controls that server decides what runs on your machine; download the file, read it, then run it, or remove the step` });
          } else if (dec && !full("sec-encoded-blob", li) && !classifyNegation(scanText, dec.start)) {
            const Q = new Quote();
            if (!full("sec-encoded-blob", li)) add({ ruleId: "sec-encoded-blob", severity: sev("soft"), ...at(li, L.table ? -1 : dec.start, seg.start + seg.text.length - dec.start), message: `Decodes hidden text and pipes it into ${Q.take(base(interp), 20)}: ${Q.take(scanText.slice(Math.max(0, dec.start - 30)))}; encoding hides what runs from anyone reading the skill; replace it with the plain command so it can be reviewed` });
          }
          break;
        }
        if (!dl && DOWNLOADER.test(seg.text)) {
          const m = DOWNLOADER.exec(seg.text)!;
          dl = { start: seg.start + m.index, text: seg.text };
        }
        if (!dec && DECODER.test(seg.text)) dec = { start: seg.start + DECODER.exec(seg.text)!.index };
      }
    }

    // Command substitution: $(...), <(...), and backticks in shell, run as code.
    if ((L.code || !isMd) && !execCapped && (hasParen || (hasTick && L.shell))) substitutions(scanText, L.shell, (kind, open, inner) => {
      if (full(kind === "download" ? "sec-remote-exec" : "sec-encoded-blob", li) || classifyNegation(scanText, open)) return;
      const Q = new Quote();
      if (kind === "download") {
        const host = firstHost(inner);
        if (!full("sec-remote-exec", li)) add({ ruleId: "sec-remote-exec", severity: sev("install"), ...at(li, open, inner.length + 3), message: `Runs the output of a download as code${host ? ` from ${Q.take(host, 40)}` : ""}: ${Q.take(scanText.slice(Math.max(0, open - 12)))}; whoever controls that server decides what runs on your machine; download the file, read it, then run it, or remove the step` });
      } else {
        if (!full("sec-encoded-blob", li)) add({ ruleId: "sec-encoded-blob", severity: sev("soft"), ...at(li, open, inner.length + 3), message: `Decodes hidden text and runs it as code: ${Q.take(scanText.slice(Math.max(0, open - 12)))}; encoding hides what runs from anyone reading the skill; replace it with the plain command so it can be reviewed` });
      }
    });

    // PowerShell and script-language download-and-run on one line.
    if (!execCapped && (hasParen || /iex|invoke-|pwsh|powershell/i.test(scanText))) {
      const sink = CODE_SINK.exec(scanText);
      if (sink) {
        const rest = scanText.slice(sink.index);
        const f = FETCHED.exec(rest);
        if (f && !/^\s*\|/.test(rest) && !classifyNegation(scanText, sink.index)) {
          const Q = new Quote();
          if (!full("sec-remote-exec", li)) add({ ruleId: "sec-remote-exec", severity: sev("install"), ...at(li, sink.index, f.index + f[0].length), message: `Fetches code over the network and runs it in the same statement: ${Q.take(rest)}; whoever controls that server decides what runs on your machine; ship the code with the skill instead` });
        }
        const d = CODE_DECODE.exec(scanText);
        if (d && !classifyNegation(scanText, sink.index)) {
          const Q = new Quote();
          if (!full("sec-encoded-blob", li)) add({ ruleId: "sec-encoded-blob", severity: sev("soft"), ...at(li, Math.min(d.index, sink.index), Math.abs(d.index - sink.index) + d[0].length), message: `Decodes hidden text and runs it as code: ${Q.take(scanText.slice(Math.min(d.index, sink.index)))}; encoding hides what runs from anyone reading the skill; replace it with the plain code so it can be reviewed` });
        } else if (decoderVar && li - decoderVar.line <= 3 && new RegExp(`\\b${decoderVar.name}\\b`).test(rest)) {
          const Q = new Quote();
          if (!full("sec-encoded-blob", li)) add({ ruleId: "sec-encoded-blob", severity: sev("soft"), ...at(li, sink.index, sink[0].length), message: `Runs ${Q.take(decoderVar.name, 30)}, which was decoded from hidden text on line ${decoderVar.line + 1}: ${Q.take(rest)}; encoding hides what runs from anyone reading the skill; replace it with the plain code so it can be reviewed` });
        }
      }
      const d = CODE_DECODE.exec(scanText);
      if (d) {
        const v = /^\s*(?:(?:const|let|var|my|local)\s+)?\$?([A-Za-z_][\w]{0,40})\s*=/.exec(scanText);
        decoderVar = v ? { name: v[1]!, line: li } : decoderVar;
      }
      const enc = PS_ENCODED.exec(scanText);
      if (enc) {
        const Q = new Quote();
        if (!full("sec-encoded-blob", li)) add({ ruleId: "sec-encoded-blob", severity: sev("soft"), ...at(li, enc.index, enc[0].length), message: `Runs a base64-encoded PowerShell command: ${Q.take(scanText.slice(enc.index), 50)}; nobody reading the skill can see what it does; replace it with the plain command` });
      }
    }

    // Download to a file, then run that file within 5 lines.
    if (!capped("sec-remote-exec") && (downloads.length || downloadsToFile(scanText))) trackDownloads(scanText, li, downloads, (d, segStart, segText) => {
      if (full("sec-remote-exec", li) || classifyNegation(scanText, segStart)) return;
      const Q = new Quote();
      if (!full("sec-remote-exec", li)) add({ ruleId: "sec-remote-exec", severity: sev("install"), ...at(li, segStart, segText.length), message: `Runs ${Q.take(d.file, 40)} right after downloading it on line ${d.line + 1}: ${Q.take(segText)}; nobody reviews the file between download and run; ship the file with the skill or check its hash first` });
    });

    // Password archives and quarantine removal (T10).
    if (!capped("sec-remote-exec") && /unzip|7z|xattr/.test(scanText)) {
      const m = UNZIP_PASSWORD.exec(scanText) ?? QUARANTINE.exec(scanText);
      if (m && !classifyNegation(scanText, m.index)) {
        const Q = new Quote();
        const what = m[0].startsWith("xattr") ? "Removes the macOS quarantine flag, so Gatekeeper does not check the file" : "Unpacks a password-protected archive, which hides its contents from scanners";
        if (!full("sec-remote-exec", li)) add({ ruleId: "sec-remote-exec", severity: source === "readme" || source === "skill-doc" ? "info" : "warning", ...at(li, m.index, m[0].length), message: `${what}: ${Q.take(scanText.slice(m.index))}; malicious skills use this to run files nobody checked; remove the step or ship the files unpacked` });
      }
    }

    // Encoded runs that decode to something that matters.
    if (decodes < MAX_DECODES && !capped("sec-encoded-blob") && BLOB_GATE.test(scanText)) {
      const lineDecodes = DECODER.test(scanText) || CODE_DECODE.test(scanText);
      decodes += blobs(scanText, lineDecodes, MAX_DECODES - decodes, (off, len, decoded, why) => {
        const Q = new Quote();
        if (!full("sec-encoded-blob", li)) add({ ruleId: "sec-encoded-blob", severity: sev("soft"), ...at(li, off, len), message: `Encoded text decodes to something that ${why}: ${Q.take(decoded)}; hiding a command or instruction in an encoding keeps reviewers from reading it; write it out in plain text or remove it` });
      });
    }

    if (source === "script" && !capped("sec-script-instruction")) {
      for (const [re, label] of INSTRUCTION) {
        const m = re.exec(s);
        if (m) {
          const Q = new Quote();
          if (!full("sec-script-instruction", li)) add({ ruleId: "sec-script-instruction", severity: "warning", ...at(li, m.index, m[0].length), message: `Text in this script ${label}: ${Q.take(s.slice(m.index))}; agents read scripts too, and code comments and strings have no reason to address the agent, so remove it unless you wrote it` });
          break;
        }
      }
    }
  }

  // sec-secret-egress: per file for scripts, per block for markdown.
  egress(lines, logical, source, (src, sink) => {
    const Q = new Quote();
    const sinkWhere = sink.line === src.line ? "on the same line" : `on line ${sink.line + 1}`;
    if (!full("sec-secret-egress", src.line)) add({ ruleId: "sec-secret-egress", severity: sev("exec"), ...at(src.line, src.col, src.len), message: `Reads ${src.label} (${Q.take(src.text, 40)}) and sends data over the network ${sinkWhere} (${Q.take(sink.text, 30)}); that is how credential stealers work, so remove it unless you can say exactly what is sent and where` });
  });

  if (source === "script") {
    network(lines, (line, col, len, api, hosts) => {
      const Q = new Quote();
      const list = hosts.length ? `; hosts written in ${where}: ${Q.take(hosts.join(", "))}` : "; the host is not written literally";
      if (!full("sec-skill-network", line)) add({ ruleId: "sec-skill-network", severity: "info", ...at(line, col, len), message: `Makes network calls (${api})${list}; check that each host is one the skill needs` });
    });
    invisible(lines, (line, col, what) => {
      if (!full("sec-script-invisible", line)) add({ ruleId: "sec-script-invisible", severity: "warning", ...at(line, col, 1), message: `${what} in this script; code can read differently than it displays (Trojan Source) or carry a hidden payload (Glassworm); delete them unless you put them there on purpose` });
    });
  }

  if (source === "skill-md") {
    argInjection(lines, skip, opts.argNames ?? [], (line, col, len, placeholder, cmd) => {
      const Q = new Quote();
      if (!full("sec-skill-arg-injection", line)) add({ ruleId: "sec-skill-arg-injection", severity: "warning", ...at(line, col, len), message: `The skill argument ${Q.take(placeholder, 20)} is pasted into a shell command that runs when the skill loads (${Q.take(cmd, 60)}), so an argument such as "x; other-command" runs extra commands; pass the argument to Claude in the text instead, or quote and check it inside a script` });
    });
  }

  return hits;
}

// ---------------------------------------------------------------------------
// Pieces of the scan

function isFenceLine(s: string): boolean {
  const t = s.trimStart();
  return t.startsWith("```") || t.startsWith("~~~");
}

function endsWithContinuation(s: string): boolean {
  let e = s.length;
  while (e > 0 && (s.charCodeAt(e - 1) === 32 || s.charCodeAt(e - 1) === 9)) e--;
  if (e === 0) return false;
  const c = s.charCodeAt(e - 1);
  if (c === 92 /* \ */) return e === s.length && !(e >= 2 && s.charCodeAt(e - 2) === 92);
  return false;
}

const SHELL_LANGS = new Set(["", "sh", "bash", "zsh", "shell", "console", "terminal", "shellsession", "ksh", "fish", "!"]);

/** 1 for lines inside a fence whose info string is a shell (or empty, or the ```! form). */
function shellFences(lines: LineIndex, fence: Uint8Array): Uint8Array {
  const out = new Uint8Array(lines.count);
  let cur = 0;
  for (let i = 0; i < lines.count; i++) {
    if (fence[i] !== 1) {
      cur = 0;
      continue;
    }
    const s = lines.line(i);
    if (isFenceLine(s) && (i === 0 || fence[i - 1] !== 1)) {
      const info = lc(s.trim().replace(/^[`~]{3,}/, "").trim().split(/\s/, 1)[0] ?? "");
      cur = SHELL_LANGS.has(info) ? 1 : 0;
      continue;
    }
    out[i] = cur;
  }
  return out;
}

/** Text inside backtick code spans on one line, joined with newlines. */
function codeSpans(s: string): string {
  const parts: string[] = [];
  let i = s.indexOf("`");
  while (i !== -1) {
    const j = s.indexOf("`", i + 1);
    if (j === -1) break;
    parts.push(s.slice(i + 1, j));
    i = s.indexOf("`", j + 1);
  }
  return parts.join("\n");
}

const EXEC_CONTEXT = /(?:\b(?:bash|sh|zsh|dash|ksh|eval|source|exec|iex)\s{1,4}(?:-[a-zA-Z]{1,3}\s{1,4}){0,3}["']?|(?:^|[;&|({]\s{0,4}|\b(?:then|do|else)\s{1,4})\.\s{1,4}["']?|\b(?:python\d?(?:\.\d{1,2})?\s{1,4}-c|node\s{1,4}-e|perl\s{1,4}-e|ruby\s{1,4}-e)\s{1,4}["']?|(?:^|[;&|]|\b(?:then|do|else))\s{0,4}["']?)$/;

/**
 * Command substitutions run as code: `bash -c "$(curl ...)"`, `eval "$(... | base64 -d)"`,
 * `source <(curl ...)`, or a substitution in command position. Uses a stack of openers, so each
 * closing bracket does bounded work; nesting deeper than 8 is ignored.
 */
function substitutions(s: string, shell: boolean, report: (kind: "download" | "decode", open: number, inner: string) => void): void {
  const stack: number[] = [];
  let reported = 0;
  const check = (open: number, innerStart: number, end: number): void => {
    if (reported > 20) return;
    const inner = s.slice(innerStart, Math.min(end, innerStart + 512));
    const dl = DOWNLOADER.test(inner);
    const dec = !dl && DECODER.test(inner);
    if (!dl && !dec) return;
    const before = s.slice(Math.max(0, open - 40), open);
    if (!EXEC_CONTEXT.test(before)) return;
    reported++;
    report(dl ? "download" : "decode", open, inner);
  };
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c === 36 /* $ */ || c === 60 /* < */) && s.charCodeAt(i + 1) === 40) {
      if (stack.length < 8) stack.push(i);
      i++;
    } else if (c === 41 /* ) */ && stack.length) {
      const open = stack.pop()!;
      check(open, open + 2, i);
    }
  }
  if (shell) {
    let i = s.indexOf("`");
    while (i !== -1) {
      const j = s.indexOf("`", i + 1);
      if (j === -1) break;
      check(i, i + 1, j);
      i = s.indexOf("`", j + 1);
    }
  }
}

const OUT_FLAG = /^(?:-o|--output|-O|--output-document|-OutFile|--outfile)$/i;

/** Records files written by downloads and reports a later command that runs one of them. */
function trackDownloads(s: string, li: number, downloads: Download[], report: (d: Download, segStart: number, segText: string) => void): void {
  while (downloads.length && li - downloads[0]!.line > 5) downloads.shift();
  for (const seg of commandSegments(s)) {
    const words = commandWords(seg.text);
    if (!words.length) continue;
    const cmd = base(words[0]!);
    if (DOWNLOADER.test(words[0]!) && /^(?:curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)$/.test(cmd)) {
      let file = "";
      let url = "";
      for (let k = 1; k < words.length; k++) {
        const w = words[k]!;
        const eq = /^--(?:output|output-document)=(.+)$/.exec(w);
        if (eq) file = eq[1]!;
        else if (OUT_FLAG.test(w) && k + 1 < words.length && !(cmd === "curl" && w === "-O")) file = words[++k]!;
        else if (w === ">" && k + 1 < words.length) file = words[++k]!;
        else if (/^https?:\/\//i.test(w)) url = w;
        else if (cmd === "curl" && (w === "-O" || w === "--remote-name" || /^-[a-zA-Z]*O$/.test(w))) file = "\0remote";
      }
      if ((file === "\0remote" || (cmd === "wget" && !file)) && url) file = url.replace(/[?#].*$/, "").split("/").pop() ?? "";
      if (file && file !== "-" && file !== "\0remote" && file !== "/dev/null") downloads.push({ line: li, file: base(file) || file });
      continue;
    }
    if (!downloads.length) continue;
    let target = words[0]!;
    if (SHELLS.has(cmd) || SCRIPTERS.has(cmd) || /^python\d/.test(cmd) || PWSH.has(cmd) || cmd === "source" || cmd === "." || cmd === "chmod") {
      if (cmd === "chmod") continue;
      const arg = words.slice(1).find((w) => !w.startsWith("-"));
      if (!arg) continue;
      target = arg;
    }
    const t = base(target);
    const d = downloads.find((x) => x.file === t);
    if (d && t) report(d, seg.start, seg.text.trim());
  }
}

/** Base64, hex, \x escapes and fromCharCode lists in one line. Returns how many runs it decoded. */
function blobs(s: string, lineDecodes: boolean, budget: number, report: (off: number, len: number, decoded: string, why: string) => void): number {
  let used = 0;
  const minB64 = lineDecodes ? 8 : 24;
  let i = 0;
  while (i < s.length && used < budget) {
    const c = s.charCodeAt(i);
    if (!isB64(c)) {
      i++;
      continue;
    }
    let j = i;
    while (j < s.length && isB64(s.charCodeAt(j))) j++;
    let e = j;
    while (e < s.length && e - j < 2 && s.charCodeAt(e) === 61) e++;
    const run = s.slice(i, j);
    const len = run.length;
    const startOk = i === 0 || !isWordish(s.charCodeAt(i - 1));
    const ctx = s.slice(Math.max(0, i - 16), i);
    if (startOk && len >= minB64 && !/base64,$|sha\d{3}-$|data:[^,]{0,12}$/.test(ctx)) {
      const hex = /^[0-9a-fA-F]+$/.test(run);
      let decoded: string | null = null;
      if (hex && len >= 40) decoded = decodeHex(run);
      else if (!hex) decoded = decodeBase64(run);
      used++;
      if (decoded) {
        const why = judgeDecoded(decoded) ?? (lineDecodes && COMMAND_WORDS.test(decoded) ? "is a command" : null);
        if (why) report(i, e - i, decoded, why);
      }
    }
    i = e > i ? e : i + 1;
  }
  // \x41\x42... and String.fromCharCode(65, 66, ...)
  const esc = /(?:\\x[0-9a-fA-F]{2}){8,512}/g;
  for (const m of s.matchAll(esc)) {
    if (used >= budget) break;
    used++;
    const bytes = m[0].split("\\x").filter(Boolean).map((h) => parseInt(h, 16));
    const decoded = printable(Uint8Array.from(bytes));
    if (!decoded) continue;
    const why = judgeDecoded(decoded) ?? (COMMAND_WORDS.test(decoded) ? "is a command" : null);
    if (why) report(m.index, m[0].length, decoded, why);
  }
  const fcc = /fromCharCode\s*\(((?:\s{0,3}\d{1,3}\s{0,3},){7,512}\s{0,3}\d{1,3})\s{0,3}\)/g;
  for (const m of s.matchAll(fcc)) {
    if (used >= budget) break;
    used++;
    const decoded = printable(Uint8Array.from(m[1]!.split(",").map((x) => Number(x.trim()) & 0xff)));
    if (!decoded) continue;
    const why = judgeDecoded(decoded) ?? (COMMAND_WORDS.test(decoded) ? "is a command" : null);
    if (why) report(m.index, m[0].length, decoded, why);
  }
  return used;
}

const isB64 = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47 || c === 45 || c === 95;
const isWordish = (c: number): boolean => c === 46 || c === 92 || c === 37 || c === 36;

interface SourceHit {
  line: number;
  col: number;
  len: number;
  label: string;
  text: string;
}

/** Secret source and network sink in one script (strong sources), one block (markdown) or one line (weak sources). */
function egress(lines: LineIndex, logical: Line[], source: ScriptSource, report: (src: SourceHit, sink: { line: number; text: string }) => void): void {
  let blockSrc: SourceHit | null = null;
  let blockSink: { line: number; text: string } | null = null;
  let lastLine = -2;
  let lastCode: boolean | null = null;
  const isMd = source !== "script";
  const flush = (): void => {
    if (blockSrc && blockSink) report(blockSrc, blockSink);
    blockSrc = null;
    blockSink = null;
  };
  for (const L of logical) {
    // Markdown blocks: a fence, or a paragraph (lines without a blank line between).
    if (isMd && (L.code !== lastCode || L.first > lastLine + 1 || !L.text.trim())) flush();
    lastLine = L.first;
    lastCode = L.code;
    const s = L.table ? codeSpans(L.text) : L.text;
    if (!s || !EGRESS_TRIGGER.test(s)) continue;
    // A comment line in a script reads nothing and sends nothing.
    if (!isMd && /^\s*(?:#(?!!)|\/\/|\/\*|\*|--\s|REM\s|::)/i.test(s)) continue;
    const sinkM = SINK.exec(s) ?? (isMd && !L.code ? PROSE_SINK.exec(s) : null);
    const keyUse = !blockSrc && KEY_USE.test(s);
    if (!keyUse && !blockSrc && STRONG_ANY.test(s)) {
      for (const [re, label] of STRONG_SOURCE) {
        const m = re.exec(s);
        if (m && !classifyNegation(s, m.index)) {
          if (!blockSrc) blockSrc = { line: L.first, col: m.index, len: m[0].length, label, text: m[0] };
          break;
        }
      }
    }
    if (sinkM && !blockSink) blockSink = { line: L.first, text: sinkM[0] };
    if (sinkM) {
      for (const [re, label] of WEAK_SOURCE) {
        const m = re.exec(s);
        if (m && !classifyNegation(s, m.index)) {
          const githubOk = label === "the GitHub CLI token" && /\b(?:api\.)?github\.com\b|\bgh\s{1,4}api\b/.test(s);
          if (!githubOk) report({ line: L.first, col: m.index, len: m[0].length, label, text: m[0] }, { line: L.first, text: sinkM[0] });
          break;
        }
      }
    }
    void lines;
  }
  flush();
}

/** One note per script: the network APIs it calls and the hosts written in it. Two passes over the whole text. */
function network(lines: LineIndex, report: (line: number, col: number, len: number, api: string, hosts: string[]) => void): void {
  const text = lines.text;
  const api = new RegExp(NET_API.source, "gi");
  let first: { line: number; col: number; len: number; api: string } | null = null;
  let tries = 0;
  for (const m of text.matchAll(api)) {
    if (++tries > 2000) break;
    const li = lines.lineOf(m.index);
    const t = text.slice(lines.start(li), Math.min(lines.end(li), lines.start(li) + 200)).trimStart();
    if (t.startsWith("#") || t.startsWith("//") || t.startsWith("*") || t.startsWith("REM ")) continue;
    first = { line: li, col: m.index - lines.start(li), len: m[0].length, api: m[0].replace(/\s*\($/, "") };
    break;
  }
  if (!first) return;
  const hosts = new Set<string>();
  let urls = 0;
  URL_HOST.lastIndex = 0;
  for (const m of text.matchAll(URL_HOST)) {
    if (++urls > 2000 || hosts.size >= 200) break;
    const h = cleanHost(m[1]!);
    if (!LOOPBACK.has(h)) hosts.add(h);
  }
  report(first.line, first.col, first.len, first.api, [...hosts].sort());
}

/**
 * Invisible and bidirectional characters in a script. ZWJ, ZWNJ and FE0F next to non-ASCII text are
 * part of emoji and of Persian and Indic writing, so they are left alone.
 */
function invisible(lines: LineIndex, report: (line: number, col: number, what: string) => void): void {
  const s = lines.text;
  let li = 0;
  let lineEnd = lines.count ? lines.end(0) : 0;
  let reportedLine = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x115f) continue;
    while (li + 1 < lines.count && i > lineEnd) {
      li++;
      lineEnd = lines.end(li);
    }
    if (li === reportedLine) continue;
    let cp = c;
    if (c >= 0xd800 && c <= 0xdbff) cp = s.codePointAt(i)!;
    const prev = i > 0 ? s.charCodeAt(i - 1) : 0;
    let what: string | null = null;
    if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) what = "Bidirectional control characters";
    else if (cp === 0x200b || cp === 0x2060 || (cp === 0xfeff && i > 0) || cp === 0x2062 || cp === 0x2064 || cp === 0x3164 || cp === 0xffa0 || cp === 0x115f || cp === 0x1160) what = "Invisible characters";
    else if ((cp === 0x200c || cp === 0x200d) && prev < 0x80) what = "Zero-width joiners outside emoji or non-Latin text";
    else if (cp >= 0xe0000 && cp <= 0xe007f) {
      let t = "";
      let k = i;
      while (k < s.length && t.length < 60) {
        const x = s.codePointAt(k)!;
        if (x < 0xe0000 || x > 0xe007f) break;
        if (x >= 0xe0020 && x <= 0xe007e) t += String.fromCharCode(x - 0xe0000);
        k += 2;
      }
      what = t ? `Unicode tag characters that decode to ${q(preview(t, 60), 200)}` : "Unicode tag characters";
    } else if (cp >= 0xe0100 && cp <= 0xe01ef) what = "Variation selectors that carry no visible meaning";
    else if (cp >= 0xfe00 && cp <= 0xfe0f && (s.charCodeAt(i + 1) >= 0xfe00 && s.charCodeAt(i + 1) <= 0xfe0f)) what = "A run of variation selectors";
    if (what) {
      reportedLine = li;
      report(li, i - lines.start(li), what);
    }
  }
}

/**
 * Skill arguments ($ARGUMENTS, $0, $name) inside a !`command` or a ```! block. Claude Code puts the
 * argument text into the command before running it, so shell syntax in an argument runs.
 */
function argInjection(lines: LineIndex, skip: number, argNames: readonly string[], report: (line: number, col: number, len: number, placeholder: string, cmd: string) => void): void {
  const names = argNames.filter((n) => /^[A-Za-z_][\w-]{0,40}$/.test(n));
  const placeholder = new RegExp(`(?<!\\\\)\\$(?:ARGUMENTS(?:\\[\\d{1,3}\\])?|\\d{1,3}\\b${names.length ? `|(?:${names.join("|")})\\b` : ""})`);
  const text = lines.text;
  const bodyStart = skip >= 0 && skip + 1 < lines.count ? lines.start(skip + 1) : skip >= 0 ? text.length : 0;
  let reported = 0;
  // Inline form: !` at the start of a line or after a space or tab.
  let k = text.indexOf("!`", bodyStart);
  while (k !== -1 && reported < 60) {
    const prev = k === 0 ? 10 : text.charCodeAt(k - 1);
    const li = lines.lineOf(k);
    const lineEnd = lines.end(li);
    const end = text.indexOf("`", k + 2);
    if (end === -1) break;
    if ((prev === 10 || prev === 13 || prev === 32 || prev === 9) && end <= lineEnd) {
      const cmd = text.slice(k + 2, end);
      const m = placeholder.exec(cmd);
      if (m) {
        reported++;
        report(li, k + 2 + m.index - lines.start(li), m[0].length, m[0], cmd);
      }
    }
    k = text.indexOf("!`", end > k ? Math.min(end, lineEnd) + 1 : k + 2);
  }
  // Block form: a fence whose info string is "!".
  const open = /^\s{0,3}(`{3,}|~{3,})!\s*$/gm;
  open.lastIndex = bodyStart;
  for (const m of text.matchAll(open)) {
    if (m.index < bodyStart || reported >= 60) continue;
    let li = lines.lineOf(m.index) + 1;
    for (; li < lines.count && reported < 60; li++) {
      const s = lines.line(li);
      const t = s.trim();
      if (t.startsWith(m[1]!) && t.replace(/[`~]/g, "") === "") break;
      const p = placeholder.exec(s.length > WINDOW ? s.slice(0, WINDOW) : s);
      if (p) {
        reported++;
        report(li, p.index, p[0].length, p[0], s);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Binaries

/** What the first 4 bytes say the file is, or null for anything that is not native code. */
export function binaryKind(head: Uint8Array): string | null {
  if (head.length < 4) return null;
  const [a, b, c, d] = [head[0]!, head[1]!, head[2]!, head[3]!];
  if (a === 0x7f && b === 0x45 && c === 0x4c && d === 0x46) return "an ELF (Linux) executable";
  if ((a === 0xfe && b === 0xed && c === 0xfa && (d === 0xce || d === 0xcf)) || ((a === 0xce || a === 0xcf) && b === 0xfa && c === 0xed && d === 0xfe)) return "a Mach-O (macOS) executable";
  if (a === 0xca && b === 0xfe && c === 0xba && d === 0xbe) return "a Mach-O universal executable or Java class file";
  if (a === 0x4d && b === 0x5a && !(isPrint(c) && isPrint(d))) return "a Windows (PE) executable";
  if (a === 0x00 && b === 0x61 && c === 0x73 && d === 0x6d) return "a WebAssembly module";
  return null;
}

const isPrint = (x: number): boolean => x >= 0x20 && x < 0x7f;
