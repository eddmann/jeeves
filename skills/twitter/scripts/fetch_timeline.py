# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright>=1.0"]
# ///
"""Fetch recent tweets from your X/Twitter timeline. Returns JSON array of tweets."""
import json, sys
from playwright.sync_api import sync_playwright
from pathlib import Path

COOKIES_FILE = Path(__file__).parent.parent / "twitter-cookies.json"
COUNT = int(sys.argv[1]) if len(sys.argv) > 1 else 50

with open(COOKIES_FILE) as f:
    creds = json.load(f)

cookies = [
    {"name": "auth_token", "value": creds["auth_token"], "domain": ".x.com", "path": "/"},
    {"name": "ct0", "value": creds["ct0"], "domain": ".x.com", "path": "/"},
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport={"width": 1280, "height": 900}
    )
    context.add_cookies(cookies)
    page = context.new_page()

    try:
        page.goto("https://x.com/home", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        # Scroll to load more tweets
        tweets_data = []
        seen_texts = set()
        scroll_attempts = 0
        max_scrolls = 10

        while len(tweets_data) < COUNT and scroll_attempts < max_scrolls:
            tweet_els = page.query_selector_all('[data-testid="tweet"]')
            for tweet_el in tweet_els:
                try:
                    text = tweet_el.inner_text()
                    # Skip ads
                    if "Ad\n" in text[:50]:
                        continue
                    # Dedupe
                    preview = text[:100]
                    if preview in seen_texts:
                        continue
                    seen_texts.add(preview)

                    # Parse basic structure: first lines usually have author info
                    lines = [l.strip() for l in text.split("\n") if l.strip()]
                    author = lines[0] if lines else ""
                    handle = lines[1] if len(lines) > 1 and lines[1].startswith("@") else ""
                    # Find timestamp (contains "h", "m", "d", or date)
                    timestamp = ""
                    for l in lines:
                        if l in ("·",):
                            continue
                        if any(l.endswith(s) for s in ("h", "m", "d", "s")) and len(l) <= 4:
                            timestamp = l
                            break

                    # Content is everything after metadata
                    content_start = 3 if handle else 2
                    content = " ".join(lines[content_start:])

                    # Try to get links
                    links = []
                    link_els = tweet_el.query_selector_all("a[href]")
                    for link_el in link_els:
                        href = link_el.get_attribute("href") or ""
                        if href.startswith("https://t.co/") or (href.startswith("/") and "/status/" in href):
                            if "/status/" in href:
                                links.append(f"https://x.com{href}" if href.startswith("/") else href)

                    tweets_data.append({
                        "author": author,
                        "handle": handle,
                        "timestamp": timestamp,
                        "content": content[:500],
                        "links": links[:3],
                        "raw_preview": text[:400]
                    })
                except Exception:
                    continue

            if len(tweets_data) >= COUNT:
                break
            page.evaluate("window.scrollBy(0, 2000)")
            page.wait_for_timeout(2000)
            scroll_attempts += 1

        print(json.dumps({"count": len(tweets_data), "tweets": tweets_data[:COUNT]}))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
    finally:
        browser.close()
