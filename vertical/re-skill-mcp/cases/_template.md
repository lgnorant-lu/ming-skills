---
name: <目标域名> - <签名系统名>
status: verified | wip | failed
success_score: 0.0-1.0
---

## 基本信息

| 字段 | 值 |
|---|---|
| 目标 URL | https://xxx.com |
| 加密参数 | sign / a_bogus / X-Bogus / ... |
| 技术栈 | webpack / obfuscator.io / jsdom / sdenv |
| 反爬类型 | 签名型 / 行为型 / 纯混淆 |
| 最终方案类型 | Node.js 纯协议 / Python 纯协议 / jsdom 环境伪装 / sdenv |
| 验证通过次数 | ≥ 5 次 / 否 |

## 定位路径

```
search_code / get_request_initiator 找到的入口函数:
  → window.getSign = function(url, ts, nonce) { ... }
  → CryptoJS.MD5(url + ts + nonce).toString()
  → 最终签名头: X-Sign
```

关键调用链（从请求发出到签名生成的完整路径）：

## 踩坑记录

| # | 坑 | 症状 | 修复 |
|---|---|---|---|
| 1 | Function.prototype.toString 暴露 jsdom 源码 | 服务端静默拒绝(HTTP 200 + 空 body) | markNative + 实例覆写 + WeakSet |
| 2 | Cookie 写入后必须 reload() 才会生效 | JS 环境有 cookie，请求却带不上 | cookies() → reload() → 验证 |
| 3 | ... | ... | ... |

## 可验证事实清单（站点升级时逐条用）

- [ ] `window.getSign` 签名算法是 MD5(url + ts + nonce)，首字符截断到 16 位
- [ ] 时间戳精度为秒级（非毫秒）
- [ ] nonce 是 `Math.random().toString(36)` 生成的 8 位随机串
- [ ] Cookie `__sign_session` 由 /api/auth 的 Set-Cookie 写入，有效期 24 小时

## 签名字段映射表（v1.2 — 站点升级 5 分钟定位差异）

> 每个签名 header 内 base64 解出来的 JSON 对象（ef / P 等），逐字段填这张表。
> 下次站点更新签名算法，看哪行的「动态性」或「来源」变了 → 直接锁定改动。

| Header | 字段 | 来源 | 实测值 | 动态性 | 失效信号 |
|---|---|---|---|---|---|
| x-s | x0 | hardcoded SDK 版本 | "4.3.5" | 静 | SDK 主版本升级 |
| x-s | x3 | mnsv2 输出 | mns0301_xxx | 动 | 后端协议升级 |
| x-s-common | x5 | cookie a1 | 19eac2... | 半静 | 重新登录 |
| x-s-common | x8 | localStorage b1 | I38r... (1.5KB) | 半静 | 设备指纹重算 |
| x-s-common | x10 | sessionStorage sigCount | 0/1/2... | 动 | 每次签名 +1 |
| ... | ... | ... | ... | ... | ... |

动态性说明：
- **静**：硬编码常量，跨用户跨会话不变
- **半静**：跨请求不变，但换设备/重登/换浏览器会变
- **动**：每次请求都变（时间戳 / nonce / 计数器 / 算法 nonce）

## 实施方案

核心还原代码（伪代码或关键片段）：

```js
// Node.js 复现
const crypto = require('crypto');
function getSign(url, ts, nonce) {
  const raw = url + ts + nonce;
  return crypto.createHash('md5').update(raw).digest('hex').slice(0, 16);
}
```

## 生命周期

| 创建日期 | 最后验证 | 是否活跃 |
|---|---|---|
| 2026-06-09 | 2026-06-09 | ✅ |