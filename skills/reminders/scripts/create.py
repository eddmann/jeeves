#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Create a reminder. Reads JSON from stdin.

Input: {"text": "Change Milton water", "due": "2026-03-02T10:00:00Z", "recurring": "daily", "category": "baby"}
- text: required
- due: required, ISO 8601 datetime
- recurring: optional, null/omitted for one-off, or "daily", "weekly", cron expr
- category: optional, for grouping

Output: {"id": 1, "text": "...", "due": "...", "cron_job_id": "..."}

NOTE: This only records the reminder in the database. The agent must ALSO create
the actual cron job using the cron tool, and then call link.py to store the job ID.
"""
import json, sys, sqlite3
from pathlib import Path

DB = Path(__file__).parent.parent / "db" / "reminders.sqlite"
db = sqlite3.connect(str(DB))
db.row_factory = sqlite3.Row

data = json.load(sys.stdin)
text = data["text"]
due = data["due"]
recurring = data.get("recurring")
category = data.get("category", "")

cur = db.execute(
    "INSERT INTO reminders (text, due, recurring, category) VALUES (?, ?, ?, ?)",
    [text, due, recurring, category]
)
db.commit()
rid = cur.lastrowid
print(json.dumps({"id": rid, "text": text, "due": due, "recurring": recurring, "category": category}))
