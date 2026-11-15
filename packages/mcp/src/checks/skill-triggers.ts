// Skill trigger checks (0.4.0): is each skill's description something Claude can match a request
// against, and do the skills that load together fit and stay apart. Runs on every project lint (no
// include needed) and reads nothing beyond the markdown the lint already read.
//
// Rules and what they rest on (all read 15 November 2026):
// - skill-description-vague, skill-description-person: Anthropic's skill authoring best practices,
//   "Writing effective descriptions" (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices):
//   "Always write in third person. The description is injected into the system prompt, and
//   inconsistent point-of-view can cause discovery problems." Avoid "I can help you process Excel
//   files" and "You can use this to process Excel files". Avoid vague descriptions such as "Helps
//   with documents", "Processes data", "Does stuff with files". Anthropic's own published skills
//   (anthropics/skills) address Claude as "you" ("You should use this skill when...") and quote the
//   user in the first person ("help me write"), so only the skill speaking as "I", and the guide's
//   own "You can use this to..." form, are reported.
// - skill-description-overlap: same page, "Claude uses it to choose the right Skill from
//   potentially 100+ available Skills."
// - skill-listing-budget: Claude Code skills docs, "Skill descriptions are cut short"
//   (https://code.claude.com/docs/en/skills): the listing "always contains every skill name", the
//   budget "scales at 1% of the model's context window", and over it Claude Code "drops
//   descriptions starting with the skills you invoke least". Settings reference:
//   skillListingBudgetFraction defaults to 0.01, skillListingMaxDescChars to 1536. Env vars page:
//   SLASH_COMMAND_TOOL_CHAR_BUDGET, "a fallback of 8,000 characters". A skill with
//   disable-model-invocation: true has its "Description not in context", so it is not counted.
// - skill-shadowed-command: Claude Code skills docs, "Resolve skills that share a name": "A skill
//   and a file in .claude/commands/ | The skill". Names compare ignoring case. A plugin's commands/
//   and skills/ are not covered: the docs do not say which one wins there.

import path from "node:path";
import type { Doc } from "../doc.js";
import { dp, q } from "../escape.js";
import { ruleOptions } from "../config.js";
import { findingPath } from "../findings.js";
import type { Issue } from "../lint.js";
import { inTemplateFolder, inTestTree, topLevelSkill } from "../places.js";
import type { CheckContext, ProjectCheck } from "../project.js";

/** Defaults for the options .asitisrc.json can set (RULE_OPTIONS in config.ts). */
export const SKILL_TRIGGER_DEFAULTS = {
  /** skill-description-vague: only descriptions of at most this many words are judged. */
  maxWords: 12,
  /** skill-description-overlap: share of key words, in percent, for a note and for a warning. */
  notePercent: 55,
  warnPercent: 80,
  /** skill-description-overlap: a pair also needs this many shared key words. */
  minSharedWords: 6,
  /** skill-description-overlap: folders with more skills than this are skipped (a catalog, not a set). */
  maxSkills: 300,
  /** skill-listing-budget: the documented fallback; 1% of a 200,000-token window is about the same. */
  budgetChars: 8000,
  /** skill-listing-budget: skillListingMaxDescChars default. */
  maxDescChars: 1536,
} as const;

/** Longest description text looked at; descriptions are at most 1,024 characters by the spec. */
const MAX_TEXT = 4096;

// ---------------------------------------------------------------------------------------------
// Text helpers. Every regex here is anchored on fixed words with bounded repeats, and input is cut
// to MAX_TEXT first, so all of them run in linear time.

/** Words that carry no meaning about what a skill does. */
const STOP = new Set(
  ("a an the and or but nor of for to in on at by with from into onto via as is are was were be been being am this that these those it its " +
    "use used using uses when whenever while if then than not no do does did done can could will would should shall may might must " +
    "also any all some such etc eg ie including include includes like your you yours their they them our we us he she his her " +
    "more most other about over under through after before during each every one two three new so just only very user users user's asks ask asked " +
    "wants want need needs needed claude skill skills trigger triggers triggered here there what which who how why where whether").split(" "),
);

/**
 * Words that say nothing specific: "Helps with documents", "Processes data" and "Does stuff with
 * files" from Anthropic's guide are made only of these.
 */
