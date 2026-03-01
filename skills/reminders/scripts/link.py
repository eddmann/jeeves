#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Link a cron job ID to a reminder. Reads JSON from stdin.

Input: {"reminder_id": 1, "cron_job_id": "abc123"}
"""
import json, sys, sqlite3
from pathlib import Path

DB = Path(__file__).parent.parent / "db" / "reminders.sqlite"
db = sqlite3.connect(str(DB))

data = json.load(sys.stdin)
db.execute("UPDATE reminders SET cron_job_id = ? WHERE id = ?",
           [data["cron_job_id"], data["reminder_id"]])
db.commit()
print(json.dumps({"ok": True, "reminder_id": data["reminder_id"], "cron_job_id": data["cron_job_id"]}))
