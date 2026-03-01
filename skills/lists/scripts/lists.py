# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Show all active lists."""
import sys, json, sqlite3
from pathlib import Path

db_path = str(Path(__file__).parent.parent / "db" / "lists.sqlite")
db = sqlite3.connect(db_path)

show_all = len(sys.argv) > 1 and sys.argv[1] == "all"
if show_all:
    rows = db.execute("SELECT id, name, due, status, created FROM lists ORDER BY due, created").fetchall()
else:
    rows = db.execute("SELECT id, name, due, status, created FROM lists WHERE status = 'active' ORDER BY due, created").fetchall()

results = []
for r in rows:
    item_count = db.execute("SELECT COUNT(*) FROM list_items WHERE list_id = ?", [r[0]]).fetchone()[0]
    unchecked = db.execute("SELECT COUNT(*) FROM list_items WHERE list_id = ? AND checked = 0", [r[0]]).fetchone()[0]
    results.append({
        "id": r[0], "name": r[1], "due": r[2], "status": r[3],
        "total_items": item_count, "unchecked": unchecked
    })

db.close()
print(json.dumps(results, indent=2))
