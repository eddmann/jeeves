---
name: zettelkasten
description: Manage a Zettelkasten slip-box of atomic, interlinked notes. Use when the user shares an idea, wants to capture a thought, asks about their notes, says "note this", "add to my zettelkasten", "what notes do I have on X", "link these ideas", "refine my notes", or wants to build a personal knowledge base.
---

# Zettelkasten Notes

Manage a personal knowledge base using the Zettelkasten method: atomic notes, each capturing one idea, linked together into a growing knowledge graph. Notes live as Markdown files in `workspace/zettelkasten/`.

You are an AI assistant — leverage that. Don't just store notes: auto-tag, find connections the user wouldn't spot, suggest links, refine rough thoughts into polished notes, and synthesize hub notes across clusters of ideas.

## Setup

Initialize the zettelkasten directory on first use:

```bash
mkdir -p zettelkasten
```

No credentials or dependencies required — notes are local Markdown files.

## Note Format

Each note is a Markdown file named `{YYYYMMDDHHMMSS}.md` (timestamp ID).

```markdown
---
id: "20260215143022"
title: "Atomic notes force clarity of thought"
type: permanent
tags: [writing, thinking, zettelkasten]
links: ["20260215142000", "20260214091500"]
source: ""
created: "2026-02-15T14:30:22"
---

Writing one idea per note forces you to actually understand it. If you can't
express the idea in a few sentences without hedging, you don't understand it yet.

This is why Zettelkasten works as a thinking tool, not just storage — the
constraint of atomicity is a forcing function for comprehension.

## Links

- [[20260215142000]] The value of constraints in creative work
- [[20260214091500]] Understanding vs. collecting information
```

### Note Types

| Type          | Purpose                                              | Lifecycle                   |
| ------------- | ---------------------------------------------------- | --------------------------- |
| `fleeting`    | Raw capture — quick thoughts, unprocessed ideas      | Refine into permanent or discard |
| `literature`  | Notes from a source — articles, books, conversations | Rewrite as permanent notes  |
| `permanent`   | Refined atomic ideas in the user's own words         | Core of the slip-box        |
| `hub`         | Structure note — index of related permanent notes    | Entry point into a topic    |

### Frontmatter Fields

| Field     | Required | Description                                       |
| --------- | -------- | ------------------------------------------------- |
| `id`      | yes      | Timestamp ID matching filename (YYYYMMDDHHMMSS)   |
| `title`   | yes      | Concise title capturing the single idea           |
| `type`    | yes      | `fleeting`, `literature`, `permanent`, or `hub`   |
| `tags`    | yes      | List of lowercase tags for categorization         |
| `links`   | yes      | List of IDs this note connects to (can be empty)  |
| `source`  | no       | Source URL/reference for literature notes          |
| `created` | yes      | ISO 8601 timestamp                                |

## Operations

### Create a Note

Generate a timestamp ID and write the file. **Always search for related existing notes first** (see Search below) and include relevant links.

```bash
uv run - <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
import yaml
from datetime import datetime
from pathlib import Path

zettel_dir = Path("zettelkasten")
zettel_dir.mkdir(exist_ok=True)

now = datetime.now()
note_id = now.strftime("%Y%m%d%H%M%S")

note = {
    "id": note_id,
    "title": "YOUR TITLE HERE",
    "type": "permanent",
    "tags": ["tag1", "tag2"],
    "links": [],
    "source": "",
    "created": now.isoformat(timespec="seconds"),
}

content = """YOUR NOTE CONTENT HERE

## Links
"""

filepath = zettel_dir / f"{note_id}.md"
frontmatter = yaml.dump(note, default_flow_style=False, sort_keys=False).strip()
filepath.write_text(f"---\n{frontmatter}\n---\n\n{content}\n")

print(f"Created: {filepath} — {note['title']}")
EOF
```

### Search Notes

Full-text and tag search across all notes. Returns matching note IDs, titles, and snippets.

```bash
uv run - "SEARCH_QUERY" <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
import sys, yaml, re
from pathlib import Path

query = sys.argv[1].lower()
zettel_dir = Path("zettelkasten")

if not zettel_dir.exists():
    print("No zettelkasten directory found.")
    sys.exit(0)

results = []
for f in sorted(zettel_dir.glob("*.md"), reverse=True):
    text = f.read_text()
    parts = text.split("---", 2)
    if len(parts) < 3:
        continue
    try:
        meta = yaml.safe_load(parts[1])
    except yaml.YAMLError:
        continue
    body = parts[2].strip()

    # Search in title, tags, and body
    title = meta.get("title", "")
    tags = meta.get("tags", [])
    tag_str = " ".join(tags) if tags else ""
    searchable = f"{title} {tag_str} {body}".lower()

    if query in searchable:
        snippet = ""
        for line in body.split("\n"):
            if query in line.lower():
                snippet = line.strip()[:120]
                break
        results.append((meta.get("id", f.stem), title, meta.get("type", "?"), tags, snippet))

if not results:
    print(f"No notes matching '{sys.argv[1]}'")
else:
    print(f"Found {len(results)} note(s) matching '{sys.argv[1]}':\n")
    for nid, title, ntype, tags, snippet in results:
        tag_str = ", ".join(tags) if tags else ""
        print(f"  [{nid}] {title} ({ntype}) [{tag_str}]")
        if snippet:
            print(f"           {snippet}")
EOF
```

