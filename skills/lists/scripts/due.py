# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Check for lists with upcoming due dates. For cron reminders."""
import sys, json, sqlite3
from pathlib import Path
from datetime import datetime, timezone, timedelta

db_path = str(Path(__file__).parent.parent / "db" / "lists.sqlite")
db = sqlite3.connect(db_path)

now = datetime.now(timezone.utc)
today = now.strftime("%Y-%m-%d")
tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")

# Find active lists due today or tomorrow
rows = db.execute("""
    SELECT l.id, l.name, l.due, l.notes
    FROM lists l
    WHERE l.status = 'active' AND l.due != '' AND l.due <= ?
    ORDER BY l.due
""", [tomorrow]).fetchall()

due_lists = []
for r in rows:
    unchecked = db.execute("SELECT COUNT(*) FROM list_items WHERE list_id = ? AND checked = 0", [r[0]]).fetchone()[0]
    items = db.execute("SELECT text, checked FROM list_items WHERE list_id = ? ORDER BY checked, created", [r[0]]).fetchall()
    
    if r[2] < today:
        urgency = "overdue"
    elif r[2] == today:
        urgency = "today"
    else:
        urgency = "tomorrow"
    
    due_lists.append({
        "id": r[0], "name": r[1], "due": r[2], "notes": r[3],
        "urgency": urgency, "unchecked": unchecked,
        "items": [{"text": i[0], "checked": bool(i[1])} for i in items]
    })

db.close()
print(json.dumps(due_lists, indent=2))
