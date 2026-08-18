# Case Studies

## Case study: XXXX `@XXXX/api-encrypt`

A real example covering string-table obfuscation, targeted extraction,
and AES decrypt-first verification — all in one app.

### What was found

- **App**: wx13************b2, host `gateway.XXXX.cn`
- **Obfuscation**: module 427 used string-table rotation (37 strings, 26
  shifts), NOT Chaos VM
- **Sign format**: `MD5( path?query && lowercased_headers_csv && JSON_body )`
- **Sign delivery**: the MD5 hex goes into a JSON payload, which is
  AES-256-CBC encrypted → Base64 → `X-Api-Key` request header
- **Key extraction**: string table was copied from source, rotation loop
  was simulated in a standalone 30-line Node.js script — no full app
  loading needed
- **Key verification**: Python decrypted a captured `X-Api-Key` with the
  candidate key → valid JSON confirmed the key instantly
- **Adapter type**: signing-only (no body encryption), downstream is a
  pass-through

### Key takeaways

1. Not all obfuscation is Chaos VM — string rotation is common and much
   easier to crack in isolation.
2. Full app loading is ideal but not always necessary; a 30-line script
   that only rotates the string table can be enough to extract secrets.
3. AES decrypt-first (Step 4c) can confirm key correctness in one shot.
4. The signing format (`&&`-separated multi-part MD5) was not in the
   bundled template — always derive from source.

---

## Case study: 国密 SM4 + hex/XOR/Base64 多层编码

一个公立医院小程序，涉及国密 SM4 ECB、多层编解码、请求/响应包装格式不一致
等问题。

### 加解密架构

- **算法**: SM4 ECB（国密，非 AES），通过 `gmssl` Python 库实现
- **密钥**: `MD5("hex_32_" + hisId)` — 源码 `@haici/gmsm4/lib/index.js` genKey()
- **多层编码**: SM4 encrypt → hex 小写 → 每字节 XOR 固定 salt → Base64
- **第三方 npm 包**: `@haici/request-filter` (security2 中间件)、
  `@haici/gmsm4` (SM4 实现)、`@haici/request-core` (请求链)

### 签名（仅前置机 `_route` 端点）

- genKey 每月变化: `MD5("固定前缀" + YYYYMM + hisId)`
- `encodeURIComponent` → 两次 decode → 追加 genKey → MD5 大写

### 请求/响应包装格式不同

请求 body: `d=<base64>` (form-urlencoded)
响应 body: 裸 `<base64>` (无包装，`t.data` 直接传入 `decryptWithECB`)

源码中请求加密出口 `security2.encryption` 返回 `{d: encryptWithECB(json)}`，
响应解密入口 `security2.decryption` 直接读 `t.data` 调 `decryptWithECB()`。
两者包装方式不同，不能互换。

### 下游不需要重新加密响应

上游已将服务器响应解密成明文 JSON 并删除了 `encrypt` 响应头。小程序
security2 看到无此头就跳过解密直接用明文。下游画蛇添足加密 + 加 `encrypt`
头反而触发了 Windows 微信上 `wx.request` 的 JSON 解析异常。

隔离方法：小程序直连 Burp + 上游 → 正常工作 → 锁定问题在下游。

### 关键启示

1. **SM4 不等于 AES** — `pycryptodome` 不带 SM4，需要 `gmssl` 或手写实现。
2. **请求和响应的 body 包装格式要分开确认** — 源码中加密切口和减密切口
   对 body 的处理可能完全不同。
3. **多层编解码要每一步都对齐** — hex → XOR → Base64，少掉一层或顺序
   搞错就会失败。用基线密文做 decrypt-first 验证可以一次性确认所有层。
4. **双代理不一定对称** — 下游不总是需要重新加密响应。确认小程序源码中
   响应解密的触发条件（header 标记？Content-Type？路径？），避免做多余
   的转换。
