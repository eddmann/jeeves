---
name: garmin
description: "Query Garmin Connect for activities, health metrics, training status, and device info."
---

# Garmin Connect Skill

Manage your Garmin Connect data using uv inline Python scripts with dependency declarations via heredoc.

## Environment Variables

Set these in your environment:

```bash
export GARMIN_EMAIL="your-garmin-email"
export GARMIN_PASSWORD="your-garmin-password"
```

**Note:** Garmin Connect uses email/password authentication. Consider using app-specific passwords if you have 2FA enabled.

## Core Operations

### Recent Activities

List recent activities:

```bash
uv run - <<'EOF'
# /// script
# requires-python = ">=3.12"
# dependencies = ["garminconnect>=0.2"]
# ///

import os
from garminconnect import Garmin

try:
    client = Garmin(os.environ['GARMIN_EMAIL'], os.environ['GARMIN_PASSWORD'])
    client.login()

    activities = client.get_activities(0, 10)  # Last 10 activities

    print("🏃 Recent Activities:")
    for activity in activities:
        date = activity['startTimeLocal'][:10]
        name = activity['activityName']
        activity_type = activity['activityType']['typeKey']
        distance = activity.get('distance', 0) / 1000 if activity.get('distance') else 0
        duration = activity.get('duration', 0) / 60 if activity.get('duration') else 0

        print(f"{date}: {name}")
        print(f"  Type: {activity_type}, Distance: {distance:.2f}km, Time: {duration:.1f}min")
        print()

except Exception as e:
    print(f"Error: {e}")
EOF
```

### Daily Health Snapshot

```bash
uv run - <<'EOF'
# /// script
# requires-python = ">=3.12"
# dependencies = ["garminconnect>=0.2"]
# ///

import os
from datetime import datetime, timedelta
from garminconnect import Garmin

try:
    client = Garmin(os.environ['GARMIN_EMAIL'], os.environ['GARMIN_PASSWORD'])
    client.login()

    today = datetime.now().date()

    # Get today's stats
    print(f"📱 Health Summary for {today}:")

    # Steps
    try:
        steps = client.get_steps_data(today.isoformat())
        if steps:
            daily_steps = steps.get('totalSteps', 0)
            step_goal = steps.get('dailyStepGoal', 10000)
            print(f"Steps: {daily_steps:,} / {step_goal:,} ({daily_steps/step_goal*100:.1f}%)")
    except Exception:
        print("Steps: Not available")

    # Heart rate
    try:
        hr_data = client.get_heart_rates(today.isoformat())
        if hr_data and hr_data.get('heartRateValues'):
            hr_values = [hr[1] for hr in hr_data['heartRateValues'] if hr[1] > 0]
            if hr_values:
                avg_hr = sum(hr_values) / len(hr_values)
                min_hr = min(hr_values)
                max_hr = max(hr_values)
                print(f"Heart Rate: {min_hr}-{max_hr} bpm (avg: {avg_hr:.0f})")
    except Exception:
        print("Heart Rate: Not available")

    # Sleep
    try:
        sleep = client.get_sleep_data(today.isoformat())
        if sleep:
            sleep_time = sleep.get('totalSleepTimeSeconds', 0) / 3600
            deep_sleep = sleep.get('deepSleepSeconds', 0) / 3600
            print(f"Sleep: {sleep_time:.1f}h (deep: {deep_sleep:.1f}h)")
    except Exception:
        print("Sleep: Not available")

    # Stress
    try:
        stress = client.get_stress_data(today.isoformat())
        if stress and stress.get('avgStressLevel'):
            stress_level = stress['avgStressLevel']
            print(f"Stress Level: {stress_level}")
    except Exception:
        print("Stress: Not available")

except Exception as e:
    print(f"Error: {e}")
EOF
```

## Debugging

If a method call fails or you're unsure what's available on the client object, introspect it:

```bash
uv run -c "from garminconnect import Garmin; print([m for m in dir(Garmin) if not m.startswith('_')])"
```

For full library docs, fetch the README:

```
webfetch https://github.com/cyberjunky/python-garminconnect
```

## Usage Pattern

When implementing Garmin Connect operations:

1. Use `uv run -` to run from stdin
2. Include proper inline script metadata with dependencies (garminconnect)
3. Pass arguments after the `-` if needed
4. Handle authentication carefully (email/password required)
5. Be aware of rate limits and API availability
6. Scripts run in memory without persisting to disk

**Security Note:** Store your Garmin credentials securely. Consider using app-specific passwords if you have two-factor authentication enabled.

The heredoc approach keeps everything ephemeral while still using proper uv inline script format.
