---
name: lists
description: General-purpose lists — shopping, questions for appointments, packing lists, etc. Use when the user wants to create a list, add items, "shopping list", "questions for appointments", "what's on my list", or manages grouped items around a theme or event.
---

# Lists Skill

Themed lists with optional due dates and cron reminders. SQLite, pure Python stdlib.

Scripts in `workspace/skills/lists/scripts/`, database at `workspace/skills/lists/db/lists.sqlite`.

## First Run

```bash
uv run workspace/skills/lists/scripts/init_db.py
```

## Create a List

```bash
echo '{"name": "Appointment questions", "due": "2026-02-25", "notes": "10am appointment"}' | uv run workspace/skills/lists/scripts/create.py
echo '{"name": "Shopping"}' | uv run workspace/skills/lists/scripts/create.py
```

## Add Items

```bash
echo '{"list_id": 1, "text": "Ask about pricing"}' | uv run workspace/skills/lists/scripts/add.py
echo '{"list_id": 1, "items": ["Check availability", "Confirm address", "What to bring"]}' | uv run workspace/skills/lists/scripts/add.py
```

## Show a List

```bash
uv run workspace/skills/lists/scripts/show.py 1
```

Shows all items sorted: unchecked first, then checked. Includes total and unchecked counts.

## Check Off Items

```bash
uv run workspace/skills/lists/scripts/check.py 1 2 3          # check items by ID
echo '{"ids": [1, 2], "uncheck": true}' | uv run workspace/skills/lists/scripts/check.py  # uncheck
```

## Remove an Item

```bash
uv run workspace/skills/lists/scripts/remove.py 1
```

## Show All Lists

```bash
uv run workspace/skills/lists/scripts/lists.py                # active only
uv run workspace/skills/lists/scripts/lists.py all             # including archived
```

## Check What's Due

```bash
uv run workspace/skills/lists/scripts/due.py
```

Returns active lists due today or tomorrow with all items. Use in cron for reminders.

## Archive a List

```bash
uv run workspace/skills/lists/scripts/archive.py 1
```

Hides from active view. Data preserved.

## Reminders

For any reminders about due lists, use the **reminders skill**. The `due.py` script is available for on-demand checks ("what's coming up?").

## Quick Reference — What to Say

- "Create an appointment questions list for tomorrow" → `create.py`
- "Add to appointment list: ask about pricing" → `add.py`
- "Show appointment list" → `show.py`
- "Check that off" → `check.py`
- "What lists do I have?" → `lists.py`
- "What's coming up?" → `due.py`
- "Done with that list" → `archive.py`
- "Remind me about the shopping list tomorrow morning" → use reminders skill
