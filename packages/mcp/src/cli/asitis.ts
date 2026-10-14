// Entry point of the asitis CLI (bin "asitis"): asitis lint [paths...] [options]. Owner: WP1.
// Stub until WP1 lands; it is not bundled yet. docs/cli-contract.md is the spec: flags, exit codes
// 0 to 3, output formats. Build on lintProject (project.ts) and buildReport (findings.ts).

/** Exit codes. 2 is anything the user can fix; 3 is a bug in asitis. */
export const EXIT = { ok: 0, findings: 1, usage: 2, internal: 3 } as const;

export async function run(_argv: string[]): Promise<number> {
  process.stderr.write("asitis: the lint command is not available in this build yet.\n");
  return EXIT.internal;
}
