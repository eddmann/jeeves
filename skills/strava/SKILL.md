---
name: strava
description: "Query Strava for activities, performance stats, segments, and social data."
---

# Strava Skill

Manage your Strava data using uv inline Python scripts with dependency declarations via heredoc.

## Environment Variables

Set these in your environment:

```bash
export STRAVA_CLIENT_ID="your-client-id"
export STRAVA_CLIENT_SECRET="your-client-secret"
export STRAVA_ACCESS_TOKEN="your-access-token"
export STRAVA_REFRESH_TOKEN="your-refresh-token"
```

## Core Operations

### Recent Activities

List recent activities:

```bash
uv run - <<'EOF'
# /// script
# requires-python = ">=3.12"
# dependencies = ["stravalib>=2.0"]
# ///

import os
from stravalib.client import Client

client = Client(access_token=os.environ['STRAVA_ACCESS_TOKEN'])
activities = client.get_activities(limit=10)

for activity in activities:
    distance_km = float(activity.distance) / 1000 if activity.distance else 0
    print(f"{activity.start_date.strftime('%Y-%m-%d')}: {activity.name}")
    print(f"  Type: {activity.type}, Distance: {distance_km:.2f}km")
    if activity.moving_time:
        print(f"  Time: {activity.moving_time}, Avg Speed: {activity.average_speed}")
    print()
EOF
```

## Token Refresh

Handle token refresh (Strava tokens expire — run this if you get 401 errors):

```bash
uv run - <<'EOF'
# /// script
# requires-python = ">=3.12"
# dependencies = ["stravalib>=2.0"]
# ///

import os
from stravalib.client import Client

client_id = os.environ['STRAVA_CLIENT_ID']
client_secret = os.environ['STRAVA_CLIENT_SECRET']
refresh_token = os.environ['STRAVA_REFRESH_TOKEN']

client = Client()
try:
    token_response = client.refresh_access_token(
        client_id=client_id,
        client_secret=client_secret,
        refresh_token=refresh_token
    )

    print("✅ Token refreshed successfully!")
    print(f"New access token: {token_response['access_token']}")
    print(f"New refresh token: {token_response['refresh_token']}")
    print("Update your environment variables with these new tokens.")

except Exception as e:
    print(f"❌ Token refresh failed: {e}")
EOF
```

## Debugging

If a method call fails or you're unsure what's available on the client object, introspect it:

```bash
uv run -c "from stravalib.client import Client; print([m for m in dir(Client) if not m.startswith('_')])"
```

For full library docs, fetch the README:

```
webfetch https://github.com/stravalib/stravalib
```

## Usage Pattern

When implementing Strava operations:

1. Use `uv run -` to run from stdin
2. Include proper inline script metadata with dependencies (stravalib)
3. Pass arguments after the `-` if needed
4. Handle API rate limits gracefully
5. Scripts run in memory without persisting to disk

The heredoc approach keeps everything ephemeral while still using proper uv inline script format.
