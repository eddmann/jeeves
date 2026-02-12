---
name: plex
description: Query Plex Media Server for movies, TV shows, music, and playback history. Use when the user asks about their Plex library, "what movies do I have", "recently added", "continue watching", "watch history", "search my Plex", or wants to explore media in their Plex server.
---

# Plex Skill

Query Plex Media Server by writing UV inline Python scripts using plexapi.

## Setup

### Credentials

Requires `PLEX_SERVER_URL` in `workspace/.env`.

If not set, ask the user for their Plex server URL (e.g. `http://192.168.1.100:32400`), then append to `.env`:

```bash
echo 'PLEX_SERVER_URL=http://their-server:32400' >> .env
```

### Authentication

Plex uses OAuth with a PIN-based flow. This MUST be done in two separate steps because you need to show the user the link and wait for them to click it before polling.

**Step 1: Generate auth URL and save state**

```bash
set -a; source .env 2>/dev/null; set +a; uv run - <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["plexapi>=4.18"]
# ///
import json
from pathlib import Path
from plexapi.myplex import MyPlexPinLogin

pinlogin = MyPlexPinLogin(oauth=True)
code = pinlogin._getCode()
pin_id = pinlogin._id
client_id = pinlogin._headers()['X-Plex-Client-Identifier']

# Save state for step 2
Path("plex-oauth-state.json").write_text(json.dumps({
    "pin_id": pin_id,
    "code": code,
    "client_id": client_id,
}))

print(f"URL: {pinlogin.oauthUrl()}")
EOF
```

Send the URL to the user as a clickable markdown link. Tell them to sign in and let you know when done.
The PIN is valid for ~15 minutes so there's no rush.

**IMPORTANT:** Do NOT call `pinlogin.run()` or `pinlogin.waitForLogin()` — these start a blocking polling thread that will timeout before the user can click the link. Instead, manually call `_getCode()` and save the state.

