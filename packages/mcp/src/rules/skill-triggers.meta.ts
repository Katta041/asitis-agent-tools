// Skill description quality (0.4.0). checks/skill-triggers.ts emits these, together with the
// reserved skill-listing-budget and skill-shadowed-command in spec.meta.ts. Sources read
// 15 November 2026:
// - Skill authoring best practices, "Writing effective descriptions": "Always write in third
//   person. The description is injected into the system prompt, and inconsistent point-of-view can
//   cause discovery problems." Good: "Processes Excel files and generates reports"; avoid: "I can
//   help you process Excel files" and "You can use this to process Excel files". Vague examples to
//   avoid: "Helps with documents", "Processes data", "Does stuff with files".
// - Same page: "Claude uses it to choose the right Skill from potentially 100+ available Skills."

import { rule, type RuleMeta } from "./types.js";

const BEST_PRACTICES = "https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices";

export const SKILL_TRIGGER_RULES: RuleMeta[] = [
  rule({ id: "skill-description-vague", category: "format", defaultSeverity: "note", summary: "Skill description is a placeholder or says nothing specific about what the skill does", why: "Claude picks a skill from its description alone. Anthropic's skill guide names \"Helps with documents\" and \"Processes data\" as descriptions to avoid: they give Claude no key terms to match a request against, so the skill rarely triggers.", source: BEST_PRACTICES }),
  rule({ id: "skill-description-person", category: "format", defaultSeverity: "note", summary: "Skill description speaks as the skill (\"I can help you\") instead of in third person", why: "The description is injected into the system prompt, and Anthropic's skill guide says to always write it in third person because a mixed point of view can cause discovery problems. Descriptions addressed to Claude (\"Use when you need...\") are fine and not reported.", source: BEST_PRACTICES }),
  rule({ id: "skill-description-overlap", category: "format", defaultSeverity: "note", scope: "project", summary: "Two skills that load together have descriptions that share most of their key words", why: "Claude chooses one skill per request by comparing descriptions. When two say nearly the same thing, it can pick either, so one of them triggers at random or never. A note from 55% shared key words, a warning from 80%.", source: BEST_PRACTICES, severityVaries: "a note; a warning when the descriptions are nearly the same (80% or more shared key words)" }),
];
