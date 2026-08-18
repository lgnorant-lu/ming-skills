---
name: xiaohongshu.com - x-s/x-s-common/x-rap-param 三签名 (PC web 搜索)
status: wip
success_score: 0.7
captured: 2026-06-09
verified_last: 2026-06-10
project_dir: D:/PrivateProject/xhs-search-reverse
---

## 基本信息

- 目标 URL: https://www.xiaohongshu.com/search_result?keyword=...
- 真实接口: POST https://edith.xiaohongshu.com/api/sns/web/v1/search/notes
- 加密参数: x-t + x-s (XYS_ 前缀) + x-s-common + x-rap-param
- 三签名 (不是文档说的双签名)
- 技术栈: Vue + axios + webpack chunk + obfuscator.io + **双层 JSVMP (`_ace_*` decoy + `_sabo_*` production)** + RAP hijacker (function Sanji, 360KB 字节码)
- 反爬类型: 行为型 (RAP 接管 XHR.send / fetch, 但**不**接管 setRequestHeader)
- 最终方案: Python + PyExecJS (compute_sign 调 V8 跑 RAP 还原算法) -> requests 发请求
- MCP 套餐: tier 2 (reverse-skill + chrome-devtools-mcp). 不是 RS, 不用 camoufox

## 定位路径

1. Phase 0 navigate explore -> HTTP 200, redirect_chain 干净 -> 行为型 (排除 RS/Akamai)
2. Phase 0 evaluate_script 发现:
   - window._webmsxyw = function (表面上像 x-s 入口, **163B trampoline, `_ace_*` 风格**)
   - window.mnsv2 = function (x-s 第二段 mns, **261B obfuscator.io 静态混淆 `_0x*` 风格**)
   - window.anti_hp_sign_config.signIncludesUrl 是 **`Array<{pattern, mode}>` 对象数组** (不是字符串数组) 含 `{pattern: "api/sns/web/v1/search/notes", mode: "endsWith"}`
   - **5 个 `__rap_*` 全局**: `__rap_hijack_installed__` / `__rap_app_id__` ("xhs-pc-web") / `__rap_report__` / `__rap_last_sign_cost__` (ms) / `__rap_last_transform_cost__`
3. Phase 1 触发搜索 -> reqid=596 (2026-06-10) 抓到完整 request headers (4 个签名头 + 完整 cookie 链)
4. Phase 2 _webmsxyw 实测调用 -> 返回 `{X-s: "XYW_eyJzaWduU3ZuIjoiNTYi...", X-t: <ts>}` (XYW_ 前缀, signSvn:56, signType:x2 完整结构)
   - 对比生产抓包 XYS_ -> _webmsxyw 是 decoy 路径 (但**单独调有完整 sign payload**, 可能 SDK/老接口兼容用, 后端是否接受待验证)
5. Phase 2 探针精确化 (Rule 36):
   - `String(XHR.prototype.send)` = **137 字符全是 `_sabo_*`** trampoline
   - `String(window.fetch)` = 跟 send **完全一致** (同一 trampoline)
   - `String(XHR.prototype.setRequestHeader)` = **`[native code]`** ⚠️ **未被接管** (v1.5 修正先前案例描述)
6. Phase 4 Step 1 chunk dump 完成 (10 个 chunk, 共 3.8MB, 见 project notes/02):
   - **RAP 主体锁在 `async/4291.065f6813.js`** (360KB), 入口 `function Sanji()` (offset 96)
   - 内部 `var k={_sabo_eb61:A}` 是 register alias 表, `_sabo_d156d(w)` 是 dispatcher, `w` 是字节码大数组, `M` 是 handler 表
   - 10 个 chunk 末尾都有 `sourceMappingURL` 指向 `picasso-private-1251524319.cos.ap-shanghai.myqcloud.com/...` (private bucket, 403, 但记录值得未来重试)
7. Phase 3 装 XHR.setRequestHeader Hook -> 抓 0 请求 (因为 Rule 36: RAP 走 send 整体替换不调 setRequestHeader, 不是 Hook 装晚了)
8. Phase 4 走 Path B (PyExecJS + 补环境): 当前 placeholder, Step 1 反混淆按 Rule 37 决策树排攻

## 踩坑记录 (核心价值, 站点会变, 坑型不变)

