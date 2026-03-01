# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Show a list and its items."""
import sys, json, sqlite3
from pathlib import Path

db_path = str(Path(__file__).parent.parent / "db" / "lists.sqlite")
db = sqlite3.connect(db_path)

list_id = int(sys.argv[1]) if len(sys.argv) > 1 else None

if not list_id:
    # Try to find by name
    name = sys.argv[1] if len(sys.argv) > 1 else ""
    row = db.execute("SELECT id FROM lists WHERE name LIKE ? AND status = 'active'", [f"%{name}%"]).fetchone()
    if row:
        list_id = row[0]
    else:
        print(json.dumps({"error": "List not found"}))
        sys.exit(1)

lst = db.execute("SELECT id, name, due, notes, status, created FROM lists WHERE id = ?", [list_id]).fetchone()
if not lst:
    print(json.dumps({"error": f"List {list_id} not found"}))
    sys.exit(1)

items = db.execute("""
    SELECT id, text, checked, priority, created
    FROM list_items WHERE list_id = ?
    ORDER BY checked, priority DESC, created
""", [list_id]).fetchall()

db.close()

result = {
    "id": lst[0], "name": lst[1], "due": lst[2], "notes": lst[3],
    "status": lst[4], "created": lst[5],
    "total": len(items),
    "unchecked": sum(1 for i in items if not i[2]),
    "items": [{"id": i[0], "text": i[1], "checked": bool(i[2]), "priority": i[3]} for i in items]
}

print(json.dumps(result, indent=2))
