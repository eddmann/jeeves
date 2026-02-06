---
name: skill-creator
description: Create or update skills. Use when designing, structuring, or packaging new skills with SKILL.md files.
---

# Skill Creator

Create new skills by writing SKILL.md files to the workspace `skills/` directory.

## Skill Structure

```
skill-name/
├── SKILL.md (required)
└── references/ (optional)
```

## Creating a Skill

1. Choose a name: lowercase letters, digits, and hyphens only (max 64 chars)
2. Create directory: `workspace/skills/<skill-name>/`
3. Write `SKILL.md` with YAML frontmatter

### SKILL.md Format

```markdown
---
name: my-skill
description: What this skill does and when to use it
---

# My Skill

Instructions for using this skill...
```

### Frontmatter Fields

- `name` (required): Must match the directory name, lowercase `[a-z0-9-]`
- `description` (required): Clear description of what the skill does AND when to trigger it

### Guidelines

- Keep SKILL.md under 500 lines
- Be concise — the context window is shared
- Include examples over verbose explanations
- Only add information the agent doesn't already know
- Split large reference material into `references/*.md` files
- Don't create README.md, CHANGELOG.md, or other auxiliary files
