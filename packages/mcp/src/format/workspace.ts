// Paths in GitHub annotations and SARIF are read relative to the repository checkout, but findings
// are relative to --root. Owner: WP1 (format/).

/**
 * When --root names a relative subfolder, prefix it, so `asitis lint --root docs` reports
 * docs/CLAUDE.md and not CLAUDE.md. An absolute root or one that climbs out (..) is left alone:
 * there is no safe way to make it repository-relative, and printing it would leak an absolute path.
 */
export function workspacePath(root: string, p: string): string {
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (r === "" || r === "." || r.startsWith("/") || /^[A-Za-z]:/.test(r) || r.startsWith("..")) return p;
  return `${r.replace(/^(\.\/)+/, "")}/${p}`;
}
