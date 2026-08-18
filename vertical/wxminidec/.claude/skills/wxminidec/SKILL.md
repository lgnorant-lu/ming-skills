---
name: wxminidec
description: "Reverse engineer WeChat Mini Programs — decompile packages, analyze request signing, and build app-specific proxy adapters. Use when user mentions: 反编译小程序, 小程序逆向, 小程序签名, wxapkg 解包, 微信小程序抓包, mitmproxy 代理, 小程序加密分析, 小程序请求签名, decompile wechat app, wechat mini program reverse engineering."
---

# wxminidec — WeChat Mini Program Reverse Engineering

Use this workflow to decompile a WeChat Mini Program, locate its request
signing and optional application-layer encryption logic, implement the logic
in Python, and verify it against captured HTTP traffic.

The bundled Python files are references. The adapter uses a **dual-proxy
architecture** (downstream + upstream) so Burp Suite can display both request
and response bodies in plaintext:

| Template | Role | Faces |
|----------|------|-------|
| `mitm_downstream_template.py` | Decrypt requests, encrypt responses | Browser / Mini Program |
| `mitm_upstream_template.py` | Encrypt requests, decrypt responses | Target server |

A real Mini Program may use different parameter formats, signature locations,
header names, request paths, or encryption rules. Rewrite the templates to
match the decompiled source and the captured traffic.

## Core rules

1. Keep the wedecode decompilation workflow when package decryption and
   decompilation are requested.
2. Treat signing and application-layer encryption as separate features.
3. Use Burp baseline requests and responses to confirm what is actually sent.
4. Do not enable encryption or decryption for an endpoint just because the
   source contains `AES`, `encrypt`, `decrypt`, or a crypto key.
5. **Burp MCP availability is determined by a tool call, never by `check_env.py`.**
   `check_env.py` outputs `[NA]` for MCP — this means "Not Applicable to this
   checker", NOT "Not Available".  The checker cannot detect MCP server state;
   it deliberately skips the check.

   **The ONLY valid test is calling the tool.**  If `mcp__burp-ai-agent__status`
   (or any `mcp__burp-ai-agent__*` function) appears in your tool list, the MCP
   server is connected.  Call `mcp__burp-ai-agent__status` before Step 4 to
   confirm.  Only conclude "MCP unavailable" if the call fails or returns an
   error.  Do NOT cite the `[NA]` line from `check_env.py` as evidence —
   it is not evidence of anything.

   If MCP is genuinely unavailable (call failed), continue the work.  Tell the
   user that automatic traffic lookup and correctness confirmation are
   unavailable, ask for representative HTTP requests/responses when needed,
   and mark the affected verification as user-supplied or pending.
6. **The final report (`TASK_REPORT.md`) must be written in Chinese (中文).**
7. After generating `sign_core.py` and the adapter, write `requirements.txt`,
   check dependencies, and test that the scripts load correctly with
   mitmproxy. Always kill the test mitmproxy process after verification.
8. `sign_core.py` MUST use lazy imports for `Crypto` — standalone mitmproxy
   binaries include their own Python environment that lacks pycryptodome.
   Signature functions (stdlib only) must work without importing `Crypto`.
   AES functions import `Crypto` only when called.
9. **CRITICAL — Secrets must survive environment variable defaults.** Extracted
   keys (appSecret, aesKey, etc.) must be hardcoded defaults in `sign_core.py`.
   The adapter must NOT overwrite them with empty `os.environ.get()` values.
   Use the `if _val:` guard pattern (see Step 5b). Always verify extracted
   secrets against a Burp baseline before embedding them.
10. **CRITICAL — Verify adapter signature output against baseline.** Before
    declaring the adapter done, compute the expected signature for a captured
    baseline request using the extracted secret. The computed signature must
    match the captured one exactly. A nonce/timestamp mismatch is expected after
    re-signing, but the algorithm and key must produce identical output when
    fed identical inputs.
