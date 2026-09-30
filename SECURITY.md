# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/Katta041/asitis-agent-tools/security/advisories/new)). Do not open a public issue.

Include the version, your operating system and Node version, and the smallest steps or files that reproduce the problem. We aim to acknowledge reports within five working days and to agree a disclosure date with you once a fix is ready.

## Supported versions

Only the latest released version of `@asitis/mcp` and of the `asitis` plugin receives security fixes.

## Scope

In scope, for example:

- reading any file outside the configured root, or any file that is not on the markdown allowlist (including `.env*` and `.claude/settings*.json`);
- any write, network connection or child process started by the server or the guard hook;
- input that makes a tool call exceed its time budget or exhaust memory;
- the plugin's vendored server not matching its SHA-256 pin.

Out of scope: a model following instructions it read in a file (the server labels content as untrusted and reports hidden instructions, but cannot stop a model from obeying text), and bypasses of the guard hook, which is documented as an accident guard, not a security boundary.
