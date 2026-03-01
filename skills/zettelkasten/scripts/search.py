# /// script
# requires-python = ">=3.11"
# dependencies = ["sqlite-utils>=3.36"]
# ///
"""Search Zettel notes by keyword (FTS5) or tag."""
import sys, json
from pathlib import Path
import sqlite_utils

db_path = str(Path(__file__).parent.parent / "db" / "zettel.sqlite")
db = sqlite_utils.Database(db_path)

query = sys.argv[1] if len(sys.argv) > 1 else ""
mode = sys.argv[2] if len(sys.argv) > 2 else "fts"  # fts | tag | all | id

results = []

if mode == "tag":
    rows = db.execute("""
        SELECT n.id, n.title, n.body, n.source, n.created,
               GROUP_CONCAT(t2.tag, ', ') as tags
        FROM notes n
        JOIN tags t ON t.note_id = n.id AND t.tag = ?
        LEFT JOIN tags t2 ON t2.note_id = n.id
        GROUP BY n.id
        ORDER BY n.created DESC
        LIMIT 20
    """, [query.lower().strip()]).fetchall()
    for r in rows:
        results.append({"id": r[0], "title": r[1], "body": r[2][:200], "source": r[3], "created": r[4], "tags": r[5]})

elif mode == "id":
    row = db.execute("""
        SELECT n.id, n.title, n.body, n.source, n.created, n.updated,
               GROUP_CONCAT(t.tag, ', ') as tags
        FROM notes n
        LEFT JOIN tags t ON t.note_id = n.id
        WHERE n.id = ?
        GROUP BY n.id
    """, [query]).fetchone()
    if row:
        # Get links from this note
        links_from = db.execute("SELECT to_id, context FROM links WHERE from_id = ?", [query]).fetchall()
        # Get backlinks to this note
        links_to = db.execute("SELECT from_id, context FROM links WHERE to_id = ?", [query]).fetchall()
        results.append({
            "id": row[0], "title": row[1], "body": row[2], "source": row[3],
            "created": row[4], "updated": row[5], "tags": row[6],
            "links_to": [{"id": l[0], "context": l[1]} for l in links_from],
            "backlinks": [{"id": l[0], "context": l[1]} for l in links_to],
        })

elif mode == "all":
    rows = db.execute("""
        SELECT n.id, n.title, n.body, n.source, n.created,
               GROUP_CONCAT(t.tag, ', ') as tags
        FROM notes n
        LEFT JOIN tags t ON t.note_id = n.id
        GROUP BY n.id
        ORDER BY n.created DESC
        LIMIT ?
    """, [int(query) if query.isdigit() else 20]).fetchall()
    for r in rows:
        results.append({"id": r[0], "title": r[1], "body": r[2][:200], "source": r[3], "created": r[4], "tags": r[5]})

else:  # fts
    # Build FTS query - quote each term with OR
    terms = query.strip().split()
    if not terms:
        print("[]")
        sys.exit(0)
    fts_query = " OR ".join(f'"{t}"' for t in terms)
    try:
        rows = db.execute("""
            SELECT n.id, n.title, n.body, n.source, n.created,
                   GROUP_CONCAT(t.tag, ', ') as tags
            FROM notes_fts f
            JOIN notes n ON n.rowid = f.rowid
            LEFT JOIN tags t ON t.note_id = n.id
            WHERE notes_fts MATCH ?
            GROUP BY n.id
            ORDER BY rank
            LIMIT 20
        """, [fts_query]).fetchall()
        for r in rows:
            results.append({"id": r[0], "title": r[1], "body": r[2][:200], "source": r[3], "created": r[4], "tags": r[5]})
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

print(json.dumps(results, indent=2))