11. **All generated output goes into `./output/`.** Scripts (`sign_core.py`,
    `mitm_downstream.py`, `mitm_upstream.py`, `verify_sign.py`),
    `requirements.txt`, and `TASK_REPORT.md` must be written to the
    `./output/` directory under the project root. Create the directory if it
    doesn't exist. This keeps the project root clean — the decompiled source
    (`./wx_reverse_output/`) and the built adapters (`./output/`) stay
    separated.
12. **CRITICAL — If you can run the JavaScript, run it. Do not guess.**
    When the decompiled source contains obfuscated or complex signing logic,
    prefer dynamic extraction via Node.js over static analysis. Running the
    actual app code to compute a signature is always more reliable than
    reimplementing it. If the full module chain can execute in Node.js
    and call `wx.request`, you can capture the exact signed request by
    hooking the `wx.request` mock. Use this as the primary signing
    implementation — see `chaos_vm_guide.md` for Tencent Chaos VM techniques.

13. **CRITICAL — The Python adapter MUST NOT independently generate values
    that the signing module produces internally.**  When the Node.js sign
    helper (or any dynamic-extraction module) computes a signature, it also
    generates internal values such as timestamps, nonces, or IVs.  The
    Python adapter must extract these values from the module's output rather
    than generating its own.  Any value that appears in multiple places
    (e.g. a timestamp embedded in both an HTTP header and the sign string)
    must originate from a single source — the module's output.  For
    example, if the sign string contains `requestSignTime=1734567890123`,
    the adapter must parse that exact value from the module's stderr/stdout
    and use it for the corresponding header (e.g. `Requestsigntime`), rather
    than generating an independent `time.time()` timestamp that will never
    match.

14. **CRITICAL — Signature functions MUST receive the actual request `path`
    and `method` as explicit parameters.**  Never hardcode a default path.
    The decompiled request module's behavior is frequently path-dependent —
    it selects which parameters to include in the sign string, which headers
    to set, and what crypto functions to apply based on the URL path.  A
    hardcoded default path will produce valid-looking but incorrect
    signatures for every endpoint whose path differs from the default.

15. **CRITICAL — After building the adapter, perform an internal consistency
    check on cross-referenced values.**  For every value that the module
    places in multiple locations (e.g. a millisecond timestamp appearing as
    both a `Requestsigntime` header value and a `requestSignTime` parameter
    inside the sign string), verify the adapter uses the same source for all
    occurrences.  Two independently generated values will diverge, causing
    server-side verification failures that are indistinguishable from wrong
    secrets or algorithm bugs.  The specific field names vary by app, but
    the pattern is universal: **one value, one source**.

16. **CRITICAL — Adapter body manipulation must work across mitmproxy 10 and 11.**
    mitmproxy 11 changed `MultiDict.set_all()` from "replace all entries" to
    "replace values of a single key" (signature went from `set_all(values)`
    to `set_all(key, values)`).  Code that calls `form.set_all(list_of_tuples)`
    will crash with `_MultiDict.set_all() missing 1 required positional
    argument: 'values'` on mitmproxy 11.

    **Always use per-key assignment instead of bulk-replacement methods:**

    ```python
    # BAD — broken on mitmproxy 11
    req.urlencoded_form.set_all([(k, str(v)) for k, v in params.items()])

    # GOOD — works on mitmproxy 10 and 11
    for k, v in params.items():
        req.urlencoded_form[k] = str(v)
    ```

    **All body/header rewriting logic must be inside a `try/except` block.**
    An uncaught exception in `request()` is logged as an addon error but
    silently forwarded to the server without the transformation — the proxy
    appears to "work" (200 response) but the sign/encrypt didn't happen.

    ```python
    # BAD — set_all outside try, error silently passes
    try:
        sign, ts, headers = compute_sign(method, path, params)
    except Exception:
        return
    # If next line throws, request is forwarded unsigned
    req.urlencoded_form.set_all(...)

    # GOOD — everything inside one try block
    try:
        sign, ts, headers = compute_sign(method, path, params)
        for k, v in params.items():
            req.urlencoded_form[k] = str(v)
        req.headers["sign"] = sign
    except Exception as e:
        print(f"[upstream] sign failed {method} {path}: {e}")
    ```

    Prior to mitmproxy 11, `form.set_all()` accepted an iterable of `(key,
    value)` tuples and replaced the entire multidict.  In mitmproxy 11, use
    `form.clear()` then `form.add(k, v)` in a loop, or per-key `form[k] = v`.
    The per-key pattern is simpler, works on both versions, and is the
    documented approach in mitmproxy's own examples.

