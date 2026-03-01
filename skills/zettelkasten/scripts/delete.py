# /// script
# requires-python = ">=3.11"
# dependencies = ["sqlite-vec>=0.1"]
# ///
"""Delete a Zettel note and its tags/links."""
import sys, json, sqlite3, sqlite_vec
from pathlib import Path

db_path = str(Path(__file__).parent.parent / "db" / "zettel.sqlite")
db = sqlite3.connect(db_path)
db.enable_load_extension(True)
sqlite_vec.load(db)

note_id = sys.argv[1] if len(sys.argv) > 1 else ""
if not note_id:
    print(json.dumps({"error": "Provide a note ID"}))
    sys.exit(1)

if db.execute("SELECT COUNT(*) FROM notes WHERE id = ?", [note_id]).fetchone()[0] == 0:
    print(json.dumps({"error": f"Note {note_id} not found"}))
    sys.exit(1)

# Cascade deletes handled by FK, but be explicit
db.execute("DELETE FROM tags WHERE note_id = ?", [note_id])
db.execute("DELETE FROM links WHERE from_id = ? OR to_id = ?", [note_id, note_id])
db.execute("DELETE FROM notes_vec WHERE note_id = ?", [note_id])
db.execute("DELETE FROM notes WHERE id = ?", [note_id])
db.commit()

print(json.dumps({"ok": True, "deleted": note_id}))
