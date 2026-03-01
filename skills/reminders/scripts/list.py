#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""List reminders. Optional filters via argv.

Usage:
  list.py              — all pending
  list.py all          — everything
  list.py history      — fired/cancelled
  list.py category X   — filter by category
"""
import json, sys, sqlite3
from pathlib import Path

DB = Path(__file__).parent.parent / "db" / "reminders.sqlite"
db = sqlite3.connect(str(DB))
db.row_factory = sqlite3.Row

args = sys.argv[1:]

if not args or args[0] == "pending":
    rows = db.execute("SELECT * FROM reminders WHERE status = 'pending' ORDER BY due").fetchall()
elif args[0] == "all":
    rows = db.execute("SELECT * FROM reminders ORDER BY due DESC").fetchall()
elif args[0] == "history":
    rows = db.execute("SELECT * FROM reminders WHERE status IN ('fired', 'cancelled') ORDER BY fired_at DESC LIMIT 20").fetchall()
elif args[0] == "category" and len(args) > 1:
    rows = db.execute("SELECT * FROM reminders WHERE category = ? AND status = 'pending' ORDER BY due", [args[1]]).fetchall()
else:
    rows = db.execute("SELECT * FROM reminders WHERE status = 'pending' ORDER BY due").fetchall()

result = []
for r in rows:
    result.append({
        "id": r["id"], "text": r["text"], "due": r["due"],
        "recurring": r["recurring"], "category": r["category"],
        "status": r["status"], "cron_job_id": r["cron_job_id"],
        "fired_at": r["fired_at"]
    })

print(json.dumps(result, indent=2))