## 失败模式与恢复

以下表格覆盖工作流各阶段的已知失败路径。每轮操作前对照此表——任一已知模式命中，先按"一线修复"处理；仍失败则走"兜底"。

| 阶段 | 触发条件 | 一线修复 | 仍失败兜底 |
|---|---|---|---|
| Step 1 反编译 | `V1MMWX` header 识别后 `UnpackMiniApp.exe` 崩溃或无输出 | 确认 .exe 和 .config 同目录、wxapkg 路径无空格/中文 | 跳过解密，尝试 wedecode 直接解包；仍失败则请用户提供未加密 wxapkg |
| Step 1 反编译 | wedecode `--clear` 覆盖了已有输出 | 无（已丢失数据） | 用 `--clear` 前先确认目录为空；已丢失则请用户重新提供原始 wxapkg |
| Step 2 签名分析 | 在 `common/vendor.js` 中搜不到 `sign`/`md5`/`sha` 关键字 | 扩大搜索范围到 `app.js`、`appservice.app.js`、`common/main.js`；搜索 `__TENCENT_CHAOS_VM` | 切换到 chaos_vm_guide.md 动态提取路径 |
| Step 2 签名分析 | 字符串表混淆导致无法静态阅读签名逻辑 | 用 `sign_helper_template.js` — 在 Node.js 中加载模块、mock `wx.request`、捕获输出 | 在报告中记录"签名逻辑混淆，需动态提取"，标记该步骤为 pending |
| Step 3 构建 sign_core | Node.js sign helper 输出包含 `Crypto` 依赖 | 将 `Crypto` import 移到函数内部（lazy import），签名函数只用 stdlib | 若整个模块依赖不可拆分的 crypto，保留 Node.js helper 作为主实现，Python adapter 调用子进程 |
| Step 4 Burp 验证 | `mcp__burp-ai-agent__status` 调用失败或工具不在列表 | 告知用户 MCP 不可用，请用户手动提供代表性请求/响应；继续后续步骤 | 缺失的基线验证标记为 "user-supplied/pending"，TASK_REPORT 中注明 |
| Step 4 Burp 验证 | site_map 返回 0 条记录 | 检查是否配置了正确的 Burp project；请用户确认 Burp 正在监听并已抓取过目标小程序流量 | 用用户手动提供的请求/响应代替流量自动查找 |
| Step 4 Burp 验证 | `verify_sign.py` 签名不匹配 | 逐字段比对 sign_core.py 的输入参数与 captured request 的原始参数；检查参数排序/URL编码/空值处理 | 在报告中记录差异详情，标记为"签名验证未通过" |
| Step 5 构建 adapter | mitmproxy 脚本加载报错 | 检查 `Crypto` 是否为 lazy import；检查 Python 版本 ≥ 3.10；运行 `pip install -r output/requirements.txt` | 用 `mitmdump --no-anticache` 单次测试，打印完整 traceback |
| Step 6b 测试 | `mitmdump` 进程未在测试后退出 | `taskkill /F /IM mitmdump.exe` | 检查 Windows 任务管理器，手动终止 |
| 任意步骤 | 子 agent 不可用（超时/资源限制） | 在主 session 中继续执行，减少并发操作 | 报告中注明哪些验证由主 session 完成、哪些未运行 |

