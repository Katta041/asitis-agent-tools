// Masks token-shaped strings before any file text reaches a message. Used by the skill scan
// (WP5), the agent config audit (WP6) and secret-in-steering (F13). Owner: WP0.
// Every pattern is anchored on a fixed prefix with bounded repeats, so matching stays linear.

export interface SecretMatch {
  /** What the key looks like: "AWS access key", "GitHub token" and so on. */
  type: string;
  /** UTF-16 offsets into the scanned text, end exclusive. */
  start: number;
  end: number;
}

const SHAPES: ReadonlyArray<{ type: string; re: RegExp }> = [
  { type: "private key", re: /-----BEGIN (?:[A-Z0-9]{1,20} ){0,3}PRIVATE KEY-----/g },
  { type: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g },
  { type: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,255}/g },
  { type: "OpenAI API key", re: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,255}/g },
  { type: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,255}/g },
  { type: "Stripe key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,255}/g },
  { type: "npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { type: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}/g },
];

/** Token-shaped substrings in text, in order, without overlaps. At most `max` are returned. */
export function findSecrets(text: string, max = 50): SecretMatch[] {
  const all: SecretMatch[] = [];
  for (const { type, re } of SHAPES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      all.push({ type, start: m.index, end: m.index + m[0].length });
      if (all.length >= max * 4) break;
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: SecretMatch[] = [];
  let last = -1;
  for (const s of all) {
    if (s.start < last) continue;
    out.push(s);
    last = s.end;
    if (out.length >= max) break;
  }
  return out;
}

/** "sk-a[redacted, 51 chars]": the first 4 characters and the length, never more. */
export function redactValue(value: string): string {
  return `${value.slice(0, 4)}[redacted, ${value.length} chars]`;
}

// ---------------------------------------------------------------------------------------------
// Redaction for messages. findSecrets() above is for detection: it only knows exact key shapes, so
// a finding that says "this is a key" is never a guess. Redaction is for display and errs the
// other way: anything that looks like it could be a credential is masked before file text reaches
// a message, because a masked word costs a reader little and a leaked key cannot be taken back.
// Three layers, all linear:
//   1. more key shapes (GitLab, Hugging Face, SendGrid, JWT, Slack webhook URLs, private keys);
//   2. credentials by position: user:password@ in a URL, the value after Bearer, Basic,
//      Authorization:, an X-...-Key: header, --token, --password, key=, token=, secret= and the like;
//   3. any word that looks random: long, and mixing digits with letters (or upper with lower case,
//      or symbols with both) the way generated keys and passwords do, plus UUIDs and long digit
//      runs. Words are split on / . : @ ? = so one random part masks the whole word. Plain hex
//      (commit ids, sha256 sums) is not masked by this layer.

const MASK_SHAPES: readonly RegExp[] = [
  /\bglpat-[A-Za-z0-9_-]{16,255}/g,
  /\bhf_[A-Za-z0-9]{24,255}/g,
  /\bSG\.[A-Za-z0-9_-]{8,255}\.[A-Za-z0-9_-]{8,255}/g,
  /\beyJ[A-Za-z0-9_-]{6,4096}\.[A-Za-z0-9_-]{4,4096}(?:\.[A-Za-z0-9_-]{0,4096})?/g,
  /hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/_-]{1,512}/g,
  /-----BEGIN [A-Z0-9 ]{0,60}(?:-----)?/g, // a PEM header, whole or cut short
];

/** Where a credential is the next word: the value group is what gets masked. Bounded repeats only. */
const MASK_CONTEXT: readonly RegExp[] = [
  // scheme://user:password@host, and scheme://token@host
  /[A-Za-z][A-Za-z0-9+.-]{0,20}:\/\/([^\s/@'"`<>]{1,256})@/dg,
  // Authorization: Bearer x, Authorization: x, Bearer x
  /\b(?:authorization\s{0,4}[:=]\s{0,4}(?:(?:bearer|basic|token|bot)\s{1,4})?|bearer\s{1,4})([^\s'"`<>,;]{4,4096})/dgi,
  // X-Api-Key: x, Api-Key: x, X-Auth-Token: x, Private-Token: x (headers that hold a credential)
  // (the keyword alone is matched, not the header name before it, so a long run of letters cannot
  // make the engine retry a prefix at every position)
  /(?:key|token|secret|auth|password|signature)\s{0,4}:\s{0,4}(?:(?:bearer|basic|token|bot)\s{1,4})?([^\s'"`<>,;]{4,4096})/dgi,
  // --token x, --api-key=x, -p x is too short to know; long flags only
  /--?[A-Za-z0-9-]{0,30}(?:token|key|secret|password|passwd|pwd|auth|credential)s?(?:=|\s{1,4})([^\s'"`<>,;-][^\s'"`<>,;]{3,4096})/dgi,
  // key=x, api_key=x, password: x, "token": "x" (query strings, env lines, YAML, JSON)
  /(?:token|apikey|api_key|api-key|secret|password|passwd|pwd|credential|access_key|private_key|auth)["']?\s{0,4}[=:]\s{0,4}["']?([^\s'"`<>,;&]{4,4096})/dgi,
];

/** A value in a credential position that is worth masking: not a placeholder, a variable name or a plain word. */
function credentialValue(v: string): boolean {
  if (v.length < 6) return false;
  if (/^[$<{%[]/.test(v)) return false; // ${TOKEN}, <token>, {{ secrets.X }}, %TOKEN%
  if (/^[A-Z][A-Z0-9_]*$/.test(v)) return false; // an environment variable name
  if (/^[a-z]+$/.test(v) && v.length < 12) return false; // a plain word: "tokens", "required"
  if (/^(?:bearer|basic|token|bot)$/i.test(v)) return false;
  return true;
}

/** A word (no spaces, quotes or brackets) and the parts it is split into for the random test. */
const WORD = /[^\s'"`<>()[\]{},;|\\]{8,}/g;
const PART = /[^/.:@?=]+/g;

/** True when a part of a word looks generated rather than written. */
function looksRandom(part: string): boolean {
  const n = part.length;
  if (n < 10) return false;
  let upper = 0;
  let lower = 0;
  let digit = 0;
  let other = 0;
  let run = 0;
  let longest = 0;
  let digitRun = 0;
  let longestDigits = 0;
  let hex = 0;
  for (let i = 0; i < n; i++) {
    const c = part.charCodeAt(i);
    const alnum = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    if (c >= 48 && c <= 57) digit++;
    else if (c >= 65 && c <= 90) upper++;
    else if (c >= 97 && c <= 122) lower++;
    else if (c !== 45 && c !== 95) other++; // - and _ are ordinary in names
    run = alnum ? run + 1 : 0;
    if (run > longest) longest = run;
    digitRun = c >= 48 && c <= 57 ? digitRun + 1 : 0;
    if (digitRun > longestDigits) longestDigits = digitRun;
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)) hex++;
  }
  const letters = upper + lower;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part)) return true; // UUID
  if (longestDigits >= 16) return true; // long digit run
  // Groups of hex digits joined by - or _ (a UUID cut short, a hex key with a prefix). A plain hex
  // run is left alone: commit ids and sha256 sums are hex too, and they are not secrets.
  if (hex >= 16 && digit >= 6 && hex < n && hex + (n - upper - lower - digit) === n) return true;
  // A password-like word: a symbol other than - and _, digits and letters.
  if (n >= 12 && other && digit && letters >= 2) return true;
  if (longest < 12) return false;
  // Mixed case with digits, as most generated keys are.
  if (n >= 16 && digit >= 2 && upper >= 2 && lower >= 2) return true;
  // Lower case or upper case with many digits (base36, hex-like ids).
  if (n >= 20 && digit >= 4 && letters >= 4 && hex < n) return true;
  // Letters only, but upper and lower case mixed far more than any word or identifier does.
  if (n >= 20 && !digit && upper * 4 >= n && lower * 4 >= n) return true;
  return false;
}

/** The whole-word test for a word split by separators: long, with several digits, upper and lower case letters. */
function randomAcross(w: string): boolean {
  if (w.length < 24) return false;
  let upper = 0;
  let lower = 0;
  let digit = 0;
  for (let i = 0; i < w.length; i++) {
    const c = w.charCodeAt(i);
    if (c >= 48 && c <= 57) digit++;
    else if (c >= 65 && c <= 90) upper++;
    else if (c >= 97 && c <= 122) lower++;
  }
  return digit >= 3 && upper >= 3 && lower >= 3 && upper + digit >= w.length / 4;
}

interface Span {
  start: number;
  end: number;
  /** True for a known key shape, whose first 4 characters (ghp_, sk-a, AKIA) name the type and are shown. */
  shape?: boolean;
}

/** Every span of text that redact() masks, sorted, without overlaps. */
export function findMasks(text: string): Span[] {
  const all: Span[] = findSecrets(text, Number.MAX_SAFE_INTEGER).map((s) => ({ start: s.start, end: s.end, shape: true }));
  for (const re of MASK_SHAPES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) all.push({ start: m.index, end: m.index + m[0].length, shape: true });
  }
  for (const re of MASK_CONTEXT) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const v = m[1];
      const at = m.indices?.[1];
      if (!v || !at || !credentialValue(v)) continue;
      all.push({ start: at[0], end: at[1] });
    }
  }
  WORD.lastIndex = 0;
  for (const m of text.matchAll(WORD)) {
    let hit = false;
    let parts = 0;
    for (const p of m[0].matchAll(PART)) {
      parts++;
      if (looksRandom(p[0])) {
        hit = true;
        break;
      }
    }
    // A key with / or . in it (base64, a token cut short) can split into parts that each look
    // ordinary. The whole word, separators left out, gets a stricter version of the same test.
    if (!hit && parts > 1) hit = randomAcross(m[0].replace(/[/.:@?=]/g, ""));
    if (hit) all.push({ start: m.index, end: m.index + m[0].length });
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      // Overlapping spans merge, so no piece of a key is left between them.
      if (s.end > last.end) last.end = s.end;
      last.shape = last.shape === true && s.shape === true;
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

/** What a mask leaves: the length, and for a known key shape its first 4 characters. */
const MASKED = /\S{0,4}\[redacted, \d{1,9} chars\]/g;

/**
 * text with every key-shaped, credential-placed or random-looking substring masked. A known key
 * shape keeps its first 4 characters (redactValue), anything else shows only its length. Text that
 * is already masked is left as it is, so redact(redact(x)) === redact(x).
 */
export function redact(text: string): string {
  if (text.length < 4) return text;
  if (!text.includes("[redacted, ")) return redactPart(text);
  let out = "";
  let at = 0;
  MASKED.lastIndex = 0;
  for (const m of text.matchAll(MASKED)) {
    out += redactPart(text.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + redactPart(text.slice(at));
}

function redactPart(text: string): string {
  if (text.length < 4) return text;
  const found = findMasks(text);
  if (!found.length) return text;
  let out = "";
  let at = 0;
  for (const s of found) {
    const v = text.slice(s.start, s.end);
    out += text.slice(at, s.start) + (s.shape ? redactValue(v) : `[redacted, ${v.length} chars]`);
    at = s.end;
  }
  return out + text.slice(at);
}

/**
 * A short quote of file text for a message: redacted first, then cut to max characters
 * (default 80) with "..." at the end when cut. Cutting after redaction means a key can never be
 * half shown.
 */
export function preview(text: string, max = 80): string {
  // Only the start can be shown; the extra 4,096 characters let a key that crosses the cut be seen whole.
  const head = text.length > max + 4096 ? text.slice(0, max + 4096) : text;
  const r = redact(head.replace(/[\r\n]+/g, " "));
  return r.length <= max ? r : `${r.slice(0, Math.max(0, max - 3))}...`;
}
