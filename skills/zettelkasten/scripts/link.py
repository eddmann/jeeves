# /// script
# requires-python = ">=3.11"
# dependencies = ["sqlite-utils>=3.36"]
# ///
"""Manage links between Zettel notes."""
import sys, json
from pathlib import Path
import sqlite_utils

db_path = str(Path(__file__).parent.parent / "db" / "zettel.sqlite")
db = sqlite_utils.Database(db_path)

action = sys.argv[1] if len(sys.argv) > 1 else "list"
note_id = sys.argv[2] if len(sys.argv) > 2 else ""

if action == "add":
    # Read JSON from stdin: {"from": "id", "to": "id", "context": "why"}
    data = json.loads(sys.stdin.read())
    from_id = data["from"]
    to_id = data["to"]
    context = data.get("context", "")
    # Verify both notes exist
    if db["notes"].count_where("id = ?", [from_id]) == 0:
        print(json.dumps({"error": f"Note {from_id} not found"}))
        sys.exit(1)
    if db["notes"].count_where("id = ?", [to_id]) == 0:
        print(json.dumps({"error": f"Note {to_id} not found"}))
        sys.exit(1)
    db["links"].insert({"from_id": from_id, "to_id": to_id, "context": context}, ignore=True)
    print(json.dumps({"ok": True, "from": from_id, "to": to_id}))

elif action == "remove":
    data = json.loads(sys.stdin.read())
    db.execute("DELETE FROM links WHERE from_id = ? AND to_id = ?", [data["from"], data["to"]])
    print(json.dumps({"ok": True}))

elif action == "list":
    if not note_id:
        print(json.dumps({"error": "Provide a note ID"}))
        sys.exit(1)
    links_from = db.execute("""
        SELECT l.to_id, l.context, n.title
        FROM links l JOIN notes n ON n.id = l.to_id
        WHERE l.from_id = ?
    """, [note_id]).fetchall()
    backlinks = db.execute("""
        SELECT l.from_id, l.context, n.title
        FROM links l JOIN notes n ON n.id = l.from_id
        WHERE l.to_id = ?
    """, [note_id]).fetchall()
    print(json.dumps({
        "note_id": note_id,
        "links": [{"id": r[0], "context": r[1], "title": r[2]} for r in links_from],
        "backlinks": [{"id": r[0], "context": r[1], "title": r[2]} for r in backlinks],
    }, indent=2))

elif action == "graph":
    # Full graph summary
    notes = db.execute("SELECT id, title FROM notes ORDER BY created").fetchall()
    links = db.execute("SELECT from_id, to_id, context FROM links").fetchall()
    print(json.dumps({
        "nodes": [{"id": n[0], "title": n[1]} for n in notes],
        "edges": [{"from": l[0], "to": l[1], "context": l[2]} for l in links],
    }, indent=2))
