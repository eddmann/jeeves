/**
 * Format skills for inclusion in the system prompt.
 */

import type { Skill } from "./loader";

/**
 * Build the skills section of the system prompt.
 * Lists available skills so the agent knows to read their SKILL.md when relevant.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const skillEntries = skills
    .map(
      (s) =>
        `<skill>
  <name>${s.name}</name>
  <description>${s.description}</description>
  <location>${s.filePath}</location>
</skill>`,
    )
    .join("\n");

  return `## Skills

When a task matches a skill's description, use the read tool to load its SKILL.md for detailed instructions.

<available_skills>
${skillEntries}
</available_skills>`;
}
