---
name: web-reverse-master
description: Web逆向大师 — Web逆向工程的综合技能集
description_zh: |
  Web逆向大师 — Web逆向工程的综合技能集
  Web/JS 逆向全流程编排器（Phase 0-4）。负责完整的逆向分析工作流：情报收集→流量分析→加密定位→方案制定→代码还原。
  独占能力：SM2/SM4 国密、瑞数/Akamai Cookie、Protobuf/gRPC、DH/ECDH 密钥交换、HMAC/ECDSA 签名、CDP 桥架构、反反爬完整策略、watch() Proxy 诊断、env_diff 环境对比。
  当用户需要完整的逆向分析流程（抓包+定位+Hook+调试）时使用。
  当用户仅需要验证码求解/加密参数生成/补环境生成时，优先调用专业 Skill：captcha-solver / param-encryptor / env-patcher。
  触发词：「逆向」「分析」「调试」「反爬」「破解」「抓包」「协议还原」「reverse engineer」。
---

# Web Reverse Master

Use this skill for authorized Web/JS reverse-engineering tasks. Keep the main workflow evidence-driven: collect traffic, identify the exact parameter or behavior, prove the algorithm or browser dependency, then implement a small reproducible deliverable with tests.

## Scope And Boundaries

- Work only on systems the user is authorized to test, their own applications, public learning targets, or defensive/debugging research.
- Do not help with account abuse, bypassing access control, credential theft, mass scraping, stealth evasion against a third-party service, or defeating a production anti-abuse system. Reframe those requests into defensive analysis, instrumentation, rate-limit design, or compliance-safe debugging.
- Treat every algorithm claim as unconfirmed until backed by source location, hook output, browser sample, or reproducible local test.
- If the target is a real third-party site, finish Phase 3 with a plan and ask for user confirmation before writing Phase 4 production code.

## Tool Invocation Contract

Follow this contract before using any tool name mentioned by this skill or its references.

- **Only call tools that are actually present in the active tool list for the current session.** Skill text, examples, and reference docs do not make a tool callable.
- Treat `adspower-browser`, `js-reverse-mcp`, `reqable-mcp`, and `ida-pro-mcp` as **optional external MCP examples** unless the current environment explicitly exposes matching tools.
- If a referenced MCP is absent, do not invent calls, aliases, JSON tool names, or shell wrappers for it. Use the fallback route: browser DevTools, HAR export, local scripts, or `scripts/cdp_bridge.py` with a user-provided CDP WebSocket.
- Before using a live browser/control tool, state which route is active: Route A, Route B, Route C, or No MCP. Keep all subsequent browser actions inside that route.
- Never assume cookies, localStorage, breakpoints, console logs, or network requests transfer between AdsPower, Chrome DevTools, `js-reverse-mcp`, and a CDP bridge. Export/import the exact artifact if switching routes.
- Treat package installs and network-dependent tools (`curl_cffi`, `webcrack`, `grpcio-tools`, `mitmproxy`, `websocket-client`) as external dependencies. Verify availability first; request installation only when the user approves and the environment permits it.
- Prefer bundled offline scripts for deterministic work: `new_project.py`, `deobfuscate_strings.py`, `verify_crypto.py`, `compare_env.py`, `cdp_bridge.py`, and `selftest.py`.

## Default Workflow

1. **Phase 0 - Recon**: identify framework, entry URL, visible scripts, known public docs, and whether fingerprint-safe browsing is required.
2. **Phase 1 - Traffic**: capture the target request and record method, URL, headers, cookies, query/body, response, and trigger action.
3. **Phase 2 - Locate**: save relevant JS locally, search for parameter names, hook request writers or crypto functions, and record the call chain.
4. **Phase 3 - Plan**: list confirmed facts, unverified assumptions, deliverables, tests, and risks. Mark all guesses as `待验证`.
5. **Phase 4 - Reproduce**: implement the smallest local signer/decrypter/driver, then compare browser output and local output byte-for-byte.

## Route Selection

