---
name: strava
description: Query Strava fitness data including activities, stats, and athlete info. Use when the user asks about their Strava data, running or cycling activities, workout history, fitness stats, "how far did I run", "my cycling stats", "Strava activities", or wants to analyze exercise data from Strava.
---

# Strava Skill

Query Strava fitness data by writing UV inline Python scripts using stravalib.

## Setup

### Credentials

Requires `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` in `workspace/.env`.

If not set, walk the user through creating a Strava API application:

1. Go to https://www.strava.com/settings/api
2. Create an application (any name, set **Authorization Callback Domain** to `localhost`)
3. Copy the Client ID and Client Secret

Then append to `.env`:

```bash
echo 'STRAVA_CLIENT_ID=their_client_id' >> .env
echo 'STRAVA_CLIENT_SECRET=their_client_secret' >> .env
```

### Authentication

Strava uses OAuth2. Generate an auth link, send it to the user, then ask them to paste back the redirect URL.

**Step 1: Generate auth URL**

```bash
set -a; source .env 2>/dev/null; set +a; uv run - <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["stravalib>=2.4"]
# ///
import os
from stravalib import Client

client = Client()
url = client.authorization_url(
    client_id=int(os.environ["STRAVA_CLIENT_ID"]),
    redirect_uri="http://localhost/callback",
    scope=["read", "activity:read", "activity:read_all", "profile:read_all"]
)
print(f"URL: {url}")
EOF
```

Send the URL to the user as a clickable link. Tell them:
1. Click the link and authorize the app
2. The browser will redirect to a page that won't load (localhost) — **that's expected**
3. Copy the **full URL** from the browser address bar and paste it back here

**Step 2: Exchange code for tokens** (after user pastes the redirect URL)

Extract the `code` parameter from the URL the user pastes (it's in `?code=...&`), then:

```bash
set -a; source .env 2>/dev/null; set +a; uv run - "THE_CODE_HERE" <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["stravalib>=2.4"]
# ///
import json, os, sys
from pathlib import Path
from stravalib import Client

client = Client()
tokens = client.exchange_code_for_token(
    client_id=int(os.environ["STRAVA_CLIENT_ID"]),
    client_secret=os.environ["STRAVA_CLIENT_SECRET"],
    code=sys.argv[1]
)

Path("strava-tokens.json").write_text(json.dumps({
    "access_token": tokens["access_token"],
    "refresh_token": tokens["refresh_token"],
    "expires_at": tokens["expires_at"],
    "athlete_id": tokens.get("athlete", {}).get("id")
}, indent=2))
Path("strava-tokens.json").chmod(0o600)

print(f"SUCCESS: Tokens saved")
EOF
```

## Query Template

```bash
set -a; source .env 2>/dev/null; set +a; uv run - <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["stravalib>=2.4"]
# ///
import json, os, logging
from datetime import datetime, timedelta
from pathlib import Path
from stravalib import Client

logging.getLogger().setLevel(logging.ERROR)

TOKEN_FILE = Path("strava-tokens.json")
if not TOKEN_FILE.exists():
    print("ERROR: Not authenticated — run Strava setup first")
    exit(1)

tokens = json.loads(TOKEN_FILE.read_text())
client = Client()

# Auto-refresh expired tokens
if datetime.now().timestamp() >= tokens["expires_at"] - 60:
    new = client.refresh_access_token(
        client_id=int(os.environ["STRAVA_CLIENT_ID"]),
        client_secret=os.environ["STRAVA_CLIENT_SECRET"],
        refresh_token=tokens["refresh_token"]
    )
    tokens["access_token"] = new["access_token"]
    tokens["refresh_token"] = new["refresh_token"]
    tokens["expires_at"] = new["expires_at"]
    TOKEN_FILE.write_text(json.dumps(tokens, indent=2))

client.access_token = tokens["access_token"]

# === YOUR QUERY CODE HERE ===
for activity in client.get_activities(limit=5):
    dist_km = float(activity.distance) / 1000
    print(f"{activity.start_date_local.date()}: {activity.name} - {dist_km:.1f}km")
EOF
```

## API Reference

### Client Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `client.get_athlete()` | Athlete | Current user's profile |
| `client.get_athlete_stats(athlete_id)` | AthleteStats | Aggregated statistics |
| `client.get_activities(limit=N, after=date, before=date)` | Iterator[SummaryActivity] | List activities |
| `client.get_activity(activity_id)` | DetailedActivity | Single activity with full details |

### Activity Fields (SummaryActivity)

| Field | Type | Description |
|-------|------|-------------|
| `id` | int | Activity ID |
| `name` | str | Activity name |
| `type` | str | "Run", "Ride", "Swim", etc. |
| `sport_type` | str | More specific type (e.g., "TrailRun") |
| `distance` | Distance | Meters (use `float()` to convert) |
| `moving_time` | Duration | Seconds as int (use `.timedelta()` for timedelta) |
| `elapsed_time` | Duration | Seconds as int |
| `total_elevation_gain` | Distance | Meters climbed |
| `average_speed` / `max_speed` | Velocity | m/s |
| `average_heartrate` / `max_heartrate` | float/None | bpm (if recorded) |
| `start_date_local` | datetime | Local time |

DetailedActivity adds: `calories`, `description`, `laps`, `splits_metric`, `segment_efforts`

### AthleteStats

Access via `client.get_athlete_stats(tokens["athlete_id"])`:
- `ytd_run_totals`, `ytd_ride_totals` - Year-to-date
- `all_run_totals`, `all_ride_totals` - All-time
- `recent_run_totals`, `recent_ride_totals` - Last 4 weeks

Each Totals object has: `count`, `distance`, `moving_time` (Duration), `elevation_gain`

## Examples

These show non-obvious patterns. For straightforward methods, use the API reference above.

### Filter Activities (type conversion gotchas)

```python
# distance/moving_time are wrapper types — use float()/int() to convert
start = datetime.now() - timedelta(days=30)
runs = [a for a in client.get_activities(after=start, limit=100) if a.type == "Run"]

total_km = sum(float(a.distance) for a in runs) / 1000
total_hrs = sum(int(a.moving_time) for a in runs) / 3600
print(f"{len(runs)} runs: {total_km:.0f}km in {total_hrs:.1f}h")
```

## Quick Reference

```python
# Unit conversions
dist_km = float(activity.distance) / 1000
speed_kmh = float(activity.average_speed) * 3.6
time_sec = int(activity.moving_time)
pace_min_km = (time_sec / 60) / (float(activity.distance) / 1000)

# List all activity types
from stravalib.strava_model import ActivityType, SportType
print(ActivityType.model_json_schema()['enum'])  # Run, Ride, Swim, Hike, ...
print(SportType.model_json_schema()['enum'])     # TrailRun, MountainBikeRide, ...
```

## Re-authentication

Strava tokens auto-refresh in the query template. If refresh fails (e.g. user revoked access), re-run the full OAuth flow from the Setup section.

## Debugging

If a method call fails or you're unsure what's available, introspect:

```bash
uv run -c "from stravalib.client import Client; print([m for m in dir(Client) if not m.startswith('_')])"
```

For full library docs: `webfetch https://github.com/stravalib/stravalib`

## Troubleshooting

- **"Not authenticated"**: Run the OAuth flow from the Setup section
- **Token refresh fails**: Check `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` are set in `.env`
- **401 Unauthorized**: User may have revoked access, re-run OAuth
- **Field is None**: Some fields like `average_heartrate` only exist if recorded
- **User confused by localhost error**: Explain that the redirect to localhost failing is expected — they just need to copy the URL