## 禁止事项（反例黑名单）

以下 11 条是真实踩过的坑。每轮操作前对照此表——任一命中就停手改方案。

### 静态分析陷阱 — 不跑代码就做假设

| # | 不要 | 为什么 | 怎么做 |
|---|------|--------|--------|
| 1 | 源码里有 `AES`/`encrypt`/`decrypt` 关键字就自动启用加解密 | 很多小程序引用 crypto 库但不实际调用；没有基线流量印证就开加密 = 构造错误请求 | 同时满足"源码有加密逻辑"和"Burp 基线流量的请求/响应是密文"两个条件才启用 |
| 2 | 遇到混淆代码（字符串表/Chaos VM）硬啃静态分析 | 人工反混淆容易出错且耗时 | 走 `chaos_vm_guide.md` 动态提取路径：Node.js 加载模块、mock `wx.request`、捕获实际输出 |

### 工具误用 — 拿错误信号当决策依据

| # | 不要 | 为什么 | 怎么做 |
|---|------|--------|--------|
| 3 | 用 `check_env.py` 输出的 `[NA]` 判断 MCP 不可用 | `[NA]` = Not Applicable（checker 不检查此项），不是 Not Available | 唯一有效判断：实际调用 `mcp__burp-ai-agent__status`；工具列表里搜不到再确认不可用 |
| 4 | wedecode 带 `--clear` 跑在已有输出的目录 | `--clear` 删除整个输出目录，已有分析结果全丢 | 先确认目录为空或用不带 `--clear` 的增量模式 |
| 5 | `form.set_all(list_of_tuples)` 批量替换表单 | mitmproxy 11 改了方法签名，直接抛 TypeError | 用 `form[k] = v` 逐键赋值，兼容 10 和 11 |

### 密钥与签名 — 不该自己造的值的值

| # | 不要 | 为什么 | 怎么做 |
|---|------|--------|--------|
| 6 | `os.environ.get("SECRET", "")` 覆盖硬编码密钥 | 环境变量未设时返回空字符串 `""`，密钥被静默替换为空 | 用 `_val = os.environ.get("KEY"); if _val: secret = _val` guard 模式 |
| 7 | Python adapter 自己生成 timestamp/nonce/IV | 签名模块内部已生成这些值，两套独立值必然不一致 | 从 Node.js helper 的 stderr/stdout 解析模块输出的原始值，adapter 只转发不复算 |
| 8 | `compute_sign(path="/api/default")` 写死默认路径 | 小程序按不同 path 选不同签名策略，一个默认值只能碰对一个接口 | path 和 method 必须作为显式参数传入，从实际请求中提取 |

### 验证跳步 — 没证据就说完成了

| # | 不要 | 为什么 | 怎么做 |
|---|------|--------|--------|
| 9 | 签名函数写完不跑 `verify_sign.py` 跟 baseline 比对 | 肉眼看着像 ≠ 实际算出来对 | 同输入 → 同输出才算验证通过；不匹配就回到 Step 2 重新比对字段 |
| 10 | mitmproxy 脚本加载不报错就当 OK，不跑流量 | body/header 改写写在 `try/except` 里，静默异常时请求原样转发 | 至少发一条请求验证代理链路：下游解密 → Burp 明文 → 上游加密 → 服务器响应 |
| 11 | `mitmdump` 测试完不杀进程 | 端口残留，下次启动端口冲突 | `taskkill /F /IM mitmdump.exe` 清理所有测试进程 |

## Prerequisites check

本技能默认运行在 Windows。依赖检查器只检查 Python、Node.js、mitmproxy、wedecode 命令及 mitmproxy CA 状态；不检查 .NET Framework，假定常见 Windows 环境满足 `UnpackMiniApp.exe` 的运行条件。

在项目根目录的 PowerShell 中运行：

```powershell
python .claude/skills/wxminidec/check_env.py
```