1. **信了文档说的双签名**: 漏抓 x-rap-param 导致 sign 校验失败。修复: 抓包完整 dump 所有 x-* 头, 不依赖文档。
2. **调 window._webmsxyw 当生产函数**: 返回 XYW_ 前缀, 与抓包的 XYS_ 不符。Rule 33: decoy + real 共存, 必须对比 axios 拦截器实际发的 header。**v1.5 update**: 实测 _webmsxyw() 单独调能返回完整 sign payload, 不是空壳, 可能是 SDK 兼容路径 — Rule 37 决策树第 2 档优先尝试这条路。
3. **chrome-devtools-mcp 后启 js-reverse-mcp**: js-reverse 报 launchPersistentContext failed (user-data-dir 冲突)。修复 (v1.5 Rule 38): 一次只挂一个浏览器 MCP, dump chunk 直接用 chrome-devtools 的 `evaluate_script` + `fetch()` 拉取, 或者直接 curl 走 CDN。
4. **装 XHR.setRequestHeader Hook 后 navigate, 期待抓到 RAP 输出**: 抓到 0 个请求。**根因 (v1.5 修正)**: 不是 Hook 装晚了, 而是 RAP 接管的是 `XMLHttpRequest.prototype.send` 整体替换 (137B `_sabo_*` trampoline), `setRequestHeader` 仍是 `[native code]` 不会被调用。修复: hook send 或在 trampoline 入口处下断点。
5. **PyExecJS 顶层用 this.sign = sign**: TypeError: Cannot set properties of undefined。原因: PyExecJS V8 严格模式下顶层 this === undefined。修复: 用 globalThis / self / global 兜底链。
6. **stub.js 用 require crypto**: PyExecJS 是纯 V8 不是 Node, 没有 require/module.exports。修复: 把 WebCrypto 等需要的 API 用纯 JS 重写 (本案例的 btoa/atob 就是这样)。
7. **storage.json 里 b1 是 _truncated 截断的 (1592B)**: 注入到 stub.js 后只有 head 80 字符, sign 算 x-s-common 输入会跟浏览器对不上。修复: Phase 0 dump localStorage 时把 b1 等签名输入 key 用 limit:5000 完整存。
8. **content-length 跟 body 字节数错位**: Python json.dumps 默认带空格, 浏览器 axios 序列化无空格。修复: json.dumps(body, separators=(",",":"))。
9. **GBK Windows console 不能打 emoji**: verify.py 输出 UnicodeEncodeError。修复: 用 [OK]/[XX] ASCII 标记。
10. **websectiga cookie 跟签名无关**: 抓包发现两次请求 websectiga 不同但服务端都接受。与传统案例描述不符, 2026 站点改版。Rule 25 在 search/notes 不适用。
11. **signIncludesUrl 误判为字符串数组**: 之前 case 写 `includes('api/sns/web/v1/search/notes')`, 实际是 `{pattern, mode: "endsWith"}` 对象。修复: 探针先 `Object.keys(window.anti_hp_sign_config.signIncludesUrl[0])` 看结构。
12. **没探完 `__rap_*` 全集**: 之前 case 只记了 `__rap_hijack_installed__`, 实际 window 上有 5 个 `__rap_*` 变量。`__rap_last_sign_cost__` 是 telemetry, **反向跑 sign 时可以盯着它看是否变 (变 = sign 真跑了, 0 = 没触发)**, 这是个免费 oracle。
13. **chunk source map 试一下** (v1.5): chunk 末尾常有 `sourceMappingURL` 指向私有 COS bucket, 90% 是 403, 但试一下成本几乎 0, 一旦中就跳过整个 AST 反混淆。xhs 的 source map 在 `picasso-private-1251524319.cos.ap-shanghai.myqcloud.com`, 403 但记录 bucket 名供未来重试。
14. **placeholder-first 是 Phase 4 必经** (v1.5 Rule 35): 不要等 Step 1 抠完 sign 再写 Python 桥。先写 placeholder signer (返回 `XYS_PLACEHOLDER_<ts>_<hint>`), 让 stub.js + utils/sign.py + verify.py + main.py 全流水线先跑通, 再回头攻 Step 1。这样 PyExecJS 顶层 this / JSON separator / GBK / content-length 这些**非算法 bug** 提前暴露 + 别人接手时桥 OK, 单点替换 sign-source.js 即可。

## 签名字段映射表 (v1.5 实测填充)

