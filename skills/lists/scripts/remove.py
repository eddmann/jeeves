# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Remove an item from a list."""
import sys, json, sqlite3
from pathlib import Path

db_path = str(Path(__file__).parent.parent / "db" / "lists.sqlite")
db = sqlite3.connect(db_path)

item_id = int(sys.argv[1])
row = db.execute("SELECT text, list_id FROM list_items WHERE id = ?", [item_id]).fetchone()
if not row:
    print(json.dumps({"error": f"Item {item_id} not found"}))
    sys.exit(1)

db.execute("DELETE FROM list_items WHERE id = ?", [item_id])
db.commit()
db.close()

print(json.dumps({"ok": True, "id": item_id, "text": row[0]}))
