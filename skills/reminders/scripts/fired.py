#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Mark a reminder as fired. For recurring reminders, updates due to next occurrence.

Input: {"reminder_id": 1}
OR pass reminder_id as argv[1]
"""
import json, sys, sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB = Path(__file__).parent.parent / "db" / "reminders.sqlite"
db = sqlite3.connect(str(DB))
db.row_factory = sqlite3.Row

if len(sys.argv) > 1:
    rid = int(sys.argv[1])
else:
    data = json.load(sys.stdin)
    rid = data["reminder_id"]

row = db.execute("SELECT * FROM reminders WHERE id = ?", [rid]).fetchone()
if not row:
    print(json.dumps({"error": "not found"}))
    sys.exit(1)

now = datetime.now(timezone.utc).isoformat()

if row["recurring"]:
    # Calculate next due time
    due = datetime.fromisoformat(row["due"].replace("Z", "+00:00"))
    recurring = row["recurring"]

    if recurring == "daily":
        next_due = due + timedelta(days=1)
    elif recurring == "weekly":
        next_due = due + timedelta(weeks=1)
    else:
        # For cron expressions, the cron system handles scheduling
        # Just update the fired_at timestamp
        next_due = due + timedelta(days=1)  # fallback

    db.execute("UPDATE reminders SET due = ?, fired_at = ? WHERE id = ?",
               [next_due.isoformat(), now, rid])
    db.commit()
    print(json.dumps({"ok": True, "id": rid, "status": "recurring", "next_due": next_due.isoformat()}))
else:
    db.execute("UPDATE reminders SET status = 'fired', fired_at = ? WHERE id = ?", [now, rid])
    db.commit()
    print(json.dumps({"ok": True, "id": rid, "status": "fired"}))
