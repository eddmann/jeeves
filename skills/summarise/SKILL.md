---
name: summarise
description: Extract and summarise content from URLs, YouTube videos, podcasts, and files. Use when the user shares a link, asks "what's this about", "summarise this", wants a transcript, or references web/video/podcast content.
---

# Summarise Skill

Extract clean content or generate summaries from URLs, YouTube videos, podcasts, and files using `@steipete/summarize` via buns.

## Usage

```bash
buns run --allow-host="*" --allow-env="*" --memory=512 --timeout=120 workspace/skills/summarise/scripts/summarize.ts -- [FLAGS] "URL_OR_FILE"
```

## Extract Content (preferred)

Use `--extract` to get clean text, then summarise as the agent. This avoids a redundant LLM call.

```bash
# Web page or article
... -- --extract "URL"

# YouTube with timestamps
... -- --extract --timestamps "YOUTUBE_URL"
```

## Summarise via CLI

When content is very long and would use too many tokens, let summarize do it directly.

```bash
... -- "URL"                     # default xl summary
... -- --length short "URL"      # brief summary
```

## Tips

- **Prefer `--extract`** for most use cases — the agent can summarise in its own voice
- Use CLI summarisation (without `--extract`) for very long content to save tokens
- `--timestamps` adds time markers to YouTube/podcast transcripts
- `--json` returns structured output with metadata

## Troubleshooting

- **No transcript**: YouTube video may not have captions
- **Timeout**: Increase `--timeout` for long videos or slow sites
- **Model errors**: Check that the relevant API key env var is set (e.g. `ANTHROPIC_API_KEY`)
