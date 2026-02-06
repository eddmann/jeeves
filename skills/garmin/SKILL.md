---
name: garmin
description: Query Garmin Connect health and fitness data including activities, sleep, heart rate, HRV, stress, and body battery. Use when the user asks about their Garmin data, "how did I sleep", "resting heart rate", "HRV", "stress levels", "body battery", "training status", "Garmin activities", or wants to analyze health metrics from Garmin Connect.
---

# Garmin Connect Skill

Query Garmin Connect health data by writing UV inline Python scripts using garminconnect.

## Setup

### Credentials

Requires `GARMIN_EMAIL` and `GARMIN_PASSWORD` in `workspace/.env`.

If not set, ask the user for their Garmin email and password, then append to `.env`:

```bash
echo 'GARMIN_EMAIL=their_email' >> .env
echo 'GARMIN_PASSWORD=their_password' >> .env
```

Consider using app-specific passwords if the user has 2FA enabled.

### Authentication

Once credentials are in `.env`, authenticate and save the session:

```bash
set -a; source .env 2>/dev/null; set +a; uv run - <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["garminconnect>=0.2.38"]
# ///
import os
from pathlib import Path
from garminconnect import Garmin

client = Garmin(os.environ["GARMIN_EMAIL"], os.environ["GARMIN_PASSWORD"], return_on_mfa=True)
result1, result2 = client.login()

if result1 == "needs_mfa":
    print("MFA_REQUIRED")
else:
    client.garth.dump("garmin-session")
    Path("garmin-session").chmod(0o700)
    print(f"SUCCESS: Logged in as {client.get_full_name()}")
EOF
```

If the output contains `MFA_REQUIRED`, ask the user for their MFA code, then run:

```bash
set -a; source .env 2>/dev/null; set +a; uv run - MFA_CODE_HERE <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["garminconnect>=0.2.38"]
# ///
import os, sys
from pathlib import Path
from garminconnect import Garmin

client = Garmin(os.environ["GARMIN_EMAIL"], os.environ["GARMIN_PASSWORD"], return_on_mfa=True)
result1, result2 = client.login()
client.resume_login(result2, sys.argv[1])

client.garth.dump("garmin-session")
Path("garmin-session").chmod(0o700)
print(f"SUCCESS: Logged in as {client.get_full_name()}")
EOF
```

Session is saved to `workspace/garmin-session/` and lasts ~1 year.

## Query Template

```bash
set -a; source .env 2>/dev/null; set +a; uv run - <<'EOF'
# /// script
# requires-python = ">=3.11"
# dependencies = ["garminconnect>=0.2.38"]
# ///
from datetime import date, timedelta
from pathlib import Path
from garminconnect import Garmin

TOKEN_DIR = Path("garmin-session")
if not TOKEN_DIR.exists():
    print("ERROR: Not authenticated — run Garmin setup first")
    exit(1)

client = Garmin()
client.login(str(TOKEN_DIR))

today = date.today().isoformat()

# === YOUR QUERY CODE HERE ===
stats = client.get_stats(today)
print(f"Steps: {stats.get('totalSteps', 0):,}")
EOF
```

## API Reference

### Health Methods

| Method | Description |
|--------|-------------|
| `get_stats(date)` | Daily summary (steps, calories, HR, stress durations) |
| `get_sleep_data(date)` | Sleep stages and scores |
| `get_heart_rates(date)` | Heart rate summary |
| `get_hrv_data(date)` | Heart rate variability |
| `get_stress_data(date)` | Stress levels (avg/max only, durations in get_stats) |
| `get_body_battery(start, end)` | Body battery readings |

### Activity Methods

| Method | Description |
|--------|-------------|
| `get_activities(start, limit)` | List recent activities |
| `get_activities_by_date(start, end)` | Activities in date range |
| `get_activity(id)` | Single activity details |
| `get_training_status(date)` | Training load and VO2 max |

**Note:** All dates use `"YYYY-MM-DD"` string format.

### Key Fields

