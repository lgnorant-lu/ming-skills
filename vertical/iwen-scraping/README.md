# iwen-scraping

> Web Scraping & JS Reverse Engineering Knowledge Base

A curated, battle-tested knowledge base covering the full spectrum of web scraping and JavaScript reverse engineering — from simple requests to JSVMP deobfuscation and browser automation.

⚡ **Powered by Claude Code Skills** — intelligent matching, on-demand reference loading, and automatic knowledge accumulation.

---

## What's Inside

### 🧠 Scraping Knowledge Base (12 files, 2000+ lines)

| Domain | Covers |
|--------|--------|
| **Encryption** | MD5/SHA/AES/DES/RSA/SM3/SM4, dynamic cookies, response decryption, WebSocket, JCE, Protobuf, Flutter |
| **Obfuscation** | OB deobfuscation, SoJSON, JSFuck, Webpack extraction, control flow flattening, 4-layer switch reversal, OLLVM |
| **Virtualization** | JSVMP 5-stage reversal flow, VMP-nested-VMP, WASM hook + WASM→C→DLL pipeline |
| **Anti-Bot** | Ruishu (202 cookie + 443T/443S), Cloudflare bypass, CDP remote debugging, modified Chromium |
| **Environment Patching** | 补环境 framework, RPC via WebSocket, Unidbg, frida-analykit TLS decryption |
| **CAPTCHA** | Font anti-crawling, 12 slider types, gradient analysis with ddddocr/vlm |
| **Automation** | DrissionPage 26 scripts, Hook techniques, Proxy monitoring |
| **Case Index** | 100+ real-world scraping cases across e-commerce, social media, finance, government |
| **Article Index** | 150+ curated articles from 吾爱破解 & 看雪论坛, tagged by technique |

### 🛠️ Project Showcase (27 projects)

#### Anti-Bot Bypass
| Project | Target | Technique |
|---------|--------|-----------|
| [nmpa-ruishu](projects/nmpa-ruishu/) | 国家药监局 | 瑞数反爬: JS替换+补环境+动态Cookie |
| [ouyeel-ruishu](projects/ouyeel-ruishu/) | 欧冶钢铁 | 瑞数6: meta/ts/js三级提取+替换 |
| [cailian-waf](projects/cailian-waf/) | 财联社 | WAF绕过+Webpack模块提取 |
| [qichacha-multi](projects/qichacha-multi/) | 企查查 | 三阶段递进: SHA256→Header加密→完整方案 |

#### Signature / Encryption
| Project | Target | Technique |
|---------|--------|-----------|
| [jingdong-h5st](projects/jingdong-h5st/) | 京东 | H5ST多层签名+DrissionPage双方案 |
| [xiaohongshu-scraper](projects/xiaohongshu-scraper/) | 小红书 | DP监听API+3种签名方案 |
| [kuaishou-sig3](projects/kuaishou-sig3/) | 快手 | __NS_sig3参数Webpack分析 |
| [douyin-user-videos](projects/douyin-user-videos/) | 抖音 | Cookie替代a_bogus签名💡 |
| [bilibili-wrid](projects/bilibili-wrid/) | B站 | w_rid参数MD5+execjs |
| [zhihu-xzse](projects/zhihu-xzse/) | 知乎 | x-zse-93+协议/DP双方案 |
| [youdao-translate](projects/youdao-translate/) | 有道翻译 | 5代JS加密迭代破解 |
| [heimao-sha256](projects/heimao-sha256/) | 黑猫投诉 | SHA256参数签名 |
| [diandian-aes](projects/diandian-aes/) | 点点数据 | AES-k参数逆向 |
| [netease-music](projects/netease-music/) | 网易云 | AES+RSA混合加密 |
| [cai-zhaowang](projects/cai-zhaowang/) | 采招网 | AES返回值解密 |
| [kuwo-music](projects/kuwo-music/) | 酷我音乐 | Webpack reqId AES加密 |
| [qiancheng-51job](projects/qiancheng-51job/) | 前程无忧 | sign值JS逆向 |

#### Font Anti-Crawling
| Project | Target | Technique |
|---------|--------|-----------|
| [boss-zhipin-font](projects/boss-zhipin-font/) | BOSS直聘 | ttf字体→ddddocr OCR |
| [maoyan-font](projects/maoyan-font/) | 猫眼电影 | woff→fontTools映射 |

#### Automation
| Project | Target | Technique |
|---------|--------|-----------|
| [ctrip-multi](projects/ctrip-multi/) | 携程 | 酒店/航班/景点多场景 |
| [lianjia-house](projects/lianjia-house/) | 链家 | DP自动化+数据预处理 |
| [weibo-auto](projects/weibo-auto/) | 微博 | DP自动化+数据分析 |
| [dongfangcaifu](projects/dongfangcaifu/) | 东方财富 | 多进程新闻搜索 |
| [weipu-journal](projects/weipu-journal/) | 维普期刊 | 协议+浏览器双方案 |
| [chanmama](projects/chanmama/) | 禅妈妈 | 抖音电商数据+5JS加密 |
| [tencent-comic](projects/tencent-comic/) | 腾讯动漫 | JS解密+img2pdf下载 |
| [12306-tickets](projects/12306-tickets/) | 12306 | JS解密余票+Cookie认证 |

---

## How It Works

```
You: "I need to scrape this website"
         ↓
Claude: Loads the skill → matches anti-bot type via quick-match table
         ↓
       Loads the right reference file → executes the solution
         ↓
       After project done → auto-updates the knowledge base
```

Each time a scraping project is completed, the skill automatically grows — recording what worked, what failed, and which articles to reference next time.

---

## Skill Architecture

```
skills/iwen-creative/
├── SKILL.md              ← Router: quick-match table + decision tree
└── references/
    ├── encryption.md     ← All encryption types
    ├── obfuscation.md    ← Code deobfuscation
    ├── virtualization.md ← JSVMP / WASM
    ├── anti-bot.md       ← Ruishu / CF / anti-debug
    ├── environment.md    ← 补环境 / RPC / CDP
    ├── captcha.md        ← Font / Slider / CAPTCHA
    ├── browser-tools.md  ← DrissionPage / Hook / Proxy
    ├── case-index.md     ← 100+ solved cases
    ├── article-index.md  ← 150+ article references
    ├── tools-resources.md← Tools & platforms
    └── troubleshooting.md← Pitfalls & debugging
```

**Design principle:** Progressive disclosure — only the matching reference files load into context, keeping overhead minimal (~300 lines per task).

---

## Usage

This skill is built for **Claude Code**. To use it:

1. Copy the `skills/iwen-creative/` directory to your project's `.claude/skills/`
2. Invoke with `/iwen-creative` when starting a scraping task
3. Claude automatically matches the target to the right solution and loads only the relevant files

---

## Key Techniques Demonstrated

- **Protocol-first approach**: Python requests > execjs > Node.js > 补环境 > RPC > Browser automation
- **JSVMP reversal**: 5-stage pipeline (locate VMP entry → AST deobfuscation → stack VM analysis → instruction mapping → code generation)
- **Cookie-based auth bypass**: Discovered that complete login cookies can substitute signature parameters (a_bogus) on Douyin
- **CDP remote control**: Use Chrome DevTools Protocol for cookie extraction and API calls without triggering anti-bot detection

---

## About

Built iteratively through real scraping battles. Each project adds to the knowledge base, making future projects faster and more reliable.

**Tech stack covered:** Python (requests, execjs, scrapy, DrissionPage), Node.js (补环境, crypto-js, babel/ast), Chrome DevTools Protocol, Frida, Unidbg
