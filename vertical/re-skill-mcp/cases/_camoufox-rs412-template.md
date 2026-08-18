---
name: camoufox × RS 412 redirect 战法（模板案例）
status: template
success_score: n/a
---

> **这是模板案例，不是真实站点踩坑记录**。把它复制成 `<your-site>-rs-412.md`，按你的目标填实，作为 camoufox + reverse-skill Phase 4 完整流程的参照。
>
> 真实案例的核心价值是踩坑记录（哪些坑被填了），不是代码本身 —— 站点会升级，坑型不变。

## 基本信息

| 字段 | 值 |
|---|---|
| 目标 URL | https://example-rs-protected.com/api/v1/data |
| 加密参数 | FSSBBIl1UgzbN7N (cookie), x-bbf-token (header) |
| 技术栈 | 瑞数 5/6 (RS), webpack, JSVMP 解释器, sdenv*.js |
| 反爬类型 | **签名型**（环境即签名） |
| 最终方案类型 | **Node.js + sdenv 补环境**（不是纯算） |
| 验证通过次数 | ≥ 5 次 |
| MCP 套餐 | tier 4: reverse-skill + camoufox-reverse + (optional) js-reverse |

## 为什么必走 camoufox

chrome-devtools-mcp 首次 navigate 就被 412 拒绝；指纹被 JS 层 patch 检测出 webdriver 残留。Camoufox C++ 引擎层伪造的 navigator/UA/plugins/Canvas/WebGL **页面 JS 不可见也不可改**。

判定信号（任意一条 → 必走 camoufox）：
- [x] 首次 navigate redirect_chain 出现 412 → 200
- [x] cookie 出现 `FSSBBIl1UgzbN7N=...`
- [x] Network 面板加载 `sdenv*.js` 或 `acmescripts*.js`
- [x] 任意 `evaluate_script(window.navigator.webdriver)` 返回 true → 直接被风控

## Phase 0：搭环境 + Checklist

```bash
# 装机自检
mcp__reverse-skill__camoufox_install_helper(host='claude-code')
  → py_installed: true / binary_present: true → 跳过装机
  → py_installed: false → pip install camoufox-reverse-mcp && python -m camoufox fetch

# 拿 4-MCP 配置, 重启 Claude Code
mcp__reverse-skill__mcp_stack_recommendation(
  target_url='https://example-rs-protected.com',
  antibot_signals=['412_redirect', 'fssbb_token', 'rs_acmescripts']
)
  → tier=4, required=['reverse-skill','camoufox-reverse']

# 启浏览器, 开 C++ 引擎层属性追踪
mcp__camoufox-reverse__launch_browser(headless=False, enable_trace=True)
mcp__camoufox-reverse__navigate(url='https://example-rs-protected.com/login')
mcp__camoufox-reverse__get_page_info()
  → redirect_chain: ['/login (412)', '/sdenv-xxxxx.js (200)', '/login (200)']  ← RS 典型链路
```

## Phase 1：侦察 + 拿真读属性

```bash
# 1) 开网络录制
mcp__camoufox-reverse__network_capture(action='start')

# 2) 装 XHR Hook 看签名头怎么发的
mcp__camoufox-reverse__inject_hook_preset(preset='xhr', persistent=True)

# 3) 触发业务请求（点登录按钮 / 触发 API）
mcp__camoufox-reverse__click(selector='button[type=submit]')

# 4) 关键: 跑 C++ 引擎层属性追踪 60 秒
mcp__camoufox-reverse__trace_property_access(duration=60, mode='summary', collect_values=True)
  → 返回 30-50 个 JSVMP 真读了的属性 + 真实值，例如:
    [
      {"property": "navigator.userAgent", "reads": 23, "value": "Mozilla/5.0 ..."},
      {"property": "navigator.platform", "reads": 8, "value": "Win32"},
      {"property": "screen.width", "reads": 12, "value": 1920},
      {"property": "document.cookie", "reads": 17, "value": "FSSBBIl1UgzbN7N=..."},
      {"property": "performance.timing.navigationStart", "reads": 5},
      ...
    ]
```

> **关键洞察**：这 30-50 个属性是 RS JSVMP **真的读了** 的，不是 jsdom diff 出来的几百个噪声。chrome-devtools-mcp 不行 —— 它没有 C++ 层 trace。

## Phase 2：抠 signer 源码

```bash
# 1) 找加载的 sdenv 脚本
mcp__camoufox-reverse__scripts(action='list')
  → 拿到 ['sdenv-abc123.js', 'acmescripts-def.js', 'business.js', ...]

# 2) save_source 自动美化（RS 是混淆 + 控制流平坦化）
mcp__camoufox-reverse__scripts(action='save', script_url='sdenv-abc123.js', file_path='./sdenv.js')

# 3) 搜签名相关关键词
mcp__camoufox-reverse__search_code(keyword='FSSBBIl1UgzbN7N', script_url='sdenv-abc123.js')
mcp__camoufox-reverse__search_code(keyword='x-bbf-token')
```

## Phase 3：补环境 + verify

