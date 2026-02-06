---
name: playwright
description: "Render web pages with JavaScript using Playwright for sites that need browser rendering or have issues with simple HTTP fetching."
---

# Playwright Skill

Use Playwright to render JavaScript-heavy websites, take screenshots, and extract content that regular HTTP fetching can't handle.

## Installation

Playwright will be installed automatically via uv dependencies, but you may need to install browsers:

```bash
# Install browsers (run once)
playwright install chromium
# Or for all browsers
playwright install
```

## Core Operations

### Basic Page Rendering

```bash
uv run - "https://example.com" <<'EOF'
# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright>=1.0", "beautifulsoup4>=4.0"]
# ///

import sys
from playwright.sync_api import sync_playwright

if len(sys.argv) < 2:
    print("Usage: script <url>")
    sys.exit(1)

url = sys.argv[1]
print(f"🎭 Rendering: {url}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    try:
        # Navigate and wait for page to load
        page.goto(url, wait_until='networkidle')

        # Get basic info
        title = page.title()
        content = page.content()

        print(f"✅ Page loaded successfully")
        print(f"📄 Title: {title}")
        print(f"📏 Content length: {len(content)} characters")
        print(f"🔗 Final URL: {page.url}")

        # Extract and clean text content
        text_content = page.evaluate("""
            () => {
                // Remove script and style elements
                const scripts = document.querySelectorAll('script, style, nav, header, footer');
                scripts.forEach(el => el.remove());

                // Get main content
                const main = document.querySelector('main, article, .content, .post, .entry') || document.body;
                return main.innerText || document.body.innerText;
            }
        """)

        # Clean and limit output
        clean_text = '\n'.join(line.strip() for line in text_content.split('\n') if line.strip())

        print(f"\n📝 EXTRACTED CONTENT:")
        print("=" * 80)
        print(clean_text[:3000])  # First 3000 chars
        if len(clean_text) > 3000:
            print(f"\n... (truncated, full content is {len(clean_text)} characters)")

    except Exception as e:
        print(f"❌ Error loading page: {e}")
    finally:
        browser.close()
EOF
```

### Take Screenshot

```bash
uv run - "https://example.com" "screenshot.png" <<'EOF'
# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright>=1.0"]
# ///

import sys
from playwright.sync_api import sync_playwright
from pathlib import Path

if len(sys.argv) < 2:
    print("Usage: script <url> [output_file]")
    sys.exit(1)

url = sys.argv[1]
output_file = sys.argv[2] if len(sys.argv) > 2 else "screenshot.png"

print(f"📸 Taking screenshot of: {url}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    # Set viewport size
    page.set_viewport_size({"width": 1280, "height": 720})

    try:
        page.goto(url, wait_until='networkidle')

        # Take full page screenshot
        page.screenshot(path=output_file, full_page=True)

        # Get file size
        file_size = Path(output_file).stat().st_size
        print(f"✅ Screenshot saved: {output_file} ({file_size:,} bytes)")
        print(f"📄 Page title: {page.title()}")

    except Exception as e:
        print(f"❌ Error taking screenshot: {e}")
    finally:
        browser.close()
EOF
```

## Debugging

If a method call fails or you're unsure what's available on the page object, introspect it:

```bash
uv run -c "from playwright.sync_api import Page; print([m for m in dir(Page) if not m.startswith('_')])"
```

For full library docs, fetch the README:

```
webfetch https://github.com/microsoft/playwright-python
```

## Usage Patterns

1. **When webfetch fails**: Use basic rendering for JavaScript sites
2. **Screenshots**: Visual documentation or debugging
3. **Dynamic content**: Add `page.wait_for_timeout(ms)` for slow-rendering JS

Use this when the built-in `webfetch` tool encounters:
- JavaScript-only content
- Dynamic loading
- Complex single-page applications
