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

Plex uses OAuth with a PIN-based flow — no callback URL needed. Generate an auth link, send it to the user, then poll until they sign in.

**Step 1: Generate auth URL and PIN ID**

```bash
set -a; source .env 2>/dev/null; set +a; uv run - <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["plexapi>=4.18"]
# ///
from plexapi.myplex import MyPlexPinLogin

pinlogin = MyPlexPinLogin(oauth=True)
print(f"URL: {pinlogin.oauthUrl()}")
print(f"PIN: {pinlogin.pin}")
EOF
```

Send the URL to the user as a clickable link and tell them to sign in.

**Step 2: Poll for completion** (run after user says they've signed in)

```bash
set -a; source .env 2>/dev/null; set +a; uv run - PIN_ID_HERE <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["plexapi>=4.18"]
# ///
import json, os, sys
from pathlib import Path
from plexapi.myplex import MyPlexPinLogin, MyPlexAccount
from plexapi.server import PlexServer

pinlogin = MyPlexPinLogin(oauth=True)
pinlogin._pin = {"id": int(sys.argv[1]), "code": pinlogin._code}
pinlogin.run(timeout=5)
pinlogin.waitForLogin()

if not pinlogin.token:
    print("ERROR: Auth not completed — ask user to click the link and sign in")
    exit(1)

server_url = os.environ["PLEX_SERVER_URL"]
plex = PlexServer(server_url, pinlogin.token)

Path("plex-token.json").write_text(json.dumps({
    "token": pinlogin.token,
    "server_url": server_url
}, indent=2))
Path("plex-token.json").chmod(0o600)

print(f"SUCCESS: Connected as {MyPlexAccount(token=pinlogin.token).username}")
print(f"Server: {plex.friendlyName}")
for section in plex.library.sections():
    print(f"  - {section.title} ({section.type})")
EOF
```

**Alternative: direct token auth.** If the user already has a Plex token, skip OAuth and store it directly:

```bash
set -a; source .env 2>/dev/null; set +a; uv run - <<'EOF'
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

For the direct token approach, append `PLEX_TOKEN` to `.env` first.

## Query Template

```bash
set -a; source .env 2>/dev/null; set +a; uv run - <<'EOF'
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

| Method | Returns | Description |
|--------|---------|-------------|
| `plex.library.sections()` | list[LibrarySection] | All library sections |
| `plex.library.section(name)` | LibrarySection | Get section by title |
| `plex.library.sectionByID(id)` | LibrarySection | Get section by ID |
| `plex.library.onDeck()` | list[Media] | On deck items |
| `plex.library.recentlyAdded()` | list[Media] | Recently added across all sections |
| `plex.continueWatching()` | list[Media] | Continue watching hub |
| `plex.history(maxresults=N)` | list[Media] | Watch history |

### Section Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `section.all()` | list[Media] | All items in section |
| `section.search(title, **filters)` | list[Media] | Search with filters |
| `section.recentlyAdded()` | list[Media] | Recently added to section |
| `section.onDeck()` | list[Media] | On deck for section |

### Media Fields (Movie)

| Field | Type | Description |
|-------|------|-------------|
| `title` | str | Movie title |
| `year` | int | Release year |
| `duration` | int | Duration in milliseconds |
| `rating` | float | Critic rating |
| `audienceRating` | float | Audience rating (Rotten Tomatoes) |
| `contentRating` | str | Content rating (PG-13, R, etc.) |
| `summary` | str | Plot summary |
| `genres` | list[Genre] | Genre tags (access `.tag`) |
| `directors` | list[Director] | Directors (access `.tag`) |
| `roles` | list[Role] | Cast members (access `.tag`) |
| `studio` | str | Production studio |
| `addedAt` | datetime | When added to library |
| `lastViewedAt` | datetime | Last watched (None if unwatched) |
| `viewCount` | int | Times watched |

### Media Fields (Show)

| Field | Type | Description |
|-------|------|-------------|
| `title` | str | Show title |
| `year` | int | First aired year |
| `childCount` | int | Number of seasons |
| `leafCount` | int | Total episodes |
| `viewedLeafCount` | int | Watched episodes |
| `duration` | int | Typical episode duration (ms) |

### Media Fields (Episode)

| Field | Type | Description |
|-------|------|-------------|
| `title` | str | Episode title |
| `grandparentTitle` | str | Show name |
| `parentTitle` | str | Season name |
| `parentIndex` | int | Season number |
| `index` | int | Episode number |
| `duration` | int | Duration in milliseconds |

### Navigation (Shows)

| Method | Returns | Description |
|--------|---------|-------------|
| `show.seasons()` | list[Season] | All seasons |
| `show.episodes()` | list[Episode] | All episodes |
| `show.episode(season=N, episode=M)` | Episode | Specific episode |
| `season.episodes()` | list[Episode] | Episodes in season |

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
