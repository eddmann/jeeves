# /// script
# requires-python = ">=3.11"
# dependencies = ["sqlite-utils>=3.36"]
# ///
"""Create a new Zettel note."""
import sys, json
from pathlib import Path
from datetime import datetime, timezone
import sqlite_utils

db_path = str(Path(__file__).parent.parent / "db" / "zettel.sqlite")
db = sqlite_utils.Database(db_path)

# Read JSON from stdin
data = json.loads(sys.stdin.read())
title = data["title"]
body = data["body"]
source = data.get("source", "")
tags = data.get("tags", [])
links = data.get("links", [])  # list of note IDs to link to

# Generate timestamp ID
now = datetime.now(timezone.utc)
note_id = now.strftime("%Y%m%d%H%M%S")

# Ensure unique ID
while db["notes"].count_where("id = ?", [note_id]) > 0:
    note_id = str(int(note_id) + 1)

ts = now.isoformat()

# Insert note
db["notes"].insert({
    "id": note_id,
    "title": title,
    "body": body,
    "source": source,
    "created": ts,
    "updated": ts,
})

# Insert tags
for tag in tags:
    db["tags"].insert({"note_id": note_id, "tag": tag.lower().strip()}, ignore=True)

# Insert links
for link_to in links:
    if db["notes"].count_where("id = ?", [link_to]) > 0:
        db["links"].insert({"from_id": note_id, "to_id": link_to, "context": ""}, ignore=True)

print(json.dumps({"id": note_id, "title": title, "tags": tags, "links": links}))
