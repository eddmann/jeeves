# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Create a new list."""
import sys, json, sqlite3
from pathlib import Path
from datetime import datetime, timezone

db_path = str(Path(__file__).parent.parent / "db" / "lists.sqlite")
db = sqlite3.connect(db_path)

data = json.loads(sys.stdin.read())
now = datetime.now(timezone.utc).isoformat()

db.execute("""
    INSERT INTO lists (name, due, notes, created)
    VALUES (?, ?, ?, ?)
""", [data["name"], data.get("due", ""), data.get("notes", ""), now])
db.commit()
list_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
db.close()

print(json.dumps({"id": list_id, "name": data["name"], "due": data.get("due", "")}))
