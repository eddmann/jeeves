# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Check/uncheck items on a list."""
import sys, json, sqlite3
from pathlib import Path

db_path = str(Path(__file__).parent.parent / "db" / "lists.sqlite")
db = sqlite3.connect(db_path)

# Accept item IDs as args or JSON
if len(sys.argv) > 1:
    item_ids = [int(x) for x in sys.argv[1:]]
    uncheck = False
else:
    data = json.loads(sys.stdin.read())
    item_ids = data.get("ids", [data.get("id")])
    uncheck = data.get("uncheck", False)

checked = []
for item_id in item_ids:
    new_val = 0 if uncheck else 1
    db.execute("UPDATE list_items SET checked = ? WHERE id = ?", [new_val, item_id])
    row = db.execute("SELECT text FROM list_items WHERE id = ?", [item_id]).fetchone()
    if row:
        checked.append({"id": item_id, "text": row[0], "checked": new_val})

db.commit()
db.close()

print(json.dumps({"ok": True, "items": checked}))
