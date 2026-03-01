# /// script
# requires-python = ">=3.11"
# dependencies = ["sqlite-utils>=3.36"]
# ///
"""Update an existing Zettel note."""
import sys, json
from pathlib import Path
from datetime import datetime, timezone
import sqlite_utils

db_path = str(Path(__file__).parent.parent / "db" / "zettel.sqlite")
db = sqlite_utils.Database(db_path)

# Read JSON from stdin
data = json.loads(sys.stdin.read())
note_id = data["id"]

existing = db["notes"].get(note_id)
if not existing:
    print(json.dumps({"error": f"Note {note_id} not found"}))
    sys.exit(1)

updates = {"updated": datetime.now(timezone.utc).isoformat()}
if "title" in data:
    updates["title"] = data["title"]
if "body" in data:
    updates["body"] = data["body"]
if "source" in data:
    updates["source"] = data["source"]

db["notes"].update(note_id, updates)

# Replace tags if provided
if "tags" in data:
    db.execute("DELETE FROM tags WHERE note_id = ?", [note_id])
    for tag in data["tags"]:
        db["tags"].insert({"note_id": note_id, "tag": tag.lower().strip()}, ignore=True)

print(json.dumps({"ok": True, "id": note_id, "updated_fields": list(updates.keys())}))
