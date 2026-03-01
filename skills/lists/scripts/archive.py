# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Archive a list."""
import sys, json, sqlite3
from pathlib import Path

db_path = str(Path(__file__).parent.parent / "db" / "lists.sqlite")
db = sqlite3.connect(db_path)

list_id = int(sys.argv[1])
lst = db.execute("SELECT name FROM lists WHERE id = ?", [list_id]).fetchone()
if not lst:
    print(json.dumps({"error": f"List {list_id} not found"}))
    sys.exit(1)

db.execute("UPDATE lists SET status = 'archived' WHERE id = ?", [list_id])
db.commit()
db.close()

print(json.dumps({"ok": True, "id": list_id, "name": lst[0], "status": "archived"}))
