# Douyin User Video Scraper

Scrape all videos from a Douyin (TikTok China) user's profile page.

## Key Finding

**The `a_bogus` signature is NOT required** when you have complete login cookies. The cookie-based authentication chain (`__ac_nonce` + `__ac_signature` + `passport_csrf_token` + `passport_assist_user` + `bd_ticket_guard_*`) substitutes for the JSVMP-protected signature parameter.

## Approaches

| File | Method | Pros | Cons |
|------|--------|------|------|
| `douyin_protocol.py` | CDP extracts cookies once → Python requests | Fast, no browser needed after extraction | Cookies expire (hours) |
| `douyin_user_videos.py` | CDP calls API from browser context | Always works while logged in | Slower, browser must stay open |

## Usage

```bash
# 1. Open Chrome with debug port
chrome --remote-debugging-port=9222

# 2. Log into douyin.com manually

# 3. Run (replace sec_user_id)
python douyin_protocol.py
```

## Result

Successfully scraped **360 videos** with descriptions, likes, comments, shares, and video URLs.

## Technique

- CDP (Chrome DevTools Protocol) WebSocket connection
- Cookie extraction via `Network.getCookies`
- Pure `requests` for all API calls after initial cookie extraction
- Auto-retry with cookie refresh on expiration
- Deduplication by aweme_id and cursor cycle detection
