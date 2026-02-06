---
name: web-search
description: "Search the web and summarize content. Use the webfetch tool to retrieve and read web pages, documentation, and articles."
---

# Web Search Skill

Use the `webfetch` tool to retrieve web content.

## Search Workflow

1. Use `bash` to search with `curl` and a search engine, or construct a known URL
2. Use `webfetch` to retrieve the page content
3. Summarize or extract the relevant information

## Tips

- For documentation, try constructing the URL directly (e.g., `https://docs.example.com/topic`)
- The tool extracts readable text from HTML using Readability
- Content is truncated to 10,000 characters
- For non-HTML content (JSON, plain text), raw content is returned

## Examples

Fetch documentation:
```
webfetch({ url: "https://bun.sh/docs/runtime/modules" })
```

Fetch and summarize an article:
```
webfetch({ url: "https://example.com/blog/interesting-post" })
```
