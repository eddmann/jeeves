# /// script
# requires-python = ">=3.11"
# dependencies = ["sqlite-vec>=0.1"]
# ///
"""Show Zettelkasten statistics."""
import json, sqlite3, sqlite_vec
from pathlib import Path

db_path = str(Path(__file__).parent.parent / "db" / "zettel.sqlite")
db = sqlite3.connect(db_path)
db.enable_load_extension(True)
sqlite_vec.load(db)

notes = db.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
tags = db.execute("SELECT COUNT(DISTINCT tag) FROM tags").fetchone()[0]
links = db.execute("SELECT COUNT(*) FROM links").fetchone()[0]
embeddings = db.execute("SELECT COUNT(*) FROM notes_vec").fetchone()[0]

# Most connected notes
top = db.execute("""
    SELECT n.id, n.title, COUNT(DISTINCT l1.to_id) + COUNT(DISTINCT l2.from_id) as connections
    FROM notes n
    LEFT JOIN links l1 ON l1.from_id = n.id
    LEFT JOIN links l2 ON l2.to_id = n.id
    GROUP BY n.id
    ORDER BY connections DESC
    LIMIT 5
""").fetchall()

# Recent notes
recent = db.execute("""
    SELECT n.id, n.title, n.created, GROUP_CONCAT(t.tag, ', ') as tags
    FROM notes n LEFT JOIN tags t ON t.note_id = n.id
    GROUP BY n.id ORDER BY n.created DESC LIMIT 5
""").fetchall()

db.close()

print(json.dumps({
    "total_notes": notes,
    "unique_tags": tags,
    "total_links": links,
    "notes_with_embeddings": embeddings,
    "most_connected": [{"id": r[0], "title": r[1], "connections": r[2]} for r in top],
    "recent": [{"id": r[0], "title": r[1], "created": r[2], "tags": r[3]} for r in recent],
}, indent=2))