```bash
# 1) 喂 trace 结果给 reverse-skill 的 minimize → 拿最小 stub
mcp__reverse-skill__env_patch_minimize(
  trace_log=<上一步 trace_property_access 返回的列表>,
  keep_top_n=50
)
  → 输出 stub_patch_js（可粘到 stub.js）

# 2) 一键生成 Node.js 补环境项目骨架
mcp__reverse-skill__env_patch_scaffold(
  project_name='example-rs-signer',
  target_domain='example-rs-protected.com'
)
  → 生成 8 个文件: stub.js / runner.js / verify.js / env_diff.js / config/...

# 3) 把 stub_patch_js 追加到 stub.js, 把 sdenv 抠出来的 signer 粘进 config/sign-source.js
# 4) 从 Network 抓 3-5 个 (input, expected) 样本写进 config/samples.json
# 5) 跑 verify
node verify.js
  → 0/5 pass, first_divergence_at: 47
  → 看 actual_around / expected_around 找差什么

# 6) 浏览器侧再来一遍补缺
mcp__reverse-skill__env_diff_snippet()  → 粘 DevTools → copy 结果 → 存 browser-env.json
node env_diff.js  → 看 missing_in_stub
# 把缺的属性手补到 stub.js, 再跑 verify, 循环直到 5/5
```

## Phase 4：纯算判断 + 交付

```bash
mcp__reverse-skill__algo_translate_hint(by_object_summary=<minimize 输出>)
  → estimated_lines_python: 380
  → 决策: > 200 行, RS 5/6 算法太复杂, 停在 Node.js + sdenv 补环境, 不强翻 Python
  → Python 端通过 subprocess 调 node runner.js, 拿签名头
```

## 踩坑记录

| # | 坑 | 症状 | 修复 |
|---|---|---|---|
| 1 | 直接用 chrome-devtools-mcp navigate | 412 → 跳验证页 → 永远拿不到业务接口 | 切 camoufox-reverse-mcp |
| 2 | navigator.webdriver = true (chromium 默认) | RS 第一波 JS 直接 reject | camoufox 默认就是 false（C++ 层） |
| 3 | compare_env 输出 200+ 项, 全补一遍 stub | 还是 412, 不知哪个不对 | 用 `trace_property_access` 拿真读列表, 只补 30 个 |
| 4 | Function.prototype.toString 暴露 stub 函数源码 | 静默拒绝 (200 + 空 body) | runner.js 用 `vm.runInContext`, JSVMP 看到的是 native, 不暴露 |
| 5 | localStorage 没初始化 b1/dsllt | x-bbf-token 缺字段 | mcp__camoufox-reverse__get_storage(storage_type='local') → 拷进 stub.js |
| 6 | sdenv 在 Node 跑报 "self is not defined" | runner.js 第一句就崩 | stub.js 加 `window.self = window` |

## 可验证事实清单（站点升级时逐条用）

- [ ] `FSSBBIl1UgzbN7N` cookie 由 sdenv-XXX.js 在加载后 < 100ms 内 set
- [ ] `x-bbf-token` 包含 base64(JSON{nav UA, screen WxH, ts, nonce, sig})
- [ ] JSVMP 真读的 navigator 字段固定 6 个: userAgent / platform / language / hardwareConcurrency / webdriver / vendor
- [ ] 时间戳精度为 **毫秒**, 容差 ±30s
- [ ] RS 主版本号在 acmescripts-XXX.js 第一行常量 `"version":"5.10"` 中

## 签名字段映射表

| Header | 字段 | 来源 | 实测值 | 动态性 | 失效信号 |
|---|---|---|---|---|---|
| FSSBBIl1UgzbN7N (cookie) | 全段 | sdenv 计算 | base64 串 ~200B | 动 | sdenv 主版本升级 |
| x-bbf-token | nav.ua | navigator.userAgent | "Mozilla/5.0..." | 静 | UA 改 |
| x-bbf-token | nav.plat | navigator.platform | "Win32" | 静 | 设备类型变 |
| x-bbf-token | screen.w | screen.width | 1920 | 半静 | 分辨率变 |
| x-bbf-token | ts | Date.now() | 1781000000000 | 动 | - |
| x-bbf-token | nonce | crypto.getRandomValues(8) | base64 8B | 动 | - |
| x-bbf-token | sig | hmacSHA256(prev, FSSBB cookie) | 64-char hex | 动 | cookie 失效 |

## 最终代码骨架

```js
// runner.js 里 vm.runInContext 跑 sdenv 抠出来的代码 + 我们的 stub
// 然后:
const { sign } = require('./runner.js');
const { headers } = sign({
  method: 'GET',
  path: '/api/v1/data',
  body: null,
});
// headers = { 'Cookie': 'FSSBBIl1UgzbN7N=...', 'x-bbf-token': '...' }
const res = await fetch('https://example-rs-protected.com/api/v1/data', { headers });
```

```python
# Python 调:
import subprocess, json
out = subprocess.check_output(['node', 'runner.js', json.dumps({'path':'/api/v1/data', 'method':'GET'})])
headers = json.loads(out)['headers']
r = requests.get('https://example-rs-protected.com/api/v1/data', headers=headers)
```

## 生命周期

| 创建日期 | 最后验证 | 是否活跃 | 案例类型 |
|---|---|---|---|
| 2026-06-09 | - | 📋 模板 | 流程参照 |