**Step 2: Poll for token** (run ONLY after user confirms they've signed in)

```bash
export PLEX_SERVER_URL=$(grep PLEX_SERVER_URL .env | cut -d= -f2); uv run - <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["plexapi>=4.18", "requests"]
# ///
import json, os, requests, time, xml.etree.ElementTree as ET
from pathlib import Path
from plexapi.server import PlexServer
from plexapi.myplex import MyPlexAccount

state = json.loads(Path("plex-oauth-state.json").read_text())

headers = {
    "Accept": "application/xml",
    "X-Plex-Client-Identifier": state["client_id"],
    "X-Plex-Product": "PlexAPI",
}

# Poll with backoff to avoid rate limiting (429)
for i in range(15):
    resp = requests.get(
        f"https://plex.tv/api/v2/pins/{state['pin_id']}",
        headers=headers, timeout=10
    )
    if resp.status_code == 429:
        time.sleep(5)
        continue
    if resp.status_code == 200:
        root = ET.fromstring(resp.text)
        token = root.attrib.get('authToken', '')
        if token:
            server_url = os.environ["PLEX_SERVER_URL"]
            plex = PlexServer(server_url, token)
            Path("plex-token.json").write_text(json.dumps({
                "token": token,
                "server_url": server_url
            }, indent=2))
            Path("plex-token.json").chmod(0o600)
            account = MyPlexAccount(token=token)
            print(f"SUCCESS: Connected as {account.username}")
            print(f"Server: {plex.friendlyName}")
            for section in plex.library.sections():
                print(f"  - {section.title} ({section.type})")
            exit(0)
    time.sleep(3)

print("ERROR: No token received. Ask user to try signing in again.")
exit(1)
EOF
```

**Key details about the OAuth flow:**

- `MyPlexPinLogin.run()` generates a NEW pin and starts a blocking thread — don't use it for two-step auth
- `MyPlexPinLogin.pin` raises `BadRequest` when `oauth=True` — don't access it
- Use `_getCode()` to generate the PIN without starting the polling thread
- Save `_id` (pin ID), `_code`, and the client identifier to a file between steps
- In step 2, poll the Plex API directly with `requests` using the saved pin ID
- Plex rate limits aggressively — poll every 3s, back off on 429s

**Alternative: direct token auth.** If the user already has a Plex token, skip OAuth and store it directly:

```bash
export PLEX_SERVER_URL=$(grep PLEX_SERVER_URL .env | cut -d= -f2); uv run - <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["plexapi>=4.18"]
# ///
import json, os
from pathlib import Path
from plexapi.server import PlexServer

server_url = os.environ["PLEX_SERVER_URL"]
token = os.environ["PLEX_TOKEN"]

plex = PlexServer(server_url, token)

Path("plex-token.json").write_text(json.dumps({
    "token": token,
    "server_url": server_url
}, indent=2))
Path("plex-token.json").chmod(0o600)

print(f"SUCCESS: Connected to {plex.friendlyName}")
for section in plex.library.sections():
    print(f"  - {section.title} ({section.type})")
EOF
```

For the direct token approach, the user can find their token by opening any media item in the Plex web UI → Get Info → View XML → copy `X-Plex-Token` from the URL.

## Query Template

```bash
export PLEX_SERVER_URL=$(grep PLEX_SERVER_URL .env | cut -d= -f2); uv run - <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["plexapi>=4.18"]
# ///
import json
from pathlib import Path
from plexapi.server import PlexServer

TOKEN_FILE = Path("plex-token.json")
if not TOKEN_FILE.exists():
    print("ERROR: Not authenticated — run Plex setup first")
    exit(1)

config = json.loads(TOKEN_FILE.read_text())
plex = PlexServer(config["server_url"], config["token"])

# === YOUR QUERY CODE HERE ===
for section in plex.library.sections():
    print(f"{section.title} ({section.type}): {section.totalSize} items")
EOF
```

## API Reference

### Server Methods

| Method                         | Returns              | Description                        |
| ------------------------------ | -------------------- | ---------------------------------- |
| `plex.library.sections()`      | list[LibrarySection] | All library sections               |
| `plex.library.section(name)`   | LibrarySection       | Get section by title               |
| `plex.library.sectionByID(id)` | LibrarySection       | Get section by ID                  |
| `plex.library.onDeck()`        | list[Media]          | On deck items                      |
| `plex.library.recentlyAdded()` | list[Media]          | Recently added across all sections |
| `plex.continueWatching()`      | list[Media]          | Continue watching hub              |
| `plex.history(maxresults=N)`   | list[Media]          | Watch history                      |

### Section Methods

| Method                             | Returns     | Description               |
| ---------------------------------- | ----------- | ------------------------- |
| `section.all()`                    | list[Media] | All items in section      |
| `section.search(title, **filters)` | list[Media] | Search with filters       |
| `section.recentlyAdded()`          | list[Media] | Recently added to section |
| `section.onDeck()`                 | list[Media] | On deck for section       |

### Media Fields (Movie)

| Field            | Type           | Description                       |
| ---------------- | -------------- | --------------------------------- |
| `title`          | str            | Movie title                       |
| `year`           | int            | Release year                      |
| `duration`       | int            | Duration in milliseconds          |
| `rating`         | float          | Critic rating                     |
| `audienceRating` | float          | Audience rating (Rotten Tomatoes) |
| `contentRating`  | str            | Content rating (PG-13, R, etc.)   |
| `summary`        | str            | Plot summary                      |
| `genres`         | list[Genre]    | Genre tags (access `.tag`)        |
| `directors`      | list[Director] | Directors (access `.tag`)         |
| `roles`          | list[Role]     | Cast members (access `.tag`)      |
| `studio`         | str            | Production studio                 |
| `addedAt`        | datetime       | When added to library             |
| `lastViewedAt`   | datetime       | Last watched (None if unwatched)  |
| `viewCount`      | int            | Times watched                     |

### Media Fields (Show)

| Field             | Type | Description                   |
| ----------------- | ---- | ----------------------------- |
| `title`           | str  | Show title                    |
| `year`            | int  | First aired year              |
| `childCount`      | int  | Number of seasons             |
| `leafCount`       | int  | Total episodes                |
| `viewedLeafCount` | int  | Watched episodes              |
| `duration`        | int  | Typical episode duration (ms) |

### Media Fields (Episode)

| Field              | Type | Description              |
| ------------------ | ---- | ------------------------ |
| `title`            | str  | Episode title            |
| `grandparentTitle` | str  | Show name                |
| `parentTitle`      | str  | Season name              |
| `parentIndex`      | int  | Season number            |
| `index`            | int  | Episode number           |
| `duration`         | int  | Duration in milliseconds |

### Navigation (Shows)

| Method                              | Returns       | Description        |
| ----------------------------------- | ------------- | ------------------ |
| `show.seasons()`                    | list[Season]  | All seasons        |
| `show.episodes()`                   | list[Episode] | All episodes       |
| `show.episode(season=N, episode=M)` | Episode       | Specific episode   |
| `season.episodes()`                 | list[Episode] | Episodes in season |

## Examples

These show non-obvious patterns. For straightforward methods, use the API reference above.

### TV Show Navigation (unintuitive field names)

```python
shows = plex.library.section("TV Shows")
show = shows.get("Breaking Bad")
print(f"{show.title}: {show.leafCount} episodes")

for season in show.seasons():
    print(f"  {season.title}: {len(season.episodes())} episodes")

# Episode fields use grandparent/parent for show/season
ep = show.episode(season=1, episode=1)
print(f"{ep.grandparentTitle} S{ep.parentIndex}E{ep.index}: {ep.title}")
```

### Search with Filters

```python
movies = plex.library.section("Movies")

# Filter by genre + year
action = movies.search(genre="Action", year=2023)
for m in action:
    # Tags are objects — access .tag for the string
    genres = [g.tag for g in m.genres]
    print(f"{m.title} ({m.year}) - {', '.join(genres)}")
```

## Quick Reference

```python
# Unit conversions
duration_min = media.duration / 60000
duration_hrs = media.duration / 3600000

# Library section types
# "movie", "show", "artist" (music), "photo"

# Access tag names from lists
genres = [g.tag for g in movie.genres]
actors = [r.tag for r in movie.roles]
directors = [d.tag for d in movie.directors]

# Check if watched
is_watched = media.viewCount > 0
is_unwatched = media.lastViewedAt is None
```

## Re-authentication

Plex tokens are long-lived but can be revoked. If queries fail with "Unauthorized", re-run the OAuth flow from the Setup section.

## Debugging

If a method call fails or you're unsure what's available, introspect:

```bash
uv run -c "from plexapi.server import PlexServer; print([m for m in dir(PlexServer) if not m.startswith('_')])"
```

For full library docs: `webfetch https://github.com/pkkid/python-plexapi`

## Troubleshooting

- **"Not authenticated"**: Run the OAuth flow from the Setup section
- **"Connection refused"**: Check PLEX_SERVER_URL, ensure server is running
- **"Unauthorized"**: Token revoked, re-run OAuth
- **Section not found**: Use exact section title (case-sensitive), check `plex.library.sections()`
- **Empty results**: Some methods return generators; convert with `list()` if needed
- **Rate limited (429)**: Plex API rate limits aggressively. Back off and retry. Avoid rapid repeated OAuth attempts.
