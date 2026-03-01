# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Initialize the lists database."""
import sqlite3, sys
from pathlib import Path

db_path = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).parent.parent / "db" / "lists.sqlite")
Path(db_path).parent.mkdir(parents=True, exist_ok=True)

db = sqlite3.connect(db_path)
db.executescript("""
    CREATE TABLE IF NOT EXISTS lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        due TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived')),
        created TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lists_status ON lists(status);
    CREATE INDEX IF NOT EXISTS idx_lists_due ON lists(due);

    CREATE TABLE IF NOT EXISTS list_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        checked INTEGER DEFAULT 0,
        priority INTEGER DEFAULT 0,
        created TEXT NOT NULL,
        FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_items_list ON list_items(list_id);
""")
db.commit()
db.close()
print(f"OK: Database initialized at {db_path}")
