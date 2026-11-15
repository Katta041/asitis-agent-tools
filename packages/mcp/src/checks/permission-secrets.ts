// Secrets written into permission rules (secret-in-permission-rule). Used by the agent config audit.
//
// Why this exists: Claude Code saves the whole approved command as an allow rule when you pick
// "Yes, and don't ask again" (https://code.claude.com/docs/en/settings, read 15 November 2026), so
// a password typed into a command ends up in .claude/settings.local.json. Apiiro (5 November 2026,
// https://apiiro.com/blog/coding-agents-leaking-secrets-github-dont-ask-again) found secrets in
// 1,122 public copies; gitleaks and TruffleHog both missed 215 of them, mostly passwords after
// PGPASSWORD=, sshpass -p and mysql -p that have no provider prefix to match.
//
// So this looks for key shapes (redact.ts plus JWTs and a few more) and for credentials by
// position: Authorization headers, key and token headers, user:password@ in URLs, curl -u,
// password flags of the commands that take one (mysql -p, sshpass -p, docker login -p and so on),
// long --password / --token style flags, and NAME=value assignments with a secret-looking name.
// A value must look like a literal: variables, placeholders, wildcards and well-known defaults
// (postgres, root, changeme) are skipped. A password or token for localhost only is skipped too;
// a known key shape is reported wherever it points.
//
// Every scan here is a forward pass or a regex with bounded repeats that starts on a fixed word.
// Only the first MAX_ENTRY_CHARS of an entry are scanned.

import { findSecrets } from "../redact.js";

export interface PermissionSecret {
  /** What it is, for the message: "bearer token", "database password (mysql -p)". Never the value. */
  kind: string;
  /** Offsets into the entry, end exclusive: the span a quote of the entry must mask. */
  start: number;
  end: number;
}

/** Longest part of one permission entry that is scanned. */
export const MAX_ENTRY_CHARS = 16 * 1024;

/** Default and example passwords that are not worth a finding. */
const DEFAULT_PASSWORDS = new Set([
  "password", "passw0rd", "postgres", "postgresql", "root", "admin", "administrator", "secret", "test", "testing", "tester", "example",
  "mysql", "mariadb", "changeme", "123456", "1234567", "12345678", "123456789", "pass", "passwd", "user", "guest", "demo", "default",
  "local", "localdev", "dev", "development", "docker", "toor", "qwerty", "letmein", "welcome", "sa", "oracle", "redis", "mongo", "mongodb",
  "rabbitmq", "minioadmin", "pa55word", "p@ssw0rd", "p@ssword", "testpass", "testpassword", "devpassword", "localpassword",
]);

const PLACEHOLDER = /your|example|xxx|placeholder|changeme|change_me|replace|dummy|fake|sample|redacted|todo|insert|<|>|\.\.\./i;