检查器使用 Python 3.10+ 语法，因此需要 **Python 3.10 或更高版本**。

条件依赖：

- **Python 3.10+** — 参考脚本所需。
- **Node.js 18+ 和 wedecode** — 仅在执行反编译时需要。
- **mitmproxy** — 仅在使用 bundled mitmproxy adapter 时需要。
- **pycryptodome** — 仅在确认应用层加密并使用 AES 参考函数时需要。
- **burp-ai-agent MCP** — 可选；`check_env.py` 不检查 MCP 服务器状态，它输出 `[NA]` 的意思是"此项不在 checker 的检查范围内"（Not Applicable）。**MCP 是否可用的唯一判断标准是你工具列表中是否存在 `mcp__burp-ai-agent__status`，存在就去调用它，不要根据 checker 的输出来推测。** 缺失时仍继续源码分析、脚本准备和用户提供的验证。

wedecode 检查只确认命令可执行，不解析其版本。Windows 下不创建虚拟环境，Python 依赖安装到当前 `python` 对应的环境。

如果缺少条件依赖，继续执行不依赖它的步骤，并在报告中说明哪些步骤不能自动完成。Burp MCP 缺失不能阻塞工作流。

## Workflow overview

```
Step 1 (可选)       Step 2            Step 3           Step 4              Step 5+5b+6         Step 6b          Step 7+8
反编译 wxapkg  →  定位签名算法  →  构建 sign_core  →  Burp 基线验证  →  构建双代理 adapter  →  测试+依赖  →  报告+审计
                                     🔴 CHECKPOINT    🛑 STOP             🔴 CHECKPOINT
                                     签名发现确认      MCP状态确认         构建前检查清单
```

各步骤的完整细节已拆分到独立参考文件，按需加载。下面列出每步的关键要点和对应的参考文件。

### Step 1: Decompile (optional) → `decompile.md`

反编译 `.wxapkg` 文件。仅当用户要求解包或未提供已反编译代码时执行。

关键点：先检查 header 是否为 `V1MMWX`（加密），是则用 `UnpackMiniApp.exe` 解密；解密输出和 wedecode 输出要放不同目录；wedecode 的 `--clear` 会删除整个输出目录。

### Step 2: Locate signing algorithm → `signing_analysis.md`

搜索 `common/vendor.js`、`common/main.js` 等 bundle 文件，定位签名实现。

关键点：记录源文件/行号、时间戳格式、参数字段、排序规则、正则、URL 编码、哈希算法、签名位置、hostname/method/path 条件。遇到 `__TENCENT_CHAOS_VM` 参见 `chaos_vm_guide.md`，遇到字符串表混淆先尝试隔离提取。

🔴 **CHECKPOINT — 暂停确认签名分析结果后再进入 Step 3。** 确认：源文件行号、签名字段、加密算法、hash 算法、签名位置（header/body/query）均已记录。

### Step 3: Build signing reference → `signing_analysis.md`

复制 `sign_core.py` 到 `./output/` 并适配。加密函数和签名函数分离，不静默混用。

### Step 4: Verify against baseline → `burp_traffic.md`

🛑 **STOP — 先确认 MCP 可用再继续。** 调用 `mcp__burp-ai-agent__status`（不可只看 check_env.py），然后四层分层查找流量：Layer 1 提取 hostname → Layer 2 site_map → Layer 3 proxy_history（先精确后通配）→ Layer 4 精准定位。保存 baseline 到 `./output/baselines/`，运行 `verify_sign.py`。

### Step 5: Build dual-proxy adapters → `adapter_dev.md`

两个 mitmproxy 实例：下游 (`:8082`) 解密密文让 Burp 看明文，上游 (`:8083`) 加密后发给服务器。

