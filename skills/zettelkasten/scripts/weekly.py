# /// script
# requires-python = ">=3.11"
# dependencies = ["sqlite-utils>=3.36"]
# ///
"""Compile notes from the past week, clustered by tag for weeknotes drafting."""
import sys, json
from pathlib import Path
from datetime import datetime, timedelta, timezone
import sqlite_utils

db_path = str(Path(__file__).parent.parent / "db" / "zettel.sqlite")
db = sqlite_utils.Database(db_path)

# Optional: days back (default 7)
days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

# Get all notes from the period
rows = db.execute("""
    SELECT n.id, n.title, n.body, n.source, n.created,
           GROUP_CONCAT(t.tag, ', ') as tags
    FROM notes n
    LEFT JOIN tags t ON t.note_id = n.id
    WHERE n.created >= ?
    GROUP BY n.id
    ORDER BY n.created
""", [cutoff]).fetchall()

notes = []
tag_clusters = {}

for r in rows:
    note = {
        "id": r[0], "title": r[1], "body": r[2],
        "source": r[3], "created": r[4], "tags": r[5] or ""
    }
    notes.append(note)

    # Build tag clusters
    for tag in (r[5] or "").split(", "):
        tag = tag.strip()
        if tag:
            tag_clusters.setdefault(tag, []).append(note["id"])

# Get links between this week's notes
note_ids = [n["id"] for n in notes]
if note_ids:
    placeholders = ",".join("?" * len(note_ids))
    links = db.execute(f"""
        SELECT l.from_id, l.to_id, l.context, n1.title as from_title, n2.title as to_title
        FROM links l
        JOIN notes n1 ON n1.id = l.from_id
        JOIN notes n2 ON n2.id = l.to_id
        WHERE l.from_id IN ({placeholders}) OR l.to_id IN ({placeholders})
    """, note_ids + note_ids).fetchall()
else:
    links = []

# Sort clusters by size (biggest themes first)
sorted_clusters = sorted(tag_clusters.items(), key=lambda x: -len(x[1]))

# Remove small/generic tags that appear on nearly everything
total = len(notes)
themed_clusters = [(tag, ids) for tag, ids in sorted_clusters if len(ids) < total * 0.8]

output = {
    "period": f"Last {days} days",
    "total_notes": len(notes),
    "total_links": len(links),
    "notes": notes,
    "tag_clusters": {tag: ids for tag, ids in themed_clusters[:15]},
    "connections": [
        {"from": l[0], "to": l[1], "context": l[2],
         "from_title": l[3], "to_title": l[4]}
        for l in links
    ],
}

print(json.dumps(output, indent=2))