### List Notes

List notes filtered by type, tag, or recent.

```bash
uv run - <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
import yaml
from pathlib import Path

zettel_dir = Path("zettelkasten")
if not zettel_dir.exists():
    print("No zettelkasten directory found.")
    exit(0)

# Filters — adjust as needed
filter_type = None      # e.g., "fleeting", "permanent", "hub"
filter_tag = None       # e.g., "thinking"
limit = 20

notes = []
for f in sorted(zettel_dir.glob("*.md"), reverse=True):
    text = f.read_text()
    parts = text.split("---", 2)
    if len(parts) < 3:
        continue
    try:
        meta = yaml.safe_load(parts[1])
    except yaml.YAMLError:
        continue

    if filter_type and meta.get("type") != filter_type:
        continue
    if filter_tag and filter_tag not in (meta.get("tags") or []):
        continue

    notes.append(meta)
    if len(notes) >= limit:
        break

if not notes:
    print("No notes found.")
else:
    print(f"{'ID':<16} {'Type':<12} {'Title':<50} Tags")
    print("-" * 100)
    for n in notes:
        tags = ", ".join(n.get("tags", []))
        print(f"{n.get('id', '?'):<16} {n.get('type', '?'):<12} {n.get('title', '?')[:50]:<50} {tags}")
EOF
```

### Show Links (Forward + Backlinks)

Given a note ID, show what it links to and what links back to it.

```bash
uv run - "NOTE_ID_HERE" <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
import sys, yaml
from pathlib import Path

target_id = sys.argv[1]
zettel_dir = Path("zettelkasten")

# Load all notes
index = {}
for f in sorted(zettel_dir.glob("*.md")):
    text = f.read_text()
    parts = text.split("---", 2)
    if len(parts) < 3:
        continue
    try:
        meta = yaml.safe_load(parts[1])
    except yaml.YAMLError:
        continue
    nid = meta.get("id", f.stem)
    index[nid] = meta

if target_id not in index:
    print(f"Note {target_id} not found.")
    exit(1)

note = index[target_id]
print(f"Note: [{target_id}] {note.get('title', '?')}\n")

# Forward links
forward = note.get("links", [])
if forward:
    print("Links to:")
    for lid in forward:
        linked = index.get(str(lid), {})
        print(f"  → [{lid}] {linked.get('title', '(unknown)')}")
else:
    print("Links to: (none)")

# Backlinks
backlinks = []
for nid, meta in index.items():
    if nid == target_id:
        continue
    if target_id in [str(l) for l in meta.get("links", [])]:
        backlinks.append((nid, meta.get("title", "?")))

print()
if backlinks:
    print("Linked from:")
    for nid, title in backlinks:
        print(f"  ← [{nid}] {title}")
else:
    print("Linked from: (none — consider connecting this note)")
EOF
```

### Find Orphans and Stats

Show zettelkasten health: orphan notes, tag distribution, type counts.

```bash
uv run - <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
import yaml
from collections import Counter
from pathlib import Path

zettel_dir = Path("zettelkasten")
if not zettel_dir.exists():
    print("No zettelkasten directory found.")
    exit(0)

notes = {}
all_tags = Counter()
type_counts = Counter()
all_linked = set()

for f in sorted(zettel_dir.glob("*.md")):
    text = f.read_text()
    parts = text.split("---", 2)
    if len(parts) < 3:
        continue
    try:
        meta = yaml.safe_load(parts[1])
    except yaml.YAMLError:
        continue
    nid = meta.get("id", f.stem)
    notes[nid] = meta
    type_counts[meta.get("type", "unknown")] += 1
    for t in meta.get("tags", []):
        all_tags[t] += 1
    for lid in meta.get("links", []):
        all_linked.add(str(lid))

# Find orphans (no links to or from)
linked_from = set()
for meta in notes.values():
    for lid in meta.get("links", []):
        linked_from.add(str(lid))

has_connection = set()
for nid, meta in notes.items():
    if meta.get("links") or nid in linked_from:
        has_connection.add(nid)

orphans = [(nid, notes[nid].get("title", "?")) for nid in notes if nid not in has_connection]

# Print stats
print(f"Total notes: {len(notes)}\n")
print("By type:")
for t, c in type_counts.most_common():
    print(f"  {t}: {c}")

print(f"\nTop tags:")
for t, c in all_tags.most_common(10):
    print(f"  {t}: {c}")

if orphans:
    print(f"\nOrphan notes ({len(orphans)} — no connections):")
    for nid, title in orphans:
        print(f"  [{nid}] {title}")
else:
    print("\nNo orphan notes — all notes are connected.")

# Fleeting notes pending refinement
fleeting = [(nid, notes[nid].get("title", "?")) for nid, m in notes.items() if m.get("type") == "fleeting"]
if fleeting:
    print(f"\nFleeting notes to refine ({len(fleeting)}):")
    for nid, title in fleeting:
        print(f"  [{nid}] {title}")
EOF
```

