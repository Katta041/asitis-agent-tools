// What a repository calls itself, for rules that treat the project's own packages and URLs
// differently from third-party ones: sec-mcp-launcher (a repo that runs its own published MCP
// server unpinned) and sec-remote-exec (a skill that tests the project's own install script).
//
// Read-only and narrow: the root folder's name always; with include "config", also the "name",
// "homepage" and "repository" of the root package.json and the [project] name of pyproject.toml,
// read through the agent-config read class. Nothing from these files is echoed.

import path from "node:path";
import type { CheckContext } from "../project.js";

export interface OwnProject {
  /** Normalised package and folder names ("socraticode", "code-review-graph" -> "codereviewgraph"). */
  names: Set<string>;
  /** "owner/repo" of GitHub, GitLab or Bitbucket URLs in the manifests, lower case. */
  repos: Set<string>;
  /** Hosts of the homepage and repository URLs, lower case. */
  hosts: Set<string>;
}

/** A package or folder name without scope, version, extras, case or punctuation, and without an "mcp" or "server" affix. */
export function normName(name: string): string {
  const bare = name
    .trim()
    .toLowerCase()
    .replace(/^@[^/]+\//, "")
    .replace(/\[.*$/, "")
    .replace(/(?:==|>=|~=|@).*$/, "");
  const n = bare.replace(/[^a-z0-9]+/g, "");
  return n.replace(/^(?:mcp)+(?=.)/, "").replace(/(?:mcpserver|mcp|server)$/, "") || n;
}

const REPO_URL = /(?:github\.com|gitlab\.com|bitbucket\.org|raw\.githubusercontent\.com)[/:]([\w.-]{1,100})\/([\w.-]{1,100})/i;

/** "owner/repo" of a code-host URL, lower case, without .git; null for other URLs. */
export function repoOfUrl(url: string): string | null {
  const m = REPO_URL.exec(url);
  return m ? `${m[1]!.toLowerCase()}/${m[2]!.toLowerCase().replace(/\.git$/, "")}` : null;
}

const cache = new WeakMap<CheckContext, Promise<OwnProject>>();

export function ownProject(ctx: CheckContext): Promise<OwnProject> {
  let p = cache.get(ctx);
  if (!p) {
    p = load(ctx);
    cache.set(ctx, p);
  }
  return p;
}

async function readText(ctx: CheckContext, rel: string): Promise<string | null> {
  if (!ctx.include.has("config") && !ctx.include.has("config-local")) return null;
  const probe = await ctx.sandbox.probe(rel, ctx.sandbox.primary.real);
  if (probe.state !== "ok") return null;
  try {
    const f = await ctx.sandbox.openAs("agent-config", rel, { grants: ctx.include });
    return new TextDecoder("utf-8").decode(f.buf);
  } catch {
    return null;
  }
}

async function load(ctx: CheckContext): Promise<OwnProject> {
  const own: OwnProject = { names: new Set(), repos: new Set(), hosts: new Set() };
  const folder = path.basename(ctx.sandbox.primary.real);
  if (folder) own.names.add(normName(folder));
  const urls: string[] = [];
  const pkg = await readText(ctx, "package.json");
  if (pkg) {
    try {
      const j = JSON.parse(pkg) as Record<string, unknown>;
      if (typeof j["name"] === "string") own.names.add(normName(j["name"]));
      if (typeof j["homepage"] === "string") urls.push(j["homepage"]);
      const r = j["repository"];
      if (typeof r === "string") urls.push(r);
      else if (r && typeof r === "object" && typeof (r as Record<string, unknown>)["url"] === "string") urls.push((r as Record<string, string>)["url"]!);
    } catch {
      // not JSON: nothing learned
    }
  }
  const py = await readText(ctx, "pyproject.toml");
  if (py) {
    // [project] name = "..." (PEP 621) or [tool.poetry] name = "...": the first name line of either table.
    let table = "";
    for (const line of py.split(/\r?\n/, 2000)) {
      const t = /^\s*\[([^\]]{1,80})\]\s*$/.exec(line);
      if (t) {
        table = t[1]!.trim();
        continue;
      }
      if (table !== "project" && table !== "tool.poetry") continue;
      const m = /^\s*name\s*=\s*["']([^"']{1,200})["']/.exec(line);
      if (m) own.names.add(normName(m[1]!));
      const u = /^\s*(?:homepage|repository)\s*=\s*["']([^"']{1,300})["']/.exec(line);
      if (u) urls.push(u[1]!);
    }
  }
  for (const u of urls) {
    const repo = repoOfUrl(u);
    if (repo) {
      own.repos.add(repo);
      own.names.add(normName(repo.split("/")[1]!));
    }
    const h = /^(?:git\+)?https?:\/\/([^/:\s]{1,200})/i.exec(u);
    if (h) own.hosts.add(h[1]!.toLowerCase());
  }
  return own;
}

/** Whether a download URL points at this project: its own repository on a code host, or its homepage host. */
export function isOwnUrl(own: OwnProject, url: string): boolean {
  if (!url) return false;
  const repo = repoOfUrl(url);
  if (repo) return own.repos.has(repo) || own.names.has(normName(repo.split("/")[1]!));
  const h = /^https?:\/\/([^/:\s]{1,200})/i.exec(url);
  return !!h && own.hosts.has(h[1]!.toLowerCase());
}