🔴 **CHECKPOINT — 写代码前完成检查清单。** 逐项确认后再动笔：
1. 签名算法和 secret 已从源码提取并通过基线验证（Step 2-4）
2. 目标 hostname/method/path 清单已明确
3. Rule 13（一个值一个来源）、Rule 14（path/method 显式传入）、Rule 15（交叉引用审计）已理解
4. secrets 硬编码为默认值并用 `if _val:` guard 模式防止环境变量覆盖

### Step 5b: Encryption (conditional) → `adapter_dev.md`

仅在源码和基线流量同时确认有应用层加密时才实现。不猜测，不自动启用。

### Step 6: Verify → `adapter_dev.md`

对比生成的签名/密文与 baseline。Live testing 可选。

### Step 6b: Testing → `testing.md`

写 `requirements.txt` → pip 安装 → `sign_core.py` 导入测试 → `verify_sign.py` → 上下游 mitmproxy 脚本加载测试 → CA 证书检查。测试进程必须杀掉。

### Step 7: Deliver report

Write `./output/TASK_REPORT.md`. **The report MUST be written in Chinese (中文).**

#### Task and environment

- decompiled output location and package command used;
- Python, Node.js/wedecode, mitmproxy, and pycryptodome availability;
- whether Burp MCP was available;
- steps that could not run and why.

#### Signing analysis

- source file and function/line locations;
- timestamp, input fields, sorting, serialization, regex, URL encoding, and hash behavior;
- signature placement;
- hostname, method, path, and parameter scope;
- whether signing uses plaintext or ciphertext;
- offline baseline comparison results.

#### Encryption scope and evidence

For every confirmed or investigated rule, record:

- hostname, method and path;
- encrypted parameter or whole-body scope;
- request/response direction;
- algorithm, mode, key/IV source, padding, and encoding;
- signing/encryption order;
- Burp history item or user-supplied request/response evidence;
- source location and verification result.

Explicitly record unconfirmed interfaces as **not enabled**. If MCP was
unavailable or no encrypted baseline was found, say so and list the request
and response examples still needed from the user.

#### Generated files and usage

- actual application-specific adapter path, if one was created;
- `sign_core.py` and verification script paths;
- environment variables actually used by that adapter;
- mitmproxy startup command and Burp upstream settings, if applicable;
- offline signature/ciphertext comparison results;
- live response comparison results or user-verification instructions.

### Step 8: Self-audit with a QA agent

After all output files are generated and the adapter scripts pass the loading
tests, spawn a **separate Explore agent** to audit the work.

Spawn an Explore agent with this prompt (fill placeholders):

```
Audit the wxminidec output in ./output/ against the skill's Core Rules and
the app-specific findings. Read ALL files in ./output/ and cross-check them
against .claude/skills/wxminidec/SKILL.md.

Report findings organized by category:
  1. Stability — do the adapter scripts start without errors? Are all three
     downstream flags present and correct?
  2. Compliance — check every Core Rule (1-11) that applies to the output:
     lazy Crypto imports, env var guard pattern (if _val:), exact host match
     (not substring), output/ directory convention, secrets as hardcoded
     defaults, baseline verification evidence.
  3. Correctness — does the startup command in mitm_downstream.py include
     --mode upstream, --set upstream_cert=false, AND --ssl-insecure? Is the
     TASK_REPORT.md written in Chinese? Are the extracted keys/IV/secrets
     verified against a baseline in the report?
  4. Completeness — are baselines/ files present? Does verify_sign.py pass?
     Are there stale references to old single-proxy patterns?

For each issue found, cite the exact file and line. Distinguish critical
(breaks the workflow), medium (confusing), and minor (formatting).
```

#### Must-pass items

