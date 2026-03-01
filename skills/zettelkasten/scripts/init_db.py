# /// script
# requires-python = ">=3.11"
# dependencies = ["sqlite-vec>=0.1"]
# ///
"""Initialize the Zettelkasten SQLite database with sqlite-vec support."""
import sys, sqlite3, sqlite_vec
from pathlib import Path

db_path = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).parent.parent / "db" / "zettel.sqlite")
Path(db_path).parent.mkdir(parents=True, exist_ok=True)

db = sqlite3.connect(db_path)
db.enable_load_extension(True)
sqlite_vec.load(db)

db.executescript("""
    CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source TEXT DEFAULT '',
        created TEXT NOT NULL,
        updated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
        note_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (note_id, tag),
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);

    CREATE TABLE IF NOT EXISTS links (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        context TEXT DEFAULT '',
        PRIMARY KEY (from_id, to_id),
        FOREIGN KEY (from_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (to_id) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        title, body, content=notes, content_rowid=rowid
    );

    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
    END;
    CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
        INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
    END;
""")

# Create vec0 virtual table for vector search (1536 dims for text-embedding-3-small)
try:
    db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS notes_vec USING vec0(note_id TEXT PRIMARY KEY, embedding float[1536] distance_metric=cosine)")
except Exception:
    pass  # Already exists

db.commit()
db.close()
print(f"OK: Database initialized at {db_path}")
