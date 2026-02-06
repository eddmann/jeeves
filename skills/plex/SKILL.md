---
name: plex
description: "Query Plex media server for libraries, playback sessions, playlists, and server info."
---

# Plex Skill

Manage your Plex media server using uv inline Python scripts with dependency declarations via heredoc.

## Environment Variables

Set these in your environment:

```bash
export PLEX_URL="http://your-plex-server:32400"
export PLEX_TOKEN="your-plex-token"
```

## Core Operations

### Browse Libraries

List all libraries:

```bash
uv run - <<'EOF'
# /// script
# requires-python = ">=3.12"
# dependencies = ["plexapi>=4.0"]
# ///

import os
from plexapi.server import PlexServer

server = PlexServer(os.environ['PLEX_URL'], os.environ['PLEX_TOKEN'])
for library in server.library.sections():
    print(f"{library.title} ({library.type}) - {len(library.all())} items")
EOF
```

### Search Content

```bash
uv run - "star wars" <<'EOF'
# /// script
# requires-python = ">=3.12"
# dependencies = ["plexapi>=4.0"]
# ///

import os
import sys
from plexapi.server import PlexServer

if len(sys.argv) < 2:
    print("Usage: script <search_term>")
    sys.exit(1)

server = PlexServer(os.environ['PLEX_URL'], os.environ['PLEX_TOKEN'])
results = server.search(sys.argv[1])
for item in results:
    print(f"{item.title} ({item.type})")
EOF
```

### Server Info

```bash
uv run - <<'EOF'
# /// script
# requires-python = ">=3.12"
# dependencies = ["plexapi>=4.0"]
# ///

import os
from plexapi.server import PlexServer

server = PlexServer(os.environ['PLEX_URL'], os.environ['PLEX_TOKEN'])
print(f"Server: {server.friendlyName}")
print(f"Version: {server.version}")
print(f"Platform: {server.platform}")
print(f"Libraries: {len(server.library.sections())}")
print(f"Active Sessions: {len(server.sessions())}")
EOF
```

## Debugging

If a method call fails or you're unsure what's available on the server object, introspect it:

```bash
uv run -c "from plexapi.server import PlexServer; print([m for m in dir(PlexServer) if not m.startswith('_')])"
```

For full library docs, fetch the README:

```
webfetch https://github.com/pkkid/python-plexapi
```

## Usage Pattern

When implementing Plex operations:

1. Use `uv run -` to run from stdin
2. Include proper inline script metadata with dependencies
3. Pass arguments after the `-` if needed
4. Scripts run in memory without persisting to disk

The heredoc approach keeps everything ephemeral while still using proper uv inline script format.
