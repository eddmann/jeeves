# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Initialise the reminders database."""
import sqlite3
from pathlib import Path

DB = Path(__file__).parent.parent / "db" / "reminders.sqlite"
DB.parent.mkdir(parents=True, exist_ok=True)

db = sqlite3.connect(str(DB))
db.executescript("""
CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    due TEXT NOT NULL,
    recurring TEXT,          -- null=one-off, otherwise cron expr or 'daily','weekly'
    cron_job_id TEXT,        -- the cron system job ID
    category TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',  -- pending, fired, cancelled
    fired_at TEXT,
    created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
);
""")
db.close()
print('{"ok": true, "db": "' + str(DB) + '"}')
