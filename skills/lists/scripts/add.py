# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Add items to a list."""
import sys, json, sqlite3
from pathlib import Path
from datetime import datetime, timezone

db_path = str(Path(__file__).parent.parent / "db" / "lists.sqlite")
db = sqlite3.connect(db_path)

data = json.loads(sys.stdin.read())
list_id = data["list_id"]
now = datetime.now(timezone.utc).isoformat()

# Support single item or multiple
items = data.get("items", [data.get("text", "")])
if isinstance(items, str):
    items = [items]

added = []
for item in items:
    if not item.strip():
        continue
    priority = data.get("priority", 0)
    db.execute("INSERT INTO list_items (list_id, text, priority, created) VALUES (?, ?, ?, ?)",
               [list_id, item.strip(), priority, now])
    item_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    added.append({"id": item_id, "text": item.strip()})

db.commit()
db.close()

print(json.dumps({"ok": True, "list_id": list_id, "added": added}))
