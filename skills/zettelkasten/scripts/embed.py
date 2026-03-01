# /// script
# requires-python = ">=3.11"
# dependencies = ["sqlite-vec>=0.1", "openai>=1.0"]
# ///
"""Generate embeddings for notes and store in sqlite-vec virtual table."""
import sys, json, os, sqlite3, sqlite_vec
from pathlib import Path
from openai import OpenAI

db_path = str(Path(__file__).parent.parent / "db" / "zettel.sqlite")
db = sqlite3.connect(db_path)
db.enable_load_extension(True)
sqlite_vec.load(db)

api_key = os.environ.get("OPENAI_API_KEY")
if not api_key:
    print(json.dumps({"error": "OPENAI_API_KEY not set"}))
    sys.exit(1)

client = OpenAI(api_key=api_key)
MODEL = "text-embedding-3-small"

# Optionally embed a single note
note_id = sys.argv[1] if len(sys.argv) > 1 else None

if note_id:
    row = db.execute("SELECT id, title, body FROM notes WHERE id = ?", [note_id]).fetchone()
    if not row:
        print(json.dumps({"error": f"Note {note_id} not found"}))
        sys.exit(1)
    notes = [{"id": row[0], "text": f"{row[1]}\n\n{row[2]}"}]
else:
    # Find all notes not in the vec table
    rows = db.execute("""
        SELECT n.id, n.title, n.body
        FROM notes n
        WHERE n.id NOT IN (SELECT note_id FROM notes_vec)
    """).fetchall()
    notes = [{"id": r[0], "text": f"{r[1]}\n\n{r[2]}"} for r in rows]

if not notes:
    print(json.dumps({"embedded": 0, "message": "All notes already have embeddings"}))
    sys.exit(0)

# Batch embed
BATCH_SIZE = 100
total = 0

for i in range(0, len(notes), BATCH_SIZE):
    batch = notes[i:i + BATCH_SIZE]
    texts = [n["text"] for n in batch]

    response = client.embeddings.create(input=texts, model=MODEL)

    for j, embedding_data in enumerate(response.data):
        nid = batch[j]["id"]
        vector = json.dumps(embedding_data.embedding)
        # Delete existing if re-embedding
        db.execute("DELETE FROM notes_vec WHERE note_id = ?", [nid])
        db.execute("INSERT INTO notes_vec(note_id, embedding) VALUES (?, ?)", [nid, vector])
        total += 1

db.commit()
db.close()
print(json.dumps({"embedded": total, "model": MODEL}))
