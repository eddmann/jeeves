---
name: reminders
description: Manage reminders — one-off and recurring. Use when the user says "remind me", "set a reminder", "what reminders do I have", "cancel that reminder", or needs time-based nudges. Wraps the cron system with history and categories.
---

# Reminders

Thin wrapper around the cron `at`/`cron` system. SQLite stores metadata, history, and categories. Cron handles actual delivery.

## Creating a Reminder

Two steps — database record + cron job:

### Step 1: Record in database

```bash
echo '{"text": "Take out the bins", "due": "2026-03-02T10:00:00Z", "category": "home"}' | uv run workspace/skills/reminders/scripts/create.py
```

Fields:
- `text` (required): What to remind about
- `due` (required): ISO 8601 datetime
- `recurring` (optional): `"daily"`, `"weekly"`, or cron expression. Omit for one-off.
- `category` (optional): For grouping — `home`, `health`, `work`, etc.

### Step 2: Create the cron job

Use the cron tool to create the actual job:
- **One-off:** `schedule_type: "at"`, `schedule_value: <due>`, `delete_after_run: true`
- **Daily:** `schedule_type: "cron"`, `schedule_value: "M H * * *"`
- **Weekly:** `schedule_type: "cron"`, `schedule_value: "M H * * D"`

The cron message should include: "Reminder: {text}. Then run: `uv run workspace/skills/reminders/scripts/fired.py {id}`"

### Step 3: Link the cron job ID

```bash
echo '{"reminder_id": 1, "cron_job_id": "abc123"}' | uv run workspace/skills/reminders/scripts/link.py
```

## When a Reminder Fires

The cron message tells you to run `fired.py`:

```bash
uv run workspace/skills/reminders/scripts/fired.py 1
```

- One-off: marks as `fired`
- Recurring: updates `due` to next occurrence, keeps status `pending`

For recurring daily reminders (e.g. bins), after firing and delivering, the cron system handles the next run automatically.

## Listing Reminders

```bash
uv run workspace/skills/reminders/scripts/list.py              # pending
uv run workspace/skills/reminders/scripts/list.py history       # fired/cancelled
uv run workspace/skills/reminders/scripts/list.py all           # everything
uv run workspace/skills/reminders/scripts/list.py category home # by category
```

## Cancelling

```bash
uv run workspace/skills/reminders/scripts/cancel.py 1
```

Then also remove the cron job: `cron remove <cron_job_id>`

## Examples

**One-off:** "Remind me to call the dentist tomorrow at 9"
1. `create.py` with due=tomorrow 09:00
2. Cron `at` job for tomorrow 09:00
3. `link.py` to connect them

**Daily:** "Remind me to take out the bins at 10am every day"
1. `create.py` with due=tomorrow 10:00, recurring="daily"
2. Cron job with expr "0 10 * * *"
3. `link.py` to connect them

**Errand reminder:** "Remind me in 3.5 hours to pick up groceries"
1. `create.py` with due=now+3.5hrs, category="home"
2. Cron `at` job
3. `link.py` to connect them