/** Not a literal value: a variable, a template, a command substitution, a wildcard. */
function notLiteral(v: string): boolean {
  return /^[$%<{[(]/.test(v) || v.includes("${") || v.includes("$(") || /\$[A-Za-z_]/.test(v) || /%[A-Za-z_][A-Za-z0-9_]*%/.test(v) || v.includes("{{") || v.includes("*") || v.includes("`");
}

/** A default word with a number or symbol stuck on (admin123, test_1234, root!): a dev default, not a credential worth a finding. */
const WEAK_DEFAULT = /^(?:admin|test|pass|password|passwd|root|user|demo|dev|local|secret|changeme|qwerty|welcome|guest|postgres|mysql|redis|app)[\W_]{0,2}\d{0,6}[\W_]{0,2}$/i;

/** A value in a password position that is worth reporting. */
export function passwordLike(raw: string): boolean {
  const v = unquote(raw);
  if (v.length < 6 || v.length > 256) return false;
  if (notLiteral(v) || PLACEHOLDER.test(v)) return false;
  if (DEFAULT_PASSWORDS.has(v.toLowerCase()) || WEAK_DEFAULT.test(v)) return false;
  // "todo_password", "dev-secret": a word about a password, no digit, is a local default.
  if (/pass|secret|changeme/i.test(v) && !/\d/.test(v)) return false;
  if (/^\d{1,5}$/.test(v)) return false; // a port, not a password
  if (/^[\\/~.]/.test(v) || /^[\w.-]*(?:\/[\w.-]+)+$/.test(v)) return false; // a path
  if (/^[A-Z][A-Z0-9_]*$/.test(v)) return false; // a variable name
  if (/\s/.test(v)) return false;
  if (new Set(v).size < 4) return false;
  return true;
}

/** A value in a token position: long, no spaces, letters and digits mixed, not a path or URL. */
export function tokenLike(raw: string): boolean {
  const v = unquote(raw);
  if (v.length < 12 || v.length > 4096) return false;
  if (notLiteral(v) || PLACEHOLDER.test(v) || /\s/.test(v)) return false;
  if (/^[a-z][a-z0-9+.-]{0,20}:\/\//i.test(v)) return false;
  if (/^[\\/~.]/.test(v) || /\.(?:json|txt|pem|key|crt|cer|p12|env|ya?ml|toml|sh|py|js|ts|md)$/i.test(v)) return false;
  if (/^[A-Z][A-Z0-9_]*$/.test(v)) return false;
  if (!/[0-9]/.test(v) || !/[A-Za-z]/.test(v)) return false;
  if (new Set(v).size < 8) return false;
  return true;
}

function unquote(v: string): string {
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) return v.slice(1, -1);
  return v;
}

const LOOPBACK = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)\b|\[::1\]/i;

/** user@host (ssh, scp) with a dotted name or an IPv4 address, and -h / --host values. */
const REMOTE_HOST = /(?:^|[\s'"])[\w.-]{1,64}@([A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8})(?=$|[\s'":/])|(?:^|\s)(?:-h|--host)(?:\s{1,4}|=)['"]?([A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8})/g;

/** True when the entry points only at this machine: a loopback host, and no remote URL, ssh target or -h host. */
function loopbackOnly(s: string): boolean {
  if (!LOOPBACK.test(s)) return false;
  REMOTE_HOST.lastIndex = 0;
  for (const m of s.matchAll(REMOTE_HOST)) {
    const host = m[1] ?? m[2] ?? "";
    if (host && !LOOPBACK.test(host)) return false;
  }
  let at = 0;
  for (let n = 0; n < 64; n++) {
    const i = s.indexOf("://", at);
    if (i === -1) break;
    at = i + 3;
    const hostEnd = scanUntil(s, at, "/?#'\" \t)", 300);
    const host = s.slice(at, hostEnd).replace(/^[^@]{0,300}@/, "").replace(/:\d{1,5}$/, "");
    if (host && !LOOPBACK.test(host)) return false;
  }
  return true;
}

/** Index of the first char of stop at or after from, at most max chars on. */
function scanUntil(s: string, from: number, stop: string, max: number): number {
  const end = Math.min(s.length, from + max);
  for (let i = from; i < end; i++) if (stop.includes(s[i]!)) return i;
  return end;
}

// ---------------------------------------------------------------------------------------------
// Key shapes beyond redact.ts findSecrets: JWTs (Supabase service-role keys are JWTs), GitLab,
// Hugging Face and SendGrid tokens, Slack webhook URLs.

const EXTRA_SHAPES: ReadonlyArray<{ type: string; re: RegExp }> = [
  { type: "GitLab token", re: /\bglpat-[A-Za-z0-9_-]{20,255}/g },
  { type: "Hugging Face token", re: /\bhf_[A-Za-z0-9]{30,255}/g },
  { type: "SendGrid key", re: /\bSG\.[A-Za-z0-9_-]{16,64}\.[A-Za-z0-9_-]{16,128}/g },
  { type: "Slack webhook URL", re: /hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/_-]{20,512}/g },
  { type: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,4096}\.eyJ[A-Za-z0-9_-]{10,8192}\.[A-Za-z0-9_-]{10,4096}/g },
];

/** A JWT's role claim, or null. Supabase anon keys (role "anon") are public by design. */
function jwtRole(token: string): string | null {
  const mid = token.split(".")[1];
  if (!mid || mid.length > 8192) return null;
  try {
    const json = Buffer.from(mid, "base64url").toString("utf8");
    const m = /"role"\s{0,4}:\s{0,4}"([A-Za-z_-]{1,40})"/.exec(json);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

/** shapes() also records spans that are public keys (Supabase anon JWTs): no positional finding may cover them. */
/** A random key has digits and many distinct characters; "sk-abcdefghijklmnopqrstu" and "ghp_xxxx..." do not. */
function realisticKey(v: string): boolean {
  if (v.startsWith("-----BEGIN")) return true;
  const body = v.replace(/^[A-Za-z]{2,6}[-_](?:[a-z]{2,8}[-_])?/, "");
  return /\d/.test(body) && new Set(body).size >= 10 && !PLACEHOLDER.test(body) && !/(.)\1{5}/.test(body);
}

/**
 * Key shapes that are not unique to one provider. OpenAI-compatible gateways issue their own
 * "sk-..." keys and many services sign JWTs, so these two count as positional when the rule only
 * talks to localhost (0.4.0 corpus: 6 of 39 hits were sk- keys for a gateway the repo itself runs).
 */
const GENERIC_SHAPES = new Set(["OpenAI API key", "JWT"]);

function shapes(s: string, out: PermissionSecret[], pub: Array<[number, number]> = []): void {
  for (const m of findSecrets(s, 20)) if (realisticKey(s.slice(m.start, m.end))) out.push({ kind: m.type, start: m.start, end: m.end });
  for (const { type, re } of EXTRA_SHAPES) {
    re.lastIndex = 0;
    for (const m of s.matchAll(re)) {
      if (type !== "JWT" && type !== "Slack webhook URL" && !realisticKey(m[0])) continue;
      let kind = type;
      if (type === "JWT") {
        const role = jwtRole(m[0]);
        if (role === "anon") {
          pub.push([m.index, m.index + m[0].length]);
          continue;
        }
        if (role === "service_role") kind = "Supabase service-role key";
      }
      out.push({ kind, start: m.index, end: m.index + m[0].length });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Positional patterns. Each starts on a fixed word and has bounded repeats.

const BEARER = /\bbearer\s{1,4}([^\s'"`\\]{8,4096})/gi;
const AUTH_HEADER = /\bauthorization\s{0,4}[:=]\s{0,4}(?:(basic|token|bot|apikey|key)\s{1,4})?([^\s'"`\\]{8,4096})/gi;
/** -H "X-Api-Key: value", --header=x-auth-token:value */
const HEADER = /(?:^|\s)(?:-H|--header)(?:\s{1,4}|=)?['"]?([A-Za-z][A-Za-z0-9_-]{0,60})\s{0,4}:\s{0,4}([^\s'"`\\]{6,4096})/g;
const SECRET_HEADER = /api[-_]?key|apikey|token|secret|password|passwd|signature|session|cookie|auth-key|x-auth/i;

function positional(s: string, out: PermissionSecret[]): void {
  BEARER.lastIndex = 0;
  for (const m of s.matchAll(BEARER)) {
    const v = m[1]!;
    if (tokenLike(v)) push(out, "bearer token", m.index + m[0].length - v.length, m.index + m[0].length);
  }
  AUTH_HEADER.lastIndex = 0;
  for (const m of s.matchAll(AUTH_HEADER)) {
    const scheme = (m[1] ?? "").toLowerCase();
    const v = m[2]!;
    const end = m.index + m[0].length;
    if (/^bearer$/i.test(v)) continue;
    if (scheme === "basic") {
      if (basicCredentials(v)) push(out, "basic auth credentials", end - v.length, end);
    } else if (tokenLike(v)) push(out, "Authorization header token", end - v.length, end);
  }
  HEADER.lastIndex = 0;
  for (const m of s.matchAll(HEADER)) {
    const name = m[1]!;
    if (/^authorization$/i.test(name) || !SECRET_HEADER.test(name)) continue;
    let v = m[2]!;
    const end = m.index + m[0].length;
    // Cookie: session=abc -> the value after the first "=".
    if (/cookie/i.test(name) && v.includes("=")) v = v.slice(v.indexOf("=") + 1);
    if (tokenLike(v)) push(out, `${name.toLowerCase()} header`, end - m[2]!.length, end);
  }
  urlCredentials(s, out);
}

/** base64 of "user:password" with a password worth reporting. */
function basicCredentials(v: string): boolean {
  if (!/^[A-Za-z0-9+/]{8,4096}={0,2}$/.test(v)) return false;
  let text: string;
  try {
    text = Buffer.from(v, "base64").toString("utf8");
  } catch {
    return false;
  }
  const colon = text.indexOf(":");
  if (colon <= 0 || /[\x00-\x1f]/.test(text)) return false;
  return passwordLike(text.slice(colon + 1));
}

/** scheme://user:password@host and scheme://token@host, found with indexOf and bounded forward scans. */
function urlCredentials(s: string, out: PermissionSecret[]): void {
  let at = 0;
  for (let n = 0; n < 256; n++) {
    const i = s.indexOf("://", at);
    if (i === -1) return;
    at = i + 3;
    if (i === 0 || !/[A-Za-z0-9+.-]/.test(s[i - 1]!)) continue;
    const authEnd = scanUntil(s, at, "/?#@ \t'\"`)", 1300);
    if (s[authEnd] !== "@") continue;
    const auth = s.slice(at, authEnd);
    const hostEnd = scanUntil(s, authEnd + 1, "/?#: \t'\"`)", 253);
    const host = s.slice(authEnd + 1, hostEnd);
    if (!host || LOOPBACK.test(host)) continue;
    const colon = auth.indexOf(":");
    if (colon > 0) {
      const pw = auth.slice(colon + 1);
      // The whole user:password part is masked, as redact.ts does for display.
      if (passwordLike(decodeURIComponentSafe(pw))) push(out, "password in a URL", at, authEnd);
    } else if (colon === -1 && tokenLike(auth)) {
      push(out, "token in a URL", at, authEnd);
    }
  }
}

function decodeURIComponentSafe(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function push(out: PermissionSecret[], kind: string, start: number, end: number): void {
  out.push({ kind, start, end });
}

// ---------------------------------------------------------------------------------------------
// Command-aware: the entry split into words, with the password flags of the commands that take one.

interface Word {
  /** The word with quotes removed. */
  text: string;
  /** Raw span in the entry. */
  start: number;
  end: number;
  /** A shell separator (; | & && ||). */
  sep?: boolean;
}

/** Splits a command into words. Quotes group, separators are words of their own. Linear, at most 1,024 words. */
export function words(s: string): Word[] {
  const out: Word[] = [];
  let i = 0;
  while (i < s.length && out.length < 1024) {
    const c = s[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === ";" || c === "|" || c === "&") {
      let j = i + 1;
      while (j < s.length && (s[j] === "|" || s[j] === "&") && j - i < 2) j++;
      out.push({ text: s.slice(i, j), start: i, end: j, sep: true });
      i = j;
      continue;
    }
    const start = i;
    let text = "";
    while (i < s.length) {
      const d = s[i]!;
      if (d === " " || d === "\t" || d === "\n" || d === "\r" || d === ";" || d === "|" || d === "&") break;
      if (d === '"' || d === "'") {
        const close = s.indexOf(d, i + 1);
        if (close === -1) {
          text += s.slice(i + 1);
          i = s.length;
          break;
        }
        text += s.slice(i + 1, close);
        i = close + 1;
        continue;
      }
      if (d === "\\" && i + 1 < s.length) {
        text += s[i + 1];
        i += 2;
        continue;
      }
      text += d;
      i++;
    }
    out.push({ text, start, end: i });
  }
  return out;
}

const MYSQL = new Set(["mysql", "mysqldump", "mysqladmin", "mysqlimport", "mysqlshow", "mysqlcheck", "mysqlsh", "mariadb", "mariadb-dump", "mariadb-admin", "mariadb-check"]);
const REGISTRY = new Set(["docker", "podman", "nerdctl", "helm", "oras", "skopeo", "buildah", "crane"]);
const PREFIX_WORDS = new Set(["sudo", "env", "exec", "time", "nohup", "command", "builtin", "export", "set"]);
/** First words of long flags that take no value or name a source, not a secret: --no-password, --password-stdin is excluded by the pattern itself. */
const FLAG_NOT_VALUE = /^--(?:no|ask|prompt|use|with|show|print|reset|rotate|generate|gen|create|new|revoke|list|require|skip|read|interactive|stdin|from)-/i;
const PASSWORD_FLAG = /^--(?:[a-z0-9]{1,20}-){0,4}(?:password|passwd|pass)$/i;
const TOKEN_FLAG = /^--(?:[a-z0-9]{1,20}-){0,4}(?:token|secret|api-?key|apikey|access-?key|secret-?key|client-?secret|auth-?token|access-?token)$/i;
/** NAME=value names that hold a password. */
const PASSWORD_NAME = /(?:password|passwd)$|(?:^|_)(?:pwd|pass)$/i;
/** NAME=value names that hold a token or key. */
const TOKEN_NAME = /(?:^|_)(?:secret|token|api_?key|apikey|access_?key|secret_?key|private_?key|auth|auth_?token|client_?secret|credentials?|key)$/i;
/** Names that look secret but are not: the working folder, public keys, askpass programs. */
const NOT_SECRET_NAME = /^(?:pwd|oldpwd)$|askpass|(?:^|_)(?:public|anon|publishable)(?:_|$)|^(?:next_public|expo_public|vite_public|public)_/i;

const baseName = (t: string): string => (t.split(/[\\/]/).pop() ?? t).toLowerCase().replace(/\.(?:exe|cmd|bat)$/, "");

function commandAware(s: string, out: PermissionSecret[]): void {
  const ws = words(s);
  let cmd = "";
  let sub = "";
  let atCommand = true;
  // echo '<password>' | sudo -S ...: the echoed word, while it is being piped.
  let echoed: Word | undefined;
  let piped: Word | undefined;
  for (let k = 0; k < ws.length; k++) {
    const w = ws[k]!;
    if (w.sep) {
      piped = w.text === "|" ? echoed : undefined;
      echoed = undefined;
      cmd = "";
      sub = "";
      atCommand = true;
      continue;
    }
    const t = w.text;
    const next = ws[k + 1] && !ws[k + 1]!.sep ? ws[k + 1]! : undefined;
    // NAME=value, also $env:NAME=value (PowerShell).
    const assign = /^(?:\$env:)?([A-Za-z_][A-Za-z0-9_]{0,80})=([\s\S]{1,4096})$/.exec(t);
    if (assign) {
      const name = assign[1]!;
      const value = assign[2]!;
      if (!NOT_SECRET_NAME.test(name)) {
        const isPw = PASSWORD_NAME.test(name);
        if (isPw ? passwordLike(value) : TOKEN_NAME.test(name) && tokenLike(value)) push(out, `${name} value`, w.start, w.end);
      }
      if (atCommand) continue;
    }
    if (atCommand) {
      const b = baseName(t);
      if (b === "sudo" && piped) {
        let stdin = false;
        for (let j = k + 1; j < ws.length && !ws[j]!.sep; j++) if (ws[j]!.text === "-S" || ws[j]!.text === "--stdin") stdin = true;
        if (stdin && passwordLike(piped.text)) push(out, "sudo password (echo | sudo -S)", piped.start, piped.end);
        piped = undefined;
      }
      if (PREFIX_WORDS.has(b)) continue;
      if ((b === "echo" || b === "printf") && next && !next.text.startsWith("-")) echoed = next;
      cmd = b;
      sub = next ? next.text.toLowerCase() : "";
      atCommand = false;
      continue;
    }
    commandFlag(cmd, sub, w, next, out);
    // npm: --//registry.npmjs.org/:_authToken=VALUE, or "npm config set //host/:_authToken VALUE"
    const npmAt = t.indexOf(":_authToken");
    if (npmAt !== -1) {
      const after = t.slice(npmAt + ":_authToken".length);
      if (after.startsWith("=") && tokenLike(after.slice(1))) push(out, "npm token", w.start, w.end);
      else if (after === "" && next && tokenLike(next.text)) push(out, "npm token", next.start, next.end);
    }
  }
}

function commandFlag(cmd: string, sub: string, w: Word, next: Word | undefined, out: PermissionSecret[]): void {
  const t = w.text;
  // The whole word is masked: "-p<secret>" or "--password=<secret>".
  const tail = (_value: string): [number, number] => [w.start, w.end];
  // mysql: only -pVALUE and --password=VALUE carry it; "-p" alone and "--password value" prompt.
  if (MYSQL.has(cmd)) {
    if (/^-p.+/.test(t) && !t.startsWith("--")) {
      const v = t.slice(2);
      if (passwordLike(v)) push(out, `database password (${cmd} -p)`, ...tail(v));
    } else if (/^--password=/i.test(t)) {
      const v = t.slice(t.indexOf("=") + 1);
      if (passwordLike(v)) push(out, `database password (${cmd} --password)`, ...tail(v));
    }
    return;
  }
  if (cmd === "sshpass") {
    if (t === "-p" && next && passwordLike(next.text)) push(out, "SSH password (sshpass -p)", next.start, next.end);
    else if (/^-p.+/.test(t) && passwordLike(t.slice(2))) push(out, "SSH password (sshpass -p)", ...tail(t.slice(2)));
    return;
  }
  if (cmd === "redis-cli" && (t === "-a" || t === "--pass") && next && passwordLike(next.text)) {
    push(out, "Redis password (redis-cli -a)", next.start, next.end);
    return;
  }
  if ((cmd === "mongosh" || cmd === "mongo" || cmd === "mongodump" || cmd === "mongorestore") && t === "-p" && next && passwordLike(next.text)) {
    push(out, `database password (${cmd} -p)`, next.start, next.end);
    return;
  }
  if ((cmd === "sqlcmd" || cmd === "bcp") && t === "-P" && next && passwordLike(next.text)) {
    push(out, `database password (${cmd} -P)`, next.start, next.end);
    return;
  }
  if ((REGISTRY.has(cmd) || cmd === "az") && (sub === "login" || sub === "registry") && t === "-p" && next && passwordLike(next.text)) {
    push(out, `registry password (${cmd} login -p)`, next.start, next.end);
    return;
  }
  if (cmd === "curl" && (t === "-u" || t === "--user" || /^-u.+/.test(t))) {
    const cred = t === "-u" || t === "--user" ? next : { ...w, text: t.slice(2) };
    if (cred) {
      const colon = cred.text.indexOf(":");
      if (colon > 0 && passwordLike(cred.text.slice(colon + 1))) push(out, "basic auth credentials (curl -u)", cred === next ? next.start : w.start, cred === next ? next.end : w.end);
    }
    return;
  }
  if ((cmd === "zip" || cmd === "unzip") && t === "-P" && next && passwordLike(next.text)) {
    push(out, `archive password (${cmd} -P)`, next.start, next.end);
    return;
  }
  if ((cmd === "7z" || cmd === "7za" || cmd === "7zz") && /^-p.+/.test(t) && passwordLike(t.slice(2))) {
    push(out, "archive password (7z -p)", ...tail(t.slice(2)));
    return;
  }
  if (cmd === "openssl" && /^-pass(?:in|out)?$/.test(t) && next && /^pass:/.test(next.text) && passwordLike(next.text.slice(5))) {
    push(out, `password (openssl ${t} pass:)`, next.start, next.end);
    return;
  }
  if (cmd === "keytool" && /^-(?:src|dest)?(?:store|key)pass$/i.test(t) && next && passwordLike(next.text)) {
    push(out, `keystore password (keytool ${t})`, next.start, next.end);
    return;
  }
  // Long flags: --password=VALUE, --api-key VALUE, --client-secret=VALUE.
  if (t.startsWith("--") && !FLAG_NOT_VALUE.test(t)) {
    const eq = t.indexOf("=");
    const flag = eq === -1 ? t : t.slice(0, eq);
    const isPw = PASSWORD_FLAG.test(flag);
    const isTok = !isPw && TOKEN_FLAG.test(flag);
    if (!isPw && !isTok) return;
    const ok = (v: string): boolean => (isPw ? passwordLike(v) : tokenLike(v));
    const label = `${isPw ? "password" : "token"} (${flag.toLowerCase().slice(0, 40)})`;
    if (eq !== -1) {
      const v = t.slice(eq + 1);
      if (ok(v)) push(out, label, ...tail(v));
    } else if (next && !next.text.startsWith("-") && ok(next.text)) push(out, label, next.start, next.end);
  }
}

// ---------------------------------------------------------------------------------------------

/**
 * Secrets in one permission rule ("Bash(...)", "Shell(...)", "run_shell_command(...)" or a bare
 * pattern). Offsets are into entry. Overlapping hits merge; a key shape names the kind first.
 */
export function permissionSecrets(entry: string): PermissionSecret[] {
  const head = entry.length > MAX_ENTRY_CHARS ? entry.slice(0, MAX_ENTRY_CHARS) : entry;
  // Bash(...), Shell(...), run_shell_command(...): scan what is inside, offsets kept for the entry.
  let off = 0;
  let s = head;
  const tool = /^\s{0,8}[A-Za-z_][A-Za-z0-9_]{0,40}\(/.exec(head);
  if (tool) {
    off = tool[0].length;
    s = head.slice(off, head.endsWith(")") ? -1 : undefined);
  }
  let keyed: PermissionSecret[] = [];
  const pub: Array<[number, number]> = [];
  shapes(s, keyed, pub);
  let placed: PermissionSecret[] = [];
  const local = loopbackOnly(s);
  // A JWT or sk- key sent only to localhost is a dev token for a local service; provider-specific
  // shapes (ghp_, AKIA, sk-ant-, xoxb-) count wherever they point.
  if (local) keyed = keyed.filter((k) => !GENERIC_SHAPES.has(k.kind));
  if (!local) {
    positional(s, placed);
    commandAware(s.replace(/(?::\*|\s\*)$/, ""), placed);
    placed = placed.filter((p) => !pub.some(([a, b]) => p.start < b && a < p.end));
  }
  const all = [...keyed.map((k) => ({ ...k, rank: 0 })), ...placed.map((p) => ({ ...p, rank: 1 }))]
    .filter((x) => x.end > x.start)
    .map((x) => ({ ...x, start: x.start + off, end: x.end + off }));
  all.sort((a, b) => a.start - b.start || a.rank - b.rank || b.end - a.end);
  const out: Array<PermissionSecret & { rank: number }> = [];
  for (const x of all) {
    const last = out[out.length - 1];
    if (last && x.start < last.end) {
      if (x.end > last.end) last.end = x.end;
      if (x.rank < last.rank) {
        last.kind = x.kind;
        last.rank = x.rank;
      }
      continue;
    }
    out.push({ ...x });
  }
  return out.map((x) => ({ kind: x.kind, start: x.start, end: x.end }));
}

/** The entry with every secret span replaced by its length, for a quote or a fingerprint. Other copies of the same value are masked too. */
export function maskSecrets(entry: string, secrets: readonly PermissionSecret[]): string {
  const spans: Array<{ start: number; end: number }> = secrets.map((x) => ({ start: x.start, end: x.end }));
  for (const x of secrets) {
    const raw = entry.slice(x.start, x.end);
    const eq = raw.indexOf("=");
    for (const v of new Set([raw, unquote(raw), eq > 0 ? raw.slice(eq + 1) : raw])) {
      if (v.length < 6) continue;
      let from = 0;
      for (let n = 0; n < 50; n++) {
        const i = entry.indexOf(v, from);
        if (i === -1) break;
        spans.push({ start: i, end: i + v.length });
        from = i + v.length;
      }
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const x of spans) {
    const last = merged[merged.length - 1];
    if (last && x.start < last.end) {
      if (x.end > last.end) last.end = x.end;
    } else merged.push({ ...x });
  }
  let out = "";
  let at = 0;
  for (const x of merged) {
    out += entry.slice(at, x.start) + `[redacted, ${x.end - x.start} chars]`;
    at = x.end;
  }
  return out + entry.slice(at);
}
