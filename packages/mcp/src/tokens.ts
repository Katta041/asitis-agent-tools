// Approximate token counts, computed locally. Never sends text anywhere.
// Heuristic: about 4 characters per token for ASCII text, about 1 token per
// character for CJK and other non-Latin scripts. Label every number "about".

export function approxTokens(s: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) ascii++;
    else if (c < 0xdc00 || c > 0xdfff) other++; // count a surrogate pair once
  }
  return Math.ceil(ascii / 4 + other * 0.8);
}

/** Estimate from byte size alone, for files this server does not read (for example an imported JSON file). */
export function tokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}

export function fmtTokens(n: number): string {
  if (n >= 10000) return `about ${(n / 1000).toFixed(0)}k tokens`;
  if (n >= 1000) return `about ${(n / 1000).toFixed(1)}k tokens`;
  return `about ${n} tokens`;
}
