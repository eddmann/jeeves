# /// script
# requires-python = ">=3.11"
# dependencies = ["sqlite-vec>=0.1", "openai>=1.0"]
# ///
"""Semantic search across Zettel notes using sqlite-vec KNN."""
import sys, json, os, sqlite3, sqlite_vec
from pathlib import Path
from openai import OpenAI

db_path = str(Path(__file__).parent.parent / "db" / "zettel.sqlite")
db = sqlite3.connect(db_path)
db.enable_load_extension(True)
sqlite_vec.load(db)

query = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else ""
if not query:
    print(json.dumps({"error": "Provide a search query"}))
    sys.exit(1)

api_key = os.environ.get("OPENAI_API_KEY")
if not api_key:
    print(json.dumps({"error": "OPENAI_API_KEY not set"}))
    sys.exit(1)

client = OpenAI(api_key=api_key)
MODEL = "text-embedding-3-small"

# Embed the query
response = client.embeddings.create(input=[query], model=MODEL)
query_vec = json.dumps(response.data[0].embedding)

# KNN search via sqlite-vec — two-step: fetch matches, then enrich
knn_rows = db.execute("""
    SELECT note_id, distance
    FROM notes_vec
    WHERE embedding MATCH ? AND k = 10
    ORDER BY distance
""", [query_vec]).fetchall()

results = []
for note_id, distance in knn_rows:
    row = db.execute("""
        SELECT n.title, n.body, n.source, n.created,
               GROUP_CONCAT(t.tag, ', ') as tags
        FROM notes n
        LEFT JOIN tags t ON t.note_id = n.id
        WHERE n.id = ?
        GROUP BY n.id
    """, [note_id]).fetchone()
    if row:
        similarity = round(1.0 - distance, 4)
        results.append({
            "id": note_id,
            "distance": round(distance, 4),
            "similarity": similarity,
            "title": row[0],
            "body": row[1][:300],
            "source": row[2],
            "created": row[3],
            "tags": row[4],
        })

db.close()
print(json.dumps(results, indent=2))
