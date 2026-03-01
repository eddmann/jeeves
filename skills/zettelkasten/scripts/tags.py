# /// script
# requires-python = ">=3.11"
# dependencies = ["sqlite-utils>=3.36"]
# ///
"""List all tags or manage tags on a note."""
import sys, json
from pathlib import Path
import sqlite_utils

db_path = str(Path(__file__).parent.parent / "db" / "zettel.sqlite")
db = sqlite_utils.Database(db_path)

action = sys.argv[1] if len(sys.argv) > 1 else "list"

if action == "list":
    rows = db.execute("""
        SELECT tag, COUNT(*) as count
        FROM tags
        GROUP BY tag
        ORDER BY count DESC
    """).fetchall()
    print(json.dumps([{"tag": r[0], "count": r[1]} for r in rows], indent=2))

elif action == "add":
    note_id = sys.argv[2]
    tag = sys.argv[3].lower().strip()
    db["tags"].insert({"note_id": note_id, "tag": tag}, ignore=True)
    print(json.dumps({"ok": True, "note_id": note_id, "tag": tag}))

elif action == "remove":
    note_id = sys.argv[2]
    tag = sys.argv[3].lower().strip()
    db.execute("DELETE FROM tags WHERE note_id = ? AND tag = ?", [note_id, tag])
    print(json.dumps({"ok": True, "note_id": note_id, "tag": tag}))