| # | Check | Source |
|---|-------|--------|
| 1 | Both adapter scripts load without errors | Step 6b |
| 2 | `sign_core.py` imports with stdlib only (no module-level `Crypto`) | Core rule 8 |
| 3 | Environment variables use `if _val:` guard, not empty-string overwrite | Core rule 9 |
| 4 | Host matching uses exact comparison, not substring | Core rule / Step 5 |
| 5 | Downstream startup command has all three flags (mode, upstream_cert, ssl-insecure) | Step 5 |
| 6 | `TASK_REPORT.md` is in Chinese | Core rule 6 |
| 7 | Baseline evidence exists (baselines/ files OR verified against Burp MCP) | Step 4 |
| 8 | `verify_sign.py` passes all tests | Step 4 |
| 9 | `compute_sign()` extracts timestamp/nonce/IV from module output, never self-generates | Core rule 13 |
| 10 | `compute_sign()` accepts explicit `path` and `method` parameters; no hardcoded default path | Core rule 14 |
| 11 | Cross-reference audit: every value placed in multiple locations shares a single source | Core rule 15 |
| 12 | Body/header manipulation uses per-key assignment, not `set_all()`; all mutation inside single try/except | Core rule 16 |

#### App-specific checks

| # | Check | When applicable |
|---|-------|-----------------|
| A | Signing algorithm matches source and baseline | App has request signing |
| B | Encryption key/IV verified against captured baseline | App has AES encryption |
| C | Request body format matches source | App has body encryption |
| D | Response body format matches source | App has response encryption |
| E | All API hosts from source are covered or documented as out-of-scope | Multiple API hosts found |
| F | All cross-referenced values trace to one module output | App uses signing |
| G | Request and response body wrapper formats independently confirmed from source | App has body encryption |

If an app-specific check does not apply, mark it N/A with the source evidence.
Do NOT fabricate signatures or enable encryption for an endpoint without
baseline evidence (Core rule 4).

## Troubleshooting

常见问题排查详见 `troubleshooting.md`，覆盖：下游解密日志缺失、上游收到密文、签名/contentMd5 错误、mitmproxy 脚本加载失败、CA 证书、进程残留、小程序代理异常、UnpackMiniApp.exe 解密失败。

## Case studies

详见 `case_studies.md`：
1. **XXXX** — 字符串表混淆 + `&&` 分隔多段 MD5 签名 + AES 加密签名令牌 + decrypt-first 密钥验证
2. **国密 SM4** — SM4 ECB + hex/XOR/Base64 多层编码 + 请求/响应包装格式不一致 + 下游不需要重新加密

## Bundled files

| File | Purpose |
|---|---|
| `sign_core.py` | Reference signing functions and optional AES helpers |
| `mitm_downstream_template.py` | Dual-proxy downstream template (decrypt requests, encrypt responses) |
| `mitm_upstream_template.py` | Dual-proxy upstream template (encrypt requests, decrypt responses) |
| `mitm_sign_template.py` | (Legacy) Single-proxy adapter example — use dual-proxy templates for new work |
| `verify_sign_template.py` | Simple baseline signing verification template |
| `check_env.py` | Python/Node/wedecode/mitmproxy dependency check |
| `UnpackMiniApp.exe` | CLI tool for decrypting V1MMWX-encrypted wxapkg |
| `UnpackMiniApp.exe.config` | Runtime compatibility config for .NET 4.x |
| `sign_helper_template.js` | Reusable Node.js sign helper — hooks `wx.request` to capture signatures |
| `chaos_vm_guide.md` | Tencent Chaos VM bypass — dynamic extraction via Node.js |
| `pitfalls.md` | Common pitfalls when reverse-engineering WeChat Mini Programs |
| `decompile.md` | Step 1 details — package decryption and decompilation |
| `signing_analysis.md` | Step 2-3 details — signing algorithm location and reference building |
| `burp_traffic.md` | Step 4 details — Burp MCP traffic lookup and baseline verification |
| `adapter_dev.md` | Step 5-6 details — dual-proxy adapter building, encryption, and verification |
| `testing.md` | Step 6b details — requirements, mitmproxy loading tests, CA setup |
| `troubleshooting.md` | Common issues and their solutions |
| `case_studies.md` | Real-world reverse engineering examples |
