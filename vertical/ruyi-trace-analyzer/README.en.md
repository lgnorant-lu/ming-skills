<div align="center">

<img src="https://raw.githubusercontent.com/LoseNine/Firefox-FingerPrint-Analyzer/main/icon.png" width="96" height="96" alt="Ruyi Trace" />

# 如意 Trace · Ruyi Trace

[🇨🇳 简体中文](./README.md) &nbsp;|&nbsp; [**🇬🇧 English**](./README.en.md)

A research-grade, instrumented Firefox build for fingerprint risk-control analysis and one-click AI-assisted JavaScript reverse-engineering.

![Platform](https://img.shields.io/badge/platform-Windows%20x64-blue)
![Firefox](https://img.shields.io/badge/firefox-DOMTrace-orange)
![License](https://img.shields.io/badge/license-MPL--2.0-green)
![Status](https://img.shields.io/badge/status-research-yellow)

</div>

---

### What is this?

**Ruyi Trace** is a research-grade desktop tool for analysing **website fingerprinting risk-control strategies** and **assisting academic JavaScript reverse engineering**. It consists of:

1. **The Ruyi custom trace engine** (bundled in `firefox/`).
2. **An Electron desktop client** (`RuyiTrace.exe`) — one-click launcher for capture, log management and integrity verification.

> ⚠️ **For academic research, security education and defensive analysis only.** Do not use it to bypass any service's terms of use.

### Core value proposition

> **ruyiPage maps the site → Ruyi Trace records the runtime → hand the log to an AI → receive a working `补环境` script and a fingerprint risk-control report.**

Because instrumentation lives in the **C++ engine**, page-side JavaScript cannot detect the listener through prototype walks, `toString` sniffing, or known hook signatures. The collected trace is therefore a high-fidelity baseline for studying fingerprinting strategies.

### Recommended workflow

1. **Start with the [ruyiPage](https://github.com/LoseNine/ruyipage) automation framework, using the matching fingerprint Firefox browser bundled in its Release**, to analyse the target site — collect every JS file the site loads and capture the full network packet trace, so you have the overall outline of the site.
2. **Then use this tool (Ruyi Trace) to actually visit the site with the custom Firefox**, producing an NDJSON runtime call log.
3. **Hand the log directly to an AI** along with the JS files / packets from step 1, and let it locate the relevant files, build environment-replication code and analyse the fingerprinting risk-control logic.

### Quick start

1. **Keep the directory structure intact**: `RuyiTrace.exe` must sit next to the `firefox/` subdirectory.
2. **Double-click `RuyiTrace.exe`.**
3. In the window:
   - Set the **start URL** (default `https://xjbedu.site/`)
   - Choose a **log directory** (default `<exe-dir>/log`)
   - Confirm the top **build badge** is green (`定制内核已就绪`).
4. Click **开始采集** (Start) — the bundled Firefox launches, the timer begins counting.
5. Browse / drive the target page as you wish.
6. Click **停止采集** (Stop). Logs are saved as `trace_<unix-ms>_<pid>.ndjson`.
7. Click **打开目录** (Open folder) to retrieve the files.

### Hand the log to an AI

NDJSON, one event per line:

```json
{
  "t": "call",
  "api": "CanvasRenderingContext2D.fillText",
  "args": ["BrowserLeaks,com", 4, 17],
  "stack": [
    {"file": "https://example.test/fp.js", "line": 42, "col": 17}
  ]
}
```

**Recommended AI prompt template:**

```
You are a front-end security researcher. I have already done the following
preparation:
1. Used the ruyiPage automation framework
   (https://github.com/LoseNine/ruyipage) — together with the matching
   fingerprint Firefox browser shipped in its Release — to analyse the
   target website, collecting every JS file the site loads and capturing
   the full network packet trace, so I already have the overall outline
   of the site.
2. Then used Ruyi Trace to capture a complete runtime DOM / JS API call
   log (NDJSON).

Now I am handing this runtime log directly to you. Combined with the JS
files / network packets from step 1, please:
1. Identify every fingerprint collection point in the NDJSON
   (Canvas / WebGL / WebRTC / Audio / Navigator / Screen / Crypto), and
   pinpoint which JS file and which function each one lives in.
2. Reconstruct the full call chain and entry script of each fingerprint
   function.
3. Output a JavaScript "environment replication" template so a headless
   runner produces the same outputs as a real browser.
4. List the fingerprint risk-control strategies the site employs and
   prioritise countermeasures.

[paste NDJSON here]
```

Pasted into ChatGPT / Claude / Gemini you typically get back:
- 📊 A **fingerprint risk-control report**
- 🛠️ A working **environment-replication JavaScript template**
- 🔍 A reconstructed **JS call graph** from entry points down to native APIs.

### Folder layout

```
RuyiTrace/                  (~ 427 MB)
├── RuyiTrace.exe           Electron client (~ 87 MB)
├── README.md               this document
└── firefox/                Ruyi custom trace engine (~ 340 MB)
    ├── firefox.exe
    ├── RUYI_DOMTRACE.txt   ← integrity sentinel — do not delete
    └── ... DLLs / resources
```

### Advanced — running Firefox manually

```cmd
set MOZ_DOM_TRACE=1
set MOZ_DOM_TRACE_FILE=D:\logs\trace.ndjson
set MOZ_DISABLE_LAUNCHER_PROCESS=1
firefox\firefox.exe -no-remote -new-instance https://example.com
```

| Variable | Purpose |
|----------|---------|
| `MOZ_DOM_TRACE=1` | Enable tracing |
| `MOZ_DOM_TRACE_FILE=<path>` | Output path; PID is appended automatically |
| `MOZ_DOM_TRACE_LIMIT=<n>` | Per-process line cap |
| `MOZ_DOM_TRACE_PTYPE=<list>` | Comma-separated process types (auto-propagated) |
| `MOZ_DISABLE_LAUNCHER_PROCESS=1` | Required on Windows to keep PID stable |

### FAQ

**Q: Why not Puppeteer / Playwright?**
A: They inject JavaScript hooks that page scripts can detect (`toString`, prototype walks, `navigator.webdriver`, etc.). Ruyi Trace instruments at the C++ layer and is invisible from JavaScript.

**Q: The log files are huge — what now?**
A: A single session can produce hundreds of megabytes. The recommended approach is **chunked / segmented reading**: split the NDJSON by lines (e.g. 50k–100k lines per chunk) and feed the chunks to the AI sequentially. Additionally: (1) keep sessions short and focused, (2) cap per-process lines via `MOZ_DOM_TRACE_LIMIT`, (3) restrict captured process types via `MOZ_DOM_TRACE_PTYPE`.

**Q: The build badge is red.**
A: It means the selected `firefox.exe` does not have a `RUYI_DOMTRACE.txt` sentinel next to it — most likely you are pointing at stock Firefox. Make sure `RuyiTrace.exe` and the `firefox/` folder live together.

**Q: Are HTTPS / Service Worker / Web Worker calls captured?**
A: Yes. `MOZ_DOM_TRACE_PTYPE` is auto-forwarded to all child processes.

### Disclaimer

This project modifies Mozilla Firefox source code (MPL-2.0). Distributed binaries do **not** carry Mozilla branding. This project is **not affiliated with the Mozilla Foundation** and does not represent any official Mozilla position. "Mozilla" and "Firefox" are registered trademarks of the Mozilla Foundation.

Any consequence arising from your use of this tool is your sole responsibility. Comply with the laws of your jurisdiction and the target site's terms of service.

---

<div align="center">
<sub>如意 · 心想事成 — Ruyi · "as you wish"</sub><br/>
<sub>Built for researchers, by researchers.</sub>
</div>