## AI Workflows

These are the key ways you should leverage being an AI when working with the zettelkasten.

### Capturing Ideas

When the user shares a thought or idea casually:

1. Create a `fleeting` note capturing the raw idea
2. Search existing notes for related topics
3. If related notes exist, add links and tell the user what you connected it to
4. Suggest tags based on the content and existing tag vocabulary

Don't over-polish fleeting notes — capture the thought quickly and accurately.

### Literature Notes

When the user shares a URL, article, book passage, or references a conversation:

1. Use `web_fetch` to read the source if it's a URL
2. Create a `literature` note summarizing the key ideas **in the user's context** — not a generic summary, but what's relevant to their existing notes and interests
3. Set the `source` field to the URL or reference
4. Search existing notes and link to related permanent notes
5. Suggest which ideas could become standalone permanent notes

### Refining Notes

When asked to refine, or when you notice accumulated fleeting notes:

1. List fleeting notes using the list operation
2. For each fleeting note, rewrite it as a `permanent` note:
   - One atomic idea per note (split if the fleeting note has multiple ideas)
   - Written in the user's own voice (match their style from other notes)
   - Clear, concise, self-contained — should make sense without context
3. Link the new permanent note to related existing notes
4. After refinement, the fleeting note can be deleted or kept as-is

### Creating Hub Notes

When a topic accumulates several permanent notes:

1. Identify clusters of related notes (by shared tags, links, or content)
2. Create a `hub` note that:
   - Provides a brief overview of the topic
   - Lists and links to all relevant permanent notes with one-line descriptions
   - Suggests a reading order or conceptual structure
3. Hub notes are entry points — they help navigate the zettelkasten

### Finding Connections

Periodically, or when the user asks "what connects to X":

1. Run the orphan/stats script to find disconnected notes
2. Search for thematic overlaps between unlinked notes
3. Suggest new links with a brief explanation of **why** these ideas connect
4. Look for surprising cross-domain connections — this is where AI adds the most value

### Synthesizing Ideas

When the user asks for a summary or wants to "think through" a topic:

1. Gather all notes on the topic (via search and link traversal)
2. Follow link chains to pull in related ideas
3. Synthesize a coherent narrative from the atomic notes
4. Identify gaps — what questions remain unanswered in the zettelkasten?
5. Suggest new notes that would fill those gaps

## Examples

### Quick Capture from Conversation

User says: "I've been thinking that the best code reviews focus on intent, not style"

1. Search existing notes for "code review", "intent", "style"
2. Create fleeting note:

```yaml
title: "Code reviews should focus on intent not style"
type: fleeting
tags: [code-review, engineering-culture]
links: []  # or link to existing related notes
```

3. Tell user: "Noted. You have 2 related notes on engineering culture — want me to link them?"

### Refine a Fleeting Note

Read the fleeting note, rewrite as permanent:

```yaml
title: "Effective code review targets intent and design, not formatting"
type: permanent
tags: [code-review, engineering-culture, feedback]
links: ["20260210153000"]  # linked to "Feedback loops in software teams"
```

Body: A focused paragraph explaining **why** intent-focused review works better, written as a standalone idea.

### Hub Note

```yaml
title: "Engineering Culture"
type: hub
tags: [engineering-culture, hub]
links: ["20260215143022", "20260210153000", "20260208111500"]
```

Body: Brief topic overview + linked list of all related permanent notes with one-line summaries.

## Tips

- **Atomic means one idea**: if a note has "and" connecting two distinct thoughts, split it
- **Links are the value**: a note without links is just a file — always search for connections
- **Tags are loose, links are precise**: use tags for broad categories, links for specific conceptual connections
- **Don't hoard fleeting notes**: refine or discard them regularly
- **Prefer depth over breadth**: 20 well-linked permanent notes beat 200 orphaned fleeting notes
