---
name: pages
description: Publish dynamic web pages for dashboards, trackers, or any data viewable in a browser. Server-side Python runs on every request.
---

# Pages

Drop a `.py` file in `pages/` with a `render(request)` function and it's live as a web page. Any Python logic — DB queries, API calls, file reads — runs server-side on every request. The server wraps your HTML in a shared dark mode layout with auto-discovered navigation.

Available at `http://jeeves:8080` over Tailscale.

## Creating Pages

Create, edit, and delete `.py` files in `workspace/skills/pages/pages/`. Changes are live on next request — no publish step, no restart.

```python
# pages/status.py
TITLE = "Status"      # display name (default: slug titlecased)
ICON = "📊"           # emoji for nav/home (default: 📄)
PINNED = True         # show in bottom tab bar (default: False)
POSITION = 1          # tab sort order, lower = left (default: 99)

def render(request):
    """Return an HTML string. Can be sync or async."""
    from datetime import datetime
    now = datetime.now().strftime("%H:%M")
    return f'<h1 class="text-2xl font-bold">Status</h1><p>Last checked: {now}</p>'
```

### Rules

- `render(request)` is **required** — receives a FastAPI `Request`, returns HTML
- `Path(__file__)` gives the module's location for relative DB/file paths
- Files starting with `_` are skipped (use for shared helpers)
- Errors show a styled traceback page, not a raw 500
- Use `request.query_params` for URL parameters (e.g. `?date=2026-01-01`)

### Sub-routes

Use a directory with `__init__.py` for nested pages:

```
pages/
├── status.py              # /status
└── items/                 # /items, /items/new, /items/42
    ├── __init__.py        # /items (index) + fallback for /items/{id}
    └── new.py             # /items/new (exact match)
```

The `__init__.py` handles the index and any unmatched sub-paths via `request.path_params.get("subpath", "")`.

## Server

Page changes are live immediately. Only restart if `server.py` itself changes:

```bash
# Start
nohup uv run workspace/skills/pages/scripts/server.py > /tmp/jeeves-pages.log 2>&1 &

# Restart
pkill -f 'skills/pages/scripts/server.py'; nohup uv run workspace/skills/pages/scripts/server.py > /tmp/jeeves-pages.log 2>&1 &
```

## Styling

Tailwind CSS is available via CDN. Custom theme colours:

`bg` (#1a1a2e), `card` (#16213e), `border` (#2a2a4a), `accent` (#e94560), `muted` (#8a8a9a)

Use as Tailwind classes: `bg-card`, `border-border`, `text-accent`, `text-muted`, etc.