**get_stats():** `totalSteps`, `totalDistanceMeters`, `totalKilocalories`, `activeKilocalories`, `floorsAscended`, `restingHeartRate`, `minHeartRate`, `maxHeartRate`, `averageStressLevel`, `maxStressLevel`, `lowStressDuration`, `mediumStressDuration`, `highStressDuration`, `restStressDuration`, `bodyBatteryChargedValue`, `bodyBatteryDrainedValue`

**get_sleep_data():** Access via `data.get("dailySleepDTO", {})`: `sleepTimeSeconds`, `deepSleepSeconds`, `lightSleepSeconds`, `remSleepSeconds`, `awakeSleepSeconds`. Scores via `dailySleepDTO.sleepScores.overall.value`

**get_hrv_data():** `weeklyAvg`, `lastNightAvg`, `lastNight5MinHigh`, `status`, `baseline.balancedLow`, `baseline.balancedUpper`

**get_activities():** `activityId`, `activityName`, `activityType.typeKey`, `startTimeLocal`, `duration`, `distance`, `calories`, `averageHR`, `maxHR`, `elevationGain`, `averageSpeed`

## Examples

These show non-obvious response structures. For straightforward methods, use the API reference above.

### Sleep (nested structure)

```python
sleep = client.get_sleep_data(today)
daily = sleep.get("dailySleepDTO", {})
if daily:
    total_h = daily.get("sleepTimeSeconds", 0) / 3600
    deep_h = daily.get("deepSleepSeconds", 0) / 3600
    rem_h = daily.get("remSleepSeconds", 0) / 3600
    print(f"Sleep: {total_h:.1f}h (deep {deep_h:.1f}h, REM {rem_h:.1f}h)")
    score = daily.get("sleepScores", {}).get("overall", {}).get("value")
    print(f"Score: {score}/100")
```

### Training Status (deeply nested by device)

```python
ts = client.get_training_status(today)
if ts:
    vo2 = ts.get('mostRecentVO2Max', {}).get('generic', {})
    print(f"VO2 Max: {vo2.get('vo2MaxPreciseValue', 'N/A')}")

    status_data = ts.get('mostRecentTrainingStatus', {}).get('latestTrainingStatusData', {})
    if status_data:
        device_id = list(status_data.keys())[0]
        device = status_data[device_id]
        print(f"Status: {device.get('trainingStatusFeedbackPhrase')}")
        acute = device.get('acuteTrainingLoadDTO', {})
        print(f"Load: {acute.get('dailyTrainingLoadAcute')} (ACWR: {acute.get('acwrStatus')})")
```

### Stress (durations are in get_stats, not get_stress_data)

```python
stats = client.get_stats(today)
stress_data = client.get_stress_data(today)
print(f"Avg stress: {stress_data.get('avgStressLevel')}/100")
# Duration fields are in get_stats(), not get_stress_data()
rest_min = stats.get("restStressDuration", 0) / 60
low_min = stats.get("lowStressDuration", 0) / 60
print(f"Rest: {rest_min:.0f}min, Low: {low_min:.0f}min")
```

## Quick Reference

```python
# Unit conversions
distance_km = activity.get("distance", 0) / 1000
duration_min = activity.get("duration", 0) / 60
speed_kmh = activity.get("averageSpeed", 0) * 3.6
sleep_hours = daily.get("sleepTimeSeconds", 0) / 3600

# Pace calculation
if activity.get("distance", 0) > 0:
    pace = (activity["duration"] / 60) / (activity["distance"] / 1000)
    print(f"Pace: {int(pace)}:{int((pace % 1) * 60):02d}/km")
```

## Re-authentication

If queries fail with auth errors, the session has expired. Re-run the authentication flow above. If the user's password changed, ask for the new one and update `.env`.

## Debugging

If a method call fails or you're unsure what's available, introspect:

```bash
uv run -c "from garminconnect import Garmin; print([m for m in dir(Garmin) if not m.startswith('_')])"
```

For full library docs: `webfetch https://github.com/cyberjunky/python-garminconnect`

## Troubleshooting

- **"Not authenticated"**: Run the authentication flow from the Setup section
- **Session expired**: Re-run authentication (sessions last ~1 year)
- **Rate limiting (429)**: Add `time.sleep(0.5)` between requests
- **Field is None**: Some metrics require specific Garmin devices
- **MFA issues**: User may need to check email or authenticator app for the code
