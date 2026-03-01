---
name: zettelkasten
description: Personal knowledge base using the Zettelkasten method. Use when the user wants to save a note, look up knowledge, connect ideas, "what do I know about X", "save this", "note this down", or asks about their notes/knowledge base.
---

# Zettelkasten Skill

A personal knowledge base stored in SQLite. Atomic notes, linked together, searchable by keyword and tag.

All scripts live in `workspace/skills/zettelkasten/scripts/` and use `uv run`.
Database lives at `workspace/skills/zettelkasten/db/zettel.sqlite`.

## First Run

Initialize the database (only needed once):

```bash
uv run workspace/skills/zettelkasten/scripts/init_db.py
```

## Create a Note

Pipe JSON to stdin. Tags and links are optional.

```bash
echo '{"title": "Prompt injection has no solution", "body": "LLMs cannot distinguish operator instructions from instructions embedded in content.", "source": "Blog post", "tags": ["ai-safety", "llm"], "links": ["20260213170000"]}' | uv run workspace/skills/zettelkasten/scripts/create.py
```

Returns: `{"id": "20260213180000", "title": "...", "tags": [...], "links": [...]}`

### Writing good Zettel notes

- **Atomic:** one idea per note
- **Own words:** restate the idea, don't just quote
- **Context:** explain why it matters
- **Links:** connect to existing notes where relevant
- **Tags:** use lowercase, hyphenated tags (e.g. `ai-safety`, `event-sourcing`)

## Search Notes

```bash
uv run workspace/skills/zettelkasten/scripts/search.py "prompt injection" fts    # full-text search
uv run workspace/skills/zettelkasten/scripts/search.py "ai-safety" tag            # by tag
uv run workspace/skills/zettelkasten/scripts/search.py "20260213180000" id         # by ID (full detail + links)
uv run workspace/skills/zettelkasten/scripts/search.py "10" all                    # recent N notes
```

## Update a Note

```bash
echo '{"id": "20260213180000", "title": "New title", "body": "Updated body", "tags": ["new-tag"]}' | uv run workspace/skills/zettelkasten/scripts/update.py
```

## Delete a Note

```bash
uv run workspace/skills/zettelkasten/scripts/delete.py 20260213180000
```

## Links

### List links for a note

```bash
uv run workspace/skills/zettelkasten/scripts/link.py list 20260213180000
```

### Add a link

```bash
echo '{"from": "20260213180000", "to": "20260213190000", "context": "Both discuss LLM safety"}' | uv run workspace/skills/zettelkasten/scripts/link.py add
```

### Remove a link

```bash
echo '{"from": "20260213180000", "to": "20260213190000"}' | uv run workspace/skills/zettelkasten/scripts/link.py remove
```

### Full graph

```bash
uv run workspace/skills/zettelkasten/scripts/link.py graph
```

## Tags

```bash
uv run workspace/skills/zettelkasten/scripts/tags.py list                          # all tags with counts
uv run workspace/skills/zettelkasten/scripts/tags.py add 20260213180000 new-tag    # add tag
uv run workspace/skills/zettelkasten/scripts/tags.py remove 20260213180000 old-tag # remove tag
```

## Embeddings

Generate embeddings for all notes (or re-embed a specific note). Uses OpenAI `text-embedding-3-small` (1536 dimensions). Requires `OPENAI_API_KEY` env var.

```bash
uv run workspace/skills/zettelkasten/scripts/embed.py                # all unembedded notes
uv run workspace/skills/zettelkasten/scripts/embed.py 20260213180000 # specific note
```

Run this after creating new notes to keep semantic search current.

## Semantic Search

Search by meaning using `sqlite-vec` for native vector similarity (cosine distance). No numpy, no Python maths — all computed in C inside SQLite. Requires embeddings to exist.

```bash
uv run workspace/skills/zettelkasten/scripts/semantic_search.py "security risks of AI tool access"
```

Returns notes ranked by cosine similarity to the query.

## Stats

```bash
uv run workspace/skills/zettelkasten/scripts/stats.py
```

## Weeknotes Compilation

Compile notes from the past week, clustered by theme with connections:

```bash
uv run workspace/skills/zettelkasten/scripts/weekly.py        # last 7 days
uv run workspace/skills/zettelkasten/scripts/weekly.py 14     # last 14 days
```

Returns all notes, tag clusters (sorted by size, filtered for relevance), and connections between notes. Use this to draft weeknotes:

1. Run `weekly.py` to get the raw material
2. Identify 3-5 themes from the tag clusters and connections
3. For each theme, synthesise the linked notes into a narrative section
4. Include source attributions and links
5. Present as a draft with headings the user can edit

**Trigger phrases:** "compile my weeknotes", "weeknotes time", "what have I noted this week"

## Workflow

When the user shares knowledge (from conversation, articles, videos, etc.):

1. **Extract** atomic ideas — one note per concept
2. **Search** existing notes for related ideas (semantic + keyword)
3. **Create** notes with appropriate tags
4. **Link** new notes to related existing notes
5. **Embed** new notes for semantic search
6. **Report** what was saved and how it connects

When the user asks "what do I know about X":

1. **Search** by keyword (FTS) and tag
2. **Follow links** from matching notes to find related knowledge
3. **Synthesise** an answer drawing from the connected notes
4. **Cite** note IDs so the user can drill deeper