const GENERIC = new Set(
  ("help helps helping helper helpers helpful assist assists assistant assistance support supports supporting stuff thing things various misc " +
    "miscellaneous general generic utility utilities util utils tool tools toolkit toolbox toolset file files data document documents docs doc " +
    "task tasks work works working process processes processing processed handle handles handling manage manages managing management make makes " +
    "making useful simple basic common everything anything something project projects code coding development dev guideline guidelines guide " +
    "guides guidance example examples sample samples demo custom workflow workflows agent agents ai operation operations feature features " +
    "functionality function functions content info information resource resources set collection provide provides providing enable enables " +
    "allow allows let lets create creates creating generate generates generating build builds building run runs running write writes writing " +
    "read reads reading edit edits editing analyze analyzes analyse analyses analysis better improve improves various related stuff purpose " +
    "purposes way ways thing item items etc skill's helpers module modules system systems service services").split(" "),
);

/** English function words; a description with none of them is taken as not English and skipped. */
const ENGLISH = new Set("the to for with and of when use this that from or is are by into".split(" "));

/** True when the text reads as English: almost all letters ASCII and at least one English function word. */
export function looksEnglish(text: string): boolean {
  const s = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  let letters = 0;
  let foreign = 0;
  for (const ch of s) {
    if (/\p{L}/u.test(ch)) {
      letters++;
      if (ch.charCodeAt(0) > 127) foreign++;
    }
  }
  if (!letters || foreign / letters > 0.2) return false;
  const words = s.toLowerCase().match(/[a-z']+/g) ?? [];
  // A short text has few function words, so any word from the English lists counts.
  if (words.length <= 3) return words.some((w) => ENGLISH.has(w) || STOP.has(w) || GENERIC.has(w));
  return words.some((w) => ENGLISH.has(w));
}

const WHOLE_PLACEHOLDER = /^(?:todo|tbd|tbc|wip|fixme|x{3,}|n\/a|none|null|placeholder|description|desc|test|testing|example|sample|\.{2,}|-{1,}|_{1,}|\?{1,})[.!]?$/i;
const PLACEHOLDER_PHRASE =
  /\b(?:replace (?:this|me|with (?:a |the |your )?description)|describe (?:what|when) (?:this|your|the) skill|description (?:of|for) (?:this|your|the) skill and when|(?:your|a|add a|insert|enter) description here|lorem ipsum)\b|\[(?:description|todo|tbd)\b[^\]\n]{0,60}\]|<(?:description|todo)\b[^>\n]{0,60}>|\{\{\s{0,4}description\s{0,4}\}\}/i;

export interface VagueResult {
  kind: "placeholder" | "generic";
}

/**
 * Why a description is too vague to trigger on, or null. Placeholder text (template leftovers) and
 * short descriptions made only of generic words count; anything that names a file type, a tool, a
 * product or a concrete task does not.
 */
export function vagueDescription(text: string, maxWords: number = SKILL_TRIGGER_DEFAULTS.maxWords): VagueResult | null {
  const s = (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text).trim();
  if (!s) return null; // missing-description reports an empty one
  if (WHOLE_PLACEHOLDER.test(s) || PLACEHOLDER_PHRASE.test(s)) return { kind: "placeholder" };
  const raw = s.split(/\s+/);
  if (raw.length > maxWords) return null;
  let content = 0;
  for (const r of raw) {
    // A token with a digit, a dot inside, a slash or a hyphen (".docx", "p5.js", "CI/CD", "pull-request") is specific.
    const t = r.replace(/^[("'`[{]+|[)"'`\]},.:;!?]+$/g, "");
    if (!t) continue;
    if (/[^A-Za-z']/.test(t)) return null;
    const w = t.toLowerCase().replace(/'s$/, "");
    if (STOP.has(w)) continue;
    content++;
    if (!GENERIC.has(w)) return null;
  }
  return content > 0 || raw.length <= 3 ? { kind: "generic" } : null;
}

/** Quoted text is the user's words, not the skill's voice: "help me write", 'what did I do'. */
function stripQuotes(text: string): string {
  return text
    .replace(/"[^"\n]{0,300}"/g, " ")
    .replace(/\u201c[^\u201d\n]{0,300}\u201d/g, " ")
    .replace(/\u2018[^\u2019\n]{0,300}\u2019/g, " ")
    .replace(/`[^`\n]{0,300}`/g, " ")
    .replace(/(^|[\s([{:,;])'[^'\n]{1,300}'(?=[\s)\]}.,;:!?]|$)/g, "$1 ");
}

/** The skill speaking as "I" at the start of a clause, or the guide's own "You can use this to...". */
const FIRST_PERSON =
  /(?:^|[.!?;:]\s{1,4}|,\s{1,4}|\(\s{0,4})(I(?:['\u2019](?:m|ll|ve)| (?:am|can|will|help|provide|create|generate|write|build|make|turn|guide|walk|offer|assist|act|specialize|focus|recommend|handle|review|analy[sz]e))\b|Let me\b)/;
const YOU_CAN_USE = /(?:^|[.!?]\s{1,4})(You can use (?:this|it|me)\b)/;

/** The words that show a description is not in third person, or null. */
export function personProblem(text: string): string | null {
  const s = stripQuotes(text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text);
  const m = FIRST_PERSON.exec(s) ?? YOU_CAN_USE.exec(s);
  return m ? m[1]! : null;
}

/** A light stemmer: enough that "apps" meets "app" and "databases" meets "database". */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !/(?:ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

/**
 * Words of a text, lower case, plural and -ing endings cut, each mapped to the first spelling seen
 * (for messages). Stop words and plain numbers are left out unless all is set: the rest are the
 * key words.
 */
export function keyWords(text: string, all = false): Map<string, string> {
  const s = (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text).toLowerCase().replace(/['`"\u2019]/g, "");
  const out = new Map<string, string>();
  for (const t of s.split(/[^a-z0-9+#]+/)) {
    if (t.length < 2 || (!all && (STOP.has(t) || /^\d+$/.test(t)))) continue;
    const k = stem(t);
    if (!out.has(k)) out.set(k, t);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Collecting skills

interface Skill {
  doc: Doc;
  /** Folder name, and the frontmatter name when it has one. */
  dir: string;
  name: string;
  description: string | null;
  /** description plus when_to_use, as the listing shows it. */
  listed: string;
  line: number;
  modelInvocable: boolean;
}

/**
 * A word from a skill's name that its own description uses and the other skill's name and
 * description do not ("android" in mobile-android-design next to mobile-ios-design). Such a word
 * gives Claude something to tell the two apart, however much boilerplate they share.
 */
function nameWordOnlyIn(a: Skill, aWords: Map<string, string>, b: Skill, bWords: Map<string, string>): boolean {
  const bName = keyWords(`${b.dir} ${b.name}`, true);
  // "review" counts as used by a description that says "reviewers".
  const inB = (t: string): boolean => {
    if (bWords.has(t) || bName.has(t)) return true;
    if (t.length < 4) return false;
    for (const w of bWords.keys()) if (w.startsWith(t)) return true;
    return false;
  };
  for (const t of keyWords(`${a.dir} ${a.name}`, true).keys()) if (aWords.has(t) && !inB(t)) return true;
  return false;
}

/**
 * Opposite operations, as stems. Two skills that do opposite things (profiler-start and
 * profiler-stop, package-add and package-remove) share most of their wording on purpose, and Claude
 * tells "enable" from "disable" without help. Short stems must match a word exactly; longer ones
 * also match as a prefix ("enabl" in "enables").
 */
const OPPOSITES: ReadonlyArray<readonly [string, string]> = [
  ["enabl", "disabl"], ["enable", "disable"], ["start", "stop"], ["install", "uninstall"], ["add", "remov"], ["add", "remove"], ["creat", "delet"], ["create", "delete"],
  ["open", "close"], ["import", "export"], ["encod", "decod"], ["encrypt", "decrypt"], ["upload", "download"], ["push", "pull"],
  ["lock", "unlock"], ["show", "hide"], ["login", "logout"], ["connect", "disconnect"], ["attach", "detach"], ["mount", "unmount"],
  ["subscrib", "unsubscrib"], ["pause", "resume"], ["expand", "collaps"], ["compress", "decompress"], ["serializ", "deserializ"],
  ["zip", "unzip"], ["follow", "unfollow"], ["block", "unblock"], ["increas", "decreas"], ["frontend", "backend"], ["ios", "android"],
];

function hasStem(words: Map<string, string>, x: string): boolean {
  if (words.has(x)) return true;
  if (x.length < 5) return false;
  for (const w of words.keys()) if (w.startsWith(x)) return true;
  return false;
}

/** True when one skill does an operation and the other its opposite (see OPPOSITES). */
function opposite(a: Map<string, string>, b: Map<string, string>): boolean {
  for (const [x, y] of OPPOSITES) {
    if (hasStem(a, x) && !hasStem(a, y) && hasStem(b, y)) return true;
    if (hasStem(b, x) && !hasStem(b, y) && hasStem(a, y)) return true;
  }
  return false;
}

const truthy = (v: unknown): boolean => v === true || (typeof v === "string" && /^(?:true|yes|on|1)$/i.test(v.trim())) || v === 1;

/** First non-empty line of the body: Claude Code's stand-in for a missing description. */
function firstBodyLine(doc: Doc): string {
  const start = doc.frontmatter.present ? doc.frontmatter.endLine + 1 : 0;
  for (let i = start; i < doc.lines.count && i < start + 200; i++) {
    const t = doc.lines.line(i).trim();
    if (t) return t;
  }
  return "";
}

function skillOf(doc: Doc): Skill {
  const data = doc.frontmatter.present ? doc.frontmatter.data : null;
  const dir = path.posix.basename(path.posix.dirname(doc.file.rel));
  const rawName = data?.["name"];
  const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : dir;
  const desc = typeof data?.["description"] === "string" && (data["description"] as string).trim() ? (data["description"] as string) : null;
  const when = typeof data?.["when_to_use"] === "string" ? (data["when_to_use"] as string) : "";
  const listed = `${desc ?? firstBodyLine(doc)}${when ? ` ${when}` : ""}`;
  return { doc, dir, name, description: desc, listed, line: doc.frontmatter.keyLines["description"] ?? 1, modelInvocable: !truthy(data?.["disable-model-invocation"]) };
}

/** A template-skill or skill-template folder: a skeleton to copy, whose placeholder text is on purpose. */
const TEMPLATE_NAME = /^(?:templates?|templates?[-_]skills?|skills?[-_]templates?|example[-_]skill|my[-_]skill|new[-_]skill)$/i;

/**
 * A skill whose description Claude reads to pick it: not a test fixture, not a template to copy. A
 * template-skill folder inside a project's .claude/skills is installed, though, so Claude Code
 * lists its placeholder description like any other.
 */
const judged = (s: Skill): boolean =>
  s.modelInvocable && !inTestTree(s.doc.file.rel) && !inTemplateFolder(s.doc.file.rel) && (!TEMPLATE_NAME.test(s.dir) || /(?:^|\/)\.claude\/skills\/[^/]+\/SKILL\.md$/.test(s.doc.file.rel));

/**
 * The folder whose skills load together, for the overlap test: the skills folder holding the
 * skill (".claude/skills", "plugins/x/skills", "skills"), or "." for a skill folder at the root.
 * A SKILL.md nested inside another skill (a pipeline's stages, variants of one skill) has none.
 */
function setOf(rel: string): string | null {
  if (!topLevelSkill(rel)) return null;
  const parts = rel.split("/").slice(0, -2);
  // A skills folder inside another skill (".claude/skills/gstack/.agents/skills") is that skill's
  // vendored copy for other agents, not a set anyone loads.
  for (let i = 0; i < parts.length - 2; i++) if (parts[i] === "skills" || parts[i] === "skill") return null;
  return parts.length ? parts.join("/") : ".";
}

/**
 * The group Claude Code lists together, for the budget: a .claude folder (its skills/ and
 * commands/), or a plugin-like folder whose skills/ holds the skill. Skill folders meant for other
 * agents (.gemini/skills, .codex/skills, .agents/skills) are not Claude Code's listing.
 */
function listingOf(rel: string, kind: string): string | null {
  const parts = rel.split("/");
  if (kind === "claude-command") {
    const k = parts.lastIndexOf("commands");
    return k >= 1 && parts[k - 1] === ".claude" ? parts.slice(0, k).join("/") : null;
  }
  if (parts.length < 3 || parts[parts.length - 3] !== "skills") return null;
  const owner = parts.slice(0, -3);
  if (owner.length && owner[owner.length - 1] === ".claude") return owner.join("/");
  return owner.some((p) => p.startsWith(".")) ? null : owner.length ? owner.join("/") : ".";
}

const n = (x: number): string => x.toLocaleString("en-US");
const normName = (s: string): string => s.normalize("NFKC").toLowerCase().trim();

// ---------------------------------------------------------------------------------------------
// The checks

function checkDescriptions(ctx: CheckContext, skills: Skill[]): void {
  const maxWords = ruleOptions(ctx.config, "skill-description-vague")["maxWords"] ?? SKILL_TRIGGER_DEFAULTS.maxWords;
  for (const s of skills) {
    if (!s.description || !judged(s)) continue;
    const data = s.doc.frontmatter.data;
    const when = typeof data?.["when_to_use"] === "string" ? (data["when_to_use"] as string) : "";
    const text = when ? `${s.description} ${when}` : s.description;
    if (!looksEnglish(text)) continue;
    const vague = vagueDescription(text, maxWords);
    if (vague) {
      const message =
        vague.kind === "placeholder"
          ? `description ${q(s.description, 80)} is still placeholder text, so Claude has nothing to match a request against. Say what the skill does and when to use it`
          : `description ${q(s.description, 80)} names no file type, tool or task, so Claude has little to match a request against (Anthropic's skill guide lists "Helps with documents" as one to avoid). Say what the skill does and when to use it, in the words a user would type`;
      ctx.report(s.doc.path, { severity: "info", rule: "skill-description-vague", message, line: s.line });
    }
    const person = personProblem(text);
    if (person) {
      ctx.report(s.doc.path, { severity: "info", rule: "skill-description-person", message: `description speaks as the skill (${q(person, 40)}). Anthropic's skill guide says to write it in third person, as in "Processes Excel files and generates reports", because it is injected into the system prompt and a mixed point of view can cause discovery problems`, line: s.line });
    }
  }
}

/** "Do not use for ...", "Don't use it when ...", "Not for ...": the clause names what the skill is not. */
const EXCLUSION = /\b(?:do\s+not|don't|never)\s+use(?:\s+(?:it|this(?:\s+skill)?))?\s+(?:for|when|on|with|to)\b|\bnot\s+for\b/gi;

/**
 * Splits a listing into the text without its exclusion clauses (each cut to the end of its
 * sentence) and the clauses themselves. "Review frontend code ... Do not use for backend-only
 * code" next to "Review backend code ... Do not use for frontend code": each clause names the
 * other skill to tell them apart, and would otherwise add shared words. Linear: one regex pass
 * with no nested quantifiers and a forward indexOf per match.
 */
export function splitExclusions(text: string): { kept: string; excluded: string } {
  const t = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  let kept = "";
  let excluded = "";
  let at = 0;
  EXCLUSION.lastIndex = 0;
  for (let m = EXCLUSION.exec(t); m; m = EXCLUSION.exec(t)) {
    if (m.index < at) continue;
    kept += t.slice(at, m.index);
    let end = t.length;
    for (const stop of [". ", ".\n", ";", "\n"]) {
      const k = t.indexOf(stop, m.index);
      if (k >= 0 && k < end) end = k;
    }
    excluded += ` ${t.slice(m.index, end)}`;
    at = end;
    EXCLUSION.lastIndex = Math.max(EXCLUSION.lastIndex, end);
  }
  return { kept: kept + t.slice(at), excluded };
}

/** Words of b's name that a's name lacks ("backend" for backend-code-review next to frontend-code-review). */
function ownNameWords(b: Skill, a: Skill): string[] {
  const an = keyWords(`${a.dir} ${a.name}`, true);
  return [...keyWords(`${b.dir} ${b.name}`, true).keys()].filter((t) => !an.has(t));
}

/** a's exclusion clauses name b by a word only b's name has: the author already told them apart. */
function excludesOther(a: Skill, aExcluded: Map<string, string>, b: Skill): boolean {
  return ownNameWords(b, a).some((t) => hasStem(aExcluded, t));
}

/** a's listing points to b as a separate skill ("the sweeper-implement skill implements the plan"). */
function pointsToOther(a: Skill, b: Skill): boolean {
  const text = a.listed.toLowerCase();
  for (const nm of new Set([b.dir.toLowerCase(), b.name.toLowerCase()])) {
    if (nm.length < 4 || !/[-_:]/.test(nm)) continue;
    let k = text.indexOf(nm);
    while (k >= 0) {
      if (/^\W{0,3}(?:skill|command)\b/.test(text.slice(k + nm.length, k + nm.length + 12))) return true;
      k = text.indexOf(nm, k + nm.length);
    }
  }
  return false;
}

function checkOverlap(ctx: CheckContext, skills: Skill[]): void {
  const o = ruleOptions(ctx.config, "skill-description-overlap");
  const noteAt = (o["notePercent"] ?? SKILL_TRIGGER_DEFAULTS.notePercent) / 100;
  const warnAt = (o["warnPercent"] ?? SKILL_TRIGGER_DEFAULTS.warnPercent) / 100;
  const minShared = o["minSharedWords"] ?? SKILL_TRIGGER_DEFAULTS.minSharedWords;
  const maxSkills = o["maxSkills"] ?? SKILL_TRIGGER_DEFAULTS.maxSkills;
  const sets = new Map<string, Skill[]>();
  for (const s of skills) {
    if (!s.description || !judged(s)) continue;
    const key = setOf(s.doc.file.rel);
    if (key === null || !looksEnglish(s.listed)) continue;
    const g = sets.get(key) ?? [];
    g.push(s);
    sets.set(key, g);
  }
  const skipped: string[] = [];
  // The same skills copied into .claude/skills, .agents/skills and .gemini/skills give the same
  // pairs; report each pair once, in the .claude copy when there is one.
  const reported = new Set<string>();
  const order = [...sets.entries()].sort(([a], [b]) => Number(!/(?:^|\/)\.claude\//.test(`${a}/`)) - Number(!/(?:^|\/)\.claude\//.test(`${b}/`)) || (a < b ? -1 : a > b ? 1 : 0));
  for (const [key, group] of order) {
    if (group.length < 2) continue;
    if (group.length > maxSkills) {
      skipped.push(`${dp(key)} (${n(group.length)})`);
      continue;
    }
    if (ctx.deadline.expired) return;
    group.sort((a, b) => (a.doc.path < b.doc.path ? -1 : a.doc.path > b.doc.path ? 1 : 0));
    const split = group.map((s) => splitExclusions(s.listed));
    const excluded = split.map((x) => keyWords(x.excluded, true));
    const words = group.map((s) => keyWords(s.listed));
    const every = group.map((s) => keyWords(s.listed, true));
    const named = group.map((s) => keyWords(`${s.dir} ${s.name} ${s.listed}`, true));
    // A word in more than half of a large set's descriptions is the set's house style ("Automate
    // ... via Composio"), not a sign that two skills do the same thing.
    const df = new Map<string, number>();
    for (const w of words) for (const t of w.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    const keep = (t: string): boolean => group.length < 6 || (df.get(t) ?? 0) <= group.length / 2;
    const sets2 = words.map((w) => new Set([...w.keys()].filter(keep)));
    // Each skill is reported once, against the earlier skill it overlaps most.
    for (let j = 1; j < group.length; j++) {
      const b = sets2[j]!;
      if (b.size < 3) continue;
      let best = -1;
      let bestScore = 0;
      let bestShared: string[] = [];
      for (let i = 0; i < j; i++) {
        const a = sets2[i]!;
        if (a.size < 3) continue;
        const shared: string[] = [];
        for (const t of b) if (a.has(t)) shared.push(t);
        // Ochiai: shared words over the geometric mean of the two sizes, so a short description is
        // not swamped by a long one.
        const score = shared.length / Math.sqrt(a.size * b.size);
        if (shared.length < minShared || score < noteAt || score <= bestScore) continue;
        if (nameWordOnlyIn(group[i]!, every[i]!, group[j]!, every[j]!) || nameWordOnlyIn(group[j]!, every[j]!, group[i]!, every[i]!)) continue;
        if (opposite(named[i]!, named[j]!)) continue;
        if (pointsToOther(group[i]!, group[j]!) || pointsToOther(group[j]!, group[i]!)) continue;
        // Exclusion clauses that name the other skill: compare what each includes.
        if (excludesOther(group[i]!, excluded[i]!, group[j]!) || excludesOther(group[j]!, excluded[j]!, group[i]!)) {
          const ki = keyWords(`${group[i]!.dir} ${group[i]!.name} ${split[i]!.kept}`, true);
          const kj = keyWords(`${group[j]!.dir} ${group[j]!.name} ${split[j]!.kept}`, true);
          if (opposite(ki, kj) || nameWordOnlyIn(group[i]!, keyWords(split[i]!.kept, true), group[j]!, keyWords(split[j]!.kept, true)) || nameWordOnlyIn(group[j]!, keyWords(split[j]!.kept, true), group[i]!, keyWords(split[i]!.kept, true))) continue;
        }
        best = i;
        bestScore = score;
        bestShared = shared.map((t) => words[j]!.get(t) ?? t);
      }
      if (best < 0) continue;
      const other = group[best]!;
      const pairKey = `${other.dir}\0${group[j]!.dir}\0${other.listed}\0${group[j]!.listed}`;
      if (reported.has(pairKey)) continue;
      reported.add(pairKey);
      const pct = Math.floor(bestScore * 100);
      const shown = bestShared.slice(0, 6).join(", ");
      const near = bestScore >= warnAt;
      ctx.report(group[j]!.doc.path, {
        severity: near ? "warning" : "info",
        rule: "skill-description-overlap",
        message: `description ${near ? "is nearly the same as" : "overlaps"} the one in ${dp(findingPath(other.doc))} (${pct}% of key words shared, such as ${shown}). Claude picks one skill per request from these descriptions, so say what sets each one apart, or merge them`,
        line: group[j]!.line,
        fingerprintText: `overlap ${other.doc.file.rel}`,
      });
    }
  }
  if (skipped.length) ctx.note(`skill-description-overlap skipped ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? ` and ${skipped.length - 3} more` : ""}: more skills than maxSkills (${n(maxSkills)}) in one folder.`);
}

interface Listed {
  doc: Doc;
  name: string;
  chars: number;
  line: number;
}

/**
 * True when a skills folder's owner is installed as one unit: a .claude folder, or a folder with
 * .claude-plugin/plugin.json (only its existence is checked; nothing is read). A marketplace that
 * hands out a shared skills/ folder in several plugins (anthropics/skills) has no plugin.json there.
 */
async function installedTogether(ctx: CheckContext, key: string, sample: Doc): Promise<boolean> {
  if (key === ".claude" || key.endsWith("/.claude")) return true;
  const manifest = key === "." ? ".claude-plugin/plugin.json" : `${key}/.claude-plugin/plugin.json`;
  const r = await ctx.sandbox.probe(manifest, sample.file.root.real).catch(() => null);
  return r?.state === "ok";
}

async function checkBudget(ctx: CheckContext, skills: Skill[]): Promise<void> {
  if (!ctx.discovered) return; // the whole set must be in view
  const o = ruleOptions(ctx.config, "skill-listing-budget");
  const budget = o["budgetChars"] ?? SKILL_TRIGGER_DEFAULTS.budgetChars;
  const cap = o["maxDescChars"] ?? SKILL_TRIGGER_DEFAULTS.maxDescChars;
  const groups = new Map<string, Listed[]>();
  const add = (key: string | null, l: Listed): void => {
    if (key === null) return;
    const g = groups.get(key) ?? [];
    g.push(l);
    groups.set(key, g);
  };
  for (const s of skills) {
    if (!s.modelInvocable || inTestTree(s.doc.file.rel) || inTemplateFolder(s.doc.file.rel)) continue;
    add(listingOf(s.doc.file.rel, "skill"), { doc: s.doc, name: s.name, chars: s.name.length + Math.min(s.listed.length, cap) + 4, line: s.line });
  }
  for (const d of ctx.docs) {
    if (d.kind.kind !== "claude-command") continue;
    const c = skillOf(d);
    if (!c.modelInvocable) continue;
    const parts = d.file.rel.split("/");
    const name = parts.slice(parts.lastIndexOf("commands") + 1).join(":").replace(/\.md$/i, "");
    add(listingOf(d.file.rel, "claude-command"), { doc: d, name, chars: name.length + Math.min(c.listed.length, cap) + 4, line: c.line });
  }
  // A copy of the same set (a worktree or a mirror checked into the repo) is reported once.
  const seen = new Set<string>();
  for (const [key, items] of groups) {
    const names = items.map((x) => x.name).sort().join("\0");
    if (seen.has(names)) continue;
    seen.add(names);
    const total = items.reduce((t, x) => t + x.chars, 0);
    if (total <= budget || !(await installedTogether(ctx, key, items[0]!.doc))) continue;
    items.sort((a, b) => b.chars - a.chars || (a.doc.path < b.doc.path ? -1 : 1));
    const top = items[0]!;
    const biggest = items.slice(0, 3).map((x) => `${x.name} (${n(x.chars)})`).join(", ");
    const where = key === "." ? "the root" : dp(key);
    ctx.report(top.doc.path, {
      severity: "info",
      rule: "skill-listing-budget",
      message: `The ${n(items.length)} skills and commands in ${where} list ${n(total)} characters of names and descriptions. Claude Code keeps 1% of the context window for the whole skill listing, shared with personal and other plugin skills: ${o["budgetChars"] === undefined ? `about ${n(budget)} characters with a 200k window (a 1M window gets five times that)` : `${n(budget)} characters by the budget this project sets in .asitisrc.json`}. Over it, Claude Code keeps every name but drops the descriptions of the least-used skills, so Claude stops picking those on its own. Longest: ${biggest}. Shorten descriptions, or set disable-model-invocation: true on skills you only run by hand`,
      line: top.line,
      fingerprintText: `listing ${key}`,
    });
  }
}

function checkShadowed(ctx: CheckContext, skills: Skill[]): void {
  // .claude folder -> skill names in it (folder name and frontmatter name) -> the skill.
  const byFolder = new Map<string, Map<string, Skill>>();
  for (const s of skills) {
    const key = listingOf(s.doc.file.rel, "skill");
    if (key === null || !(key === ".claude" || key.endsWith("/.claude"))) continue;
    const m = byFolder.get(key) ?? new Map<string, Skill>();
    for (const nm of [s.dir, s.name]) if (!m.has(normName(nm))) m.set(normName(nm), s);
    byFolder.set(key, m);
  }
  for (const d of ctx.docs) {
    if (d.kind.kind !== "claude-command") continue;
    const parts = d.file.rel.split("/");
    const k = parts.lastIndexOf("commands");
    // Only a file directly in commands/: one in a subfolder is /folder:name, which no skill name can be.
    if (k < 1 || parts[k - 1] !== ".claude" || k !== parts.length - 2) continue;
    const name = parts[k + 1]!.replace(/\.md$/i, "");
    const skill = byFolder.get(parts.slice(0, k).join("/"))?.get(normName(name));
    if (!skill) continue;
    const issue: Issue = {
      severity: "warning",
      rule: "skill-shadowed-command",
      message: `The skill in ${dp(findingPath(skill.doc))} is also named ${q(name, 60)}, and Claude Code runs the skill when two share a name, so /${name} never runs this command. Rename the command, or delete it if the skill replaced it`,
      line: 1,
    };
    ctx.report(d.path, issue);
  }
}

export const SKILL_TRIGGERS_CHECK: ProjectCheck = {
  id: "skill-triggers",
  ready: true,
  async run(ctx) {
    const skills = ctx.docs.filter((d) => d.kind.kind === "skill" && d.frontmatter.present).map(skillOf);
    if (!skills.length) return;
    checkDescriptions(ctx, skills);
    checkOverlap(ctx, skills);
    await checkBudget(ctx, skills);
    checkShadowed(ctx, skills);
  },
};
