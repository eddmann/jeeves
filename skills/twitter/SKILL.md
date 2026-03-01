---
name: twitter
description: Fetch X/Twitter timeline and bookmarks. Use when the user asks about their Twitter feed, "what's on my timeline", "my bookmarks", "what have I bookmarked", or wants raw tweet data.
---

# Twitter/X Skill

Fetch timeline and bookmarks from X using Playwright with session cookies.

Cookies stored at `workspace/skills/twitter/twitter-cookies.json` (auth_token + ct0).

## Setup

Twitter doesn't offer a usable OAuth flow, so auth uses session cookies exported from the user's browser.

Walk the user through these steps:

1. Log into [x.com](https://x.com) in a browser
2. Open DevTools (F12) → **Application** tab → **Cookies** → `https://x.com`
3. Copy the values of `auth_token` and `ct0`

Then save them:

```bash
cat > skills/twitter/twitter-cookies.json <<'EOF'
{
  "auth_token": "PASTE_AUTH_TOKEN_HERE",
  "ct0": "PASTE_CT0_HERE"
}
EOF
chmod 600 skills/twitter/twitter-cookies.json
```

## Fetch Timeline

```bash
cd /app && uv run workspace/skills/twitter/scripts/fetch_timeline.py        # default 50 tweets
cd /app && uv run workspace/skills/twitter/scripts/fetch_timeline.py 100    # more tweets
```

Returns JSON: `{count, tweets: [{author, handle, timestamp, content, links}]}`

## Fetch Bookmarks

```bash
cd /app && uv run workspace/skills/twitter/scripts/fetch_bookmarks.py       # default 30
cd /app && uv run workspace/skills/twitter/scripts/fetch_bookmarks.py 50    # more
```

Returns JSON: `{count, bookmarks: [{author, handle, timestamp, content, links}]}`

## Cookie Refresh

If fetches return errors or redirect to login, cookies have expired. Re-run the Setup steps to export fresh values.

## Quick Reference

- "What's on my Twitter?" → `fetch_timeline.py`
- "My bookmarks" → `fetch_bookmarks.py`
