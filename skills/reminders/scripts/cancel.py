#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Cancel a reminder. Pass reminder_id as argv[1] or JSON stdin.

NOTE: The agent must ALSO remove the cron job using the cron tool.
"""
import json, sys, sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB = Path(__file__).parent.parent / "db" / "reminders.sqlite"
db = sqlite3.connect(str(DB))
db.row_factory = sqlite3.Row

if len(sys.argv) > 1:
    rid = int(sys.argv[1])
else:
    data = json.load(sys.stdin)
    rid = data["reminder_id"]

row = db.execute("SELECT cron_job_id FROM reminders WHERE id = ?", [rid]).fetchone()
if not row:
    print(json.dumps({"error": "not found"}))
    sys.exit(1)

now = datetime.now(timezone.utc).isoformat()
db.execute("UPDATE reminders SET status = 'cancelled', fired_at = ? WHERE id = ?", [now, rid])
db.commit()

print(json.dumps({"ok": True, "id": rid, "cron_job_id": row["cron_job_id"], "note": "Also remove the cron job if set"}))