- **Route A: fingerprint-safe browser only**: use AdsPower/manual browser + console/evaluate hooks when the target has browser fingerprint checks and breakpoint debugging is unnecessary.
- **Route B: debug browser only**: use Chrome DevTools or `js-reverse-mcp` when source search, breakpoints, and call stacks matter more than fingerprint protection.
- **Route C: CDP bridge**: use a fingerprint-safe browser with a CDP WebSocket when the logic is fragile, frequently changing, or easier to run inside the real page.
- **No MCP available**: use browser DevTools Network/Sources, HAR export, local script downloads, and the bundled scripts below.

Default to **No MCP available** unless the active session exposes a matching callable tool. Do not mix browser instances as if they share cookies, localStorage, or page state. If moving between tools, explicitly export/import the needed cookies, headers, scripts, or samples.

## Deliverable Matrix

> 以下脚本是项目配套工具示例，非 Skill 必需。在其他项目中使用时，如不存在对应脚本，可根据方法论手动完成等效操作。

Every task should end with at least one concrete artifact and one verification path.

| Logic | Deliverable | Verification |
|---|---|---|
| Project setup | `scripts/new_project.py` scaffold | `python scripts/selftest.py --case scaffold` |
| Network/request hooks | `scripts/hooks/network.js` | `node --check scripts/hooks/network.js` and captured `window.__webReverseLogs` |
| Cookie/header hooks | `scripts/hooks/cookie_header.js` | `node --check scripts/hooks/cookie_header.js` and browser capture sample |
| Crypto hooks | `scripts/hooks/cryptojs.js` | `node --check scripts/hooks/cryptojs.js` and browser sample |
| String-table deobfuscation | `scripts/deobfuscate_strings.py` | `python scripts/selftest.py --case deobfuscate` |
| AST cleanup | `scripts/deobfuscate_ast.js` | `node --check scripts/deobfuscate_ast.js`; run only after Babel deps exist |
| Browser env diff | `scripts/env_diff.js` + `scripts/compare_env.py` | `python scripts/selftest.py --case env` |
| Local crypto parity | `scripts/verify_crypto.py` | `python scripts/selftest.py --case verify` |
| CDP execution | `scripts/cdp_bridge.py` | `python scripts/selftest.py --case cdp` |

Run the full offline suite before handing off changes:

```powershell
python scripts/selftest.py
```

## Bundled Resources

> 以下参考文件位于本 Skill 的 `references/` 子目录中。在其他项目中使用时，这些文件不存在不影响核心工作流，但会缺少配方细节。Load only the reference file needed for the current case:

- `references/01-workflow.md`: detailed Phase 0-4 procedure and plan template.
- `references/02-recipes-signature.md`: MD5/SHA, AES, RSA, WASM, TLS, Base64 variants, SM2/SM4, h5st, a_bogus, HMAC/ECDSA, protobuf, DH/ECDH, xxhash/murmurhash.
- `references/03-recipes-captcha.md`: slider, click/rotate/arithmetic captcha research and CDP-driven interaction.
- `references/04-deobfuscation.md`: string table recovery, control-flow flattening, JSVMP analysis, AST pipeline.
- `references/05-env-patching.md`: browser environment patching, Proxy diagnostics, Canvas/WebGL/AudioContext, module layout.
- `references/06-project-cases.md`: historical case patterns. Treat `sites/...` paths as examples unless present in the current workspace.
- `references/07-anti-patterns.md`: mistakes to check when stuck.
- `references/08-tool-reference.md`: AdsPower, js-reverse-mcp, reqable, CDP, and fallback tool commands.
- `references/09-external-tools.md`: external tools and libraries.

## Implementation Rules

- Prefer local JS files and deterministic scripts over repeated browser probing.
- Hook before page load when the target creates closed-over `fetch`, `XMLHttpRequest`, `axios`, crypto, or cookie helpers during bootstrap.
- Capture at least two browser samples when timestamps, nonces, random IVs, or session keys may vary.
- Verify exact bytes, encoding, parameter order, padding, mode, IV, and key source before claiming parity.
- Use `curl_cffi` or a real browser session only when ordinary HTTP clients fail for TLS or header fingerprint reasons.
- Keep generated code small: `build_context()`, `build_payload()`, `sign()` or `encrypt()`, `submit()` and a parity test are usually enough.
- If a hook fails once, change the method: source search, breakpoint, CDP bridge, request writer hook, or local deobfuscation.

