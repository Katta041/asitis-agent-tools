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

/** text with every token-shaped substring replaced by redactValue(). */
export function redact(text: string): string {
  const found = findSecrets(text, Number.MAX_SAFE_INTEGER);
  if (!found.length) return text;
  let out = "";
  let at = 0;
  for (const s of found) {
    out += text.slice(at, s.start) + redactValue(text.slice(s.start, s.end));
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
  const r = redact(text.replace(/[\r\n]+/g, " "));
  return r.length <= max ? r : `${r.slice(0, Math.max(0, max - 3))}...`;
}