| Header | 字段 | 来源 | 实测值 (sample-596) | 动态性 | 失效信号 |
|---|---|---|---|---|---|
| x-t | (整体) | Date.now() 毫秒 | 1781053952245 | 动 | 时区/时钟漂移 |
| x-s | 前缀 4B | hardcoded | `"XYS_"` | 静 | SDK 灰度切到 XYW_ |
| x-s | 主体 ~280B base64 | Sanji 接管的 XHR.send (走 `_sabo_d156d` -> mns2) | `2UQhPsHC...` | 动 | 算法升级 |
| x-s-common | 主体 ~3KB base64 | 设备指纹摘要 (cookie a1 + localStorage b1 + ua + screen) | `2UQAPsHC...` | 半静 | 重新登录 / 换设备 / 换浏览器 |
| x-rap-param | 前缀 4B | hardcoded | `"ByQB"` | 静 | RAP SDK 主版本升级 |
| x-rap-param | 主体 ~660B base64 (二进制) | RAP 风控字段, async chunk 异步加载 | `BAAAAAEA...` | 动 | RAP SDK 升级 / 风险等级触发 |
| x-xray-traceid | 32 hex | trace, 跟签名无关 | `cf578b48...` | 动 | 不影响签名校验 |

动态性: 静 = 跨用户跨会话不变 / 半静 = 跨请求不变跨设备会变 / 动 = 每次请求重算

## 已知输入域 (sign 函数实际读了什么)

由 Phase 0 评估 + Phase 4 Step 1 部分逆推 (待 Step 1 完成后用 `property_access_hook` 全量 trace 才能 100% 确认):

| 输入 | 来源 | 用于 | 备注 |
|---|---|---|---|
| a1 | cookie | x-s-common 主体 | 设备指纹种子 |
| webId | cookie | x-s-common 主体 | 同上 |
| xsecappid | cookie | header 直传 | `"xhs-pc-web"` 静态 |
| websectiga | cookie | (实测不影响) | 已 falsified |
| b1 | localStorage | x-s-common 主体 | 1.5KB 设备指纹 base64 |
| dsllt | localStorage | x-s-common | 加载时间戳 |
| p1 | localStorage | x-s-common | ABTest 分桶 |
| ts (x-t) | Date.now() | x-s 主体 | 毫秒 |
| body | runtime | x-s 主体 | path+method+body 摘要 |
| navigator.userAgent | DOM | x-s-common (FP 摘要) | 必须跟 cookies dump 时浏览器一致 |
| screen / hardwareConcurrency | DOM | x-s-common | 同上 |

## 完整可跑项目 (tarball)

`xiaohongshu-x-s-search-project.tar.gz` 在本目录, 包含 Phase 0-3 完整侦察 + Phase 4 Step 1 chunk dump 进度 + PyExecJS 桥 + placeholder signer:

```
tar xzf cases/xiaohongshu-x-s-search-project.tar.gz
cd xhs-search-reverse
cp config/cookies.example.json config/cookies.json
cp config/storage.example.json config/storage.json
pip install -r requirements.txt
bash scripts/dump_vendor.sh
python -m utils.sign
python verify.py
python main.py 成都咖啡
```

填 cookie / storage 真值步骤见项目 README.md。详细 chunk dump 报告见 `notes/02-phase4-chunk-dump.md`。

## Phase 4 卡点 + Step 1 攻击顺序 (Rule 37 决策树)

**卡点**: 真 sign 由 RAP hijacker (function Sanji 360KB 字节码 VM) 在 XHR.send 处接管。`_webmsxyw` 是 decoy 路径但单独调有完整输出, 可能可绕。

**Step 1 攻击顺序** (由易到难, 第一个跑通的就 STOP):

| 顺序 | 目标 | 难度 | 估时 | 工具 | 出口 |
|---|---|---|---|---|---|
| 1 | mnsv2 (`_0x*` 静态混淆 261B) | ★ | < 2h | webcrack / de4js | 直接还原成可读 JS |
| 2 | _webmsxyw (`_ace_*` trampoline 163B + closure) | ★★ | 3-5h | babel AST 抠整段 | 装到 sign-source.js, 测 XYW_ 路径 |
| 3 | **测试 XYW_ 路径** | — | 30min | curl + 真 cookie | 若后端接受 → STOP |
| 4 | Sanji (`_sabo_*` 字节码 VM 360KB) | ★★★★★ | >= 1 day | chrome 断点 dump `w`/`o`/`M` + 写 JS VM | 仅在第 3 步不通时启动 |

完成后: 替换 `config/sign-source.js` placeholder 段 → `python verify.py` 应 8/8 pass → `python main.py 成都咖啡` 应 code=0 + 20 条 notes。

## 抓包样本

| reqid | 时间戳 | 关键词 | x-s head | 备注 |
|---|---|---|---|---|
| 574 | 1781018840372 | 成都咖啡 | XYS_2UQ...PAZ... | Phase 1 基础对比 |
| 637 | 1781018841197 | 成都咖啡 | XYS_2UQ...P/Z... | 825ms 后重发 |
| 596 | 1781053952245 | 成都咖啡 | XYS_2UQ...JdPI... | Phase 4 dump session 抓的, headers 完整 + x-rap-param |