## Common Commands

> 以上命令需项目内存在对应脚本。如不存在，可根据方法论手动完成等效操作。

```powershell
# Create a case workspace
python scripts/new_project.py demo --url https://example.test --type sign --output-dir .\work

# Compare browser and local outputs
python scripts/verify_crypto.py --browser-output browser.txt --local-output local.txt

# Decode simple _0x string tables
python scripts/deobfuscate_strings.py input.js output.js

# Compare browser and patched environment captures
python scripts/compare_env.py browser_env.json patched_env.json

# Run offline delivery tests
python scripts/selftest.py
```

---

## Phase Mapping

本 Skill 在 CLAUDE.md Phase 0-4 工作流中的完整覆盖：

| Phase | 本 Skill 的角色 | 与专业 Skill 的协作 |
|-------|----------------|-------------------|
| Phase 0 情报收集 | ✅ 全权负责：搜索技术文档 + GitHub 仓库 + 分析防护特征 | — |
| Phase 1 流量分析 | ✅ 全权负责：路线 A/B/C 选择 + 流量捕获 + 参数识别 | 路线 C 参考 `env-patcher` CDP 桥 |
| Phase 2 定位加密 | ✅ 统筹协调：Hook 定位 + 源码搜索 + 调用栈追踪 | 加密函数定位后转交 `param-encryptor`；混淆代码转交 `ast-deobfuscation` |
| Phase 3 方案制定 | ✅ 全权负责：产出 Plan + 用户确认 | 方案中需补环境时引用 `env-patcher` 模板；需验证码时引用 `captcha-solver` |
| Phase 4 代码还原 | ✅ 统筹协调：signer.py / main.py 整合 | 签名/加密实现转交 `param-encryptor`；补环境脚本转交 `env-patcher`；验证码模块转交 `captcha-solver` |

**典型调度链：**
```
web-reverse-master Phase 2 定位到 CryptoJS.AES.encrypt
  → param-encryptor Step 3-4 导出样本 + 匹配配方
  → web-reverse-master Phase 3 整合 Plan
  → param-encryptor Step 5 产出 signer.py
  → web-reverse-master 集成到 main.py
```

---

## 分阶段手动模式（原 web-reverse-workflow · 分步推进时用）

需要一步步分阶段推进（而非本 Skill 的一次性全流程）时，按当前状态路由到对应子技能：

| 当前状态 | 调用 |
|---|---|
| 不知道怎么开始 / 还没定路线 | `web-reverse-brainstorming` |
| 路线已定，要拆步骤 | `web-reverse-writing-plans` |
| 已有计划，逐条执行 | `web-reverse-executing-plans` |
| 进入复现编码（sign/token/encrypt） | `web-reverse-test-driven-development` |
| 结果不一致 / Hook 不生效 / 漂移 | `web-reverse-systematic-debugging` |
| 只需验证码/签名/补环境/反混淆 | 对应专业 Skill（见下表） |

铁律：先判断阶段再动手；阶段判错后面全跑偏；不要同时把多个相邻阶段技能当一个用。

## Related Skills

| Skill | 职责 | 何时调用 |
|-------|------|---------|
| `captcha-solver` | 验证码纯协议求解 | 用户需要识别+轨迹+加密提交+获取ticket |
| `param-encryptor` | 加密参数生成 | 用户需要生成已知算法的签名/密文 |
| `env-patcher` | 浏览器环境补丁 | 用户需要生成 browser.js 补环境脚本 |
| `ast-deobfuscation` | JS 反混淆 | 用户需要还原 `_0x` / 控制流平坦化 / OB 变种 |
| `web-reverse-*`（brainstorming/writing-plans/executing-plans/test-driven-development/systematic-debugging） | 逆向分阶段子技能 | 见上「分阶段手动模式」路由表 |
