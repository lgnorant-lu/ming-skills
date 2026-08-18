# 欧冶 (Ouyeel) — 工业钢材交易数据爬取

Scrape steel trading data from ouyeel.com, a Chinese B2B steel trading platform.

## Target

- **URL:** https://www.ouyeel.com/xhb/
- **Anti-bot:** 瑞数 (Ruishu) 6 — Chinese advanced anti-bot protection
- **Data:** Steel product listings, pricing, specifications

## Ruishu Bypass Technique

```
Step 1: First request → 202 status + Ruishu JS challenge
        ↓
Step 2: Parse HTML → extract 3 dynamic elements:
        - meta content (server-generated challenge token)
        - inline TS script (Ruishu core JS snippet)  
        - auto.js URL (Ruishu main JS file)
        ↓
Step 3: Replace auto.js locally → strip anti-debug/detection code
        (see 替换文件/ directory)
        ↓
Step 4: 补环境 → Node.js executes modified JS → generates 202 cookie (443T/443S)
        ↓
Step 5: Second request with generated cookie → 200 OK + real data
```

## Key Insight

The Ruishu protection uses a 3-step flow:
1. **202** → Server sends encrypted JS challenge
2. **JS execution** → Browser runs JS to compute verification params
3. **Cookie validation** → Server checks `443T`/`443S` cookies + URL suffix

If you don't execute its JS, you can't get valid request parameters — the server will always reject.

## Files

| File | Purpose |
|------|---------|
| `请求.py` | Main scraper — 2-phase request, HTML parsing, MySQL storage |
| `最终动态环境.js` | Final 补环境 template — dynamically injects meta/ts/auto content |
| `01_env.js` | Browser environment stubs for Node.js |
| `02_ts.js` | Ruishu TS script handler |
| `main.js` | Node.js entry point |
| `替换文件/` | Override files — auto.js with anti-debug removed |

## Tech Stack

- Python: `requests`, `execjs`, `lxml`, `pymysql`, `loguru`
- Node.js: 补环境 (browser environment simulation)
- Database: MySQL
- Anti-bot: Ruishu 6 bypass via file replacement + dynamic cookie generation
