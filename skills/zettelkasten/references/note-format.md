# Zettelkasten Note Format Reference

## File Naming

Notes are named by timestamp ID: `YYYYMMDDHHMMSS.md`

Example: `20260215143022.md` = February 15, 2026 at 14:30:22

The ID is generated at creation time and never changes. It serves as the unique identifier for linking.

## Frontmatter Schema

```yaml
---
id: "20260215143022"        # String, matches filename stem
title: "Short clear title"  # String, the single idea in a phrase
type: permanent              # Enum: fleeting | literature | permanent | hub
tags: [tag1, tag2]           # List of lowercase strings, kebab-case
links: ["20260215142000"]    # List of ID strings this note connects to
source: ""                   # String, URL or reference (literature notes)
created: "2026-02-15T14:30:22"  # ISO 8601
---
```

## Body Structure

### Permanent Note

```markdown
The core idea expressed in 1-3 concise paragraphs. Should be self-contained
and make sense without reading linked notes.

## Links

- [[20260215142000]] Brief reason this connection matters
- [[20260214091500]] Brief reason this connection matters
```

### Hub Note

```markdown
Brief overview of the topic area (2-3 sentences).

## Notes

- [[20260215143022]] One-line summary of this note's idea
- [[20260210153000]] One-line summary of this note's idea
- [[20260208111500]] One-line summary of this note's idea

## Open Questions

- What remains unexplored in this topic?
```

### Fleeting Note

```markdown
Raw thought or idea, captured quickly. No need for polish.
Can contain questions, fragments, or rough observations.
```

### Literature Note

```markdown
Key ideas from the source, rewritten in own words.
Focus on what's relevant to existing notes and interests.

**Source:** URL or reference

## Key Takeaways

1. First important idea
2. Second important idea

## Links

- [[20260215143022]] How this connects to existing knowledge
```

## Tag Conventions

- Lowercase, kebab-case: `machine-learning`, `code-review`
- Prefer existing tags over inventing new ones (check stats first)
- Use broad categories, not note-specific terms
- Hub notes include their topic tag plus `hub`

## Link Conventions

- Links in frontmatter `links` field are the canonical connections
- `## Links` section in body provides human-readable context for each link
- Links should be bidirectional when the connection is meaningful both ways
- Always explain **why** two notes connect, not just that they do
