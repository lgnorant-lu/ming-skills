# Step 4: Verify Signing Against Baseline Traffic

## 4a. Obtain a baseline request

**Step 0 — Confirm MCP is reachable (MANDATORY before any Burp lookup).**

Call `mcp__burp-ai-agent__status` first.  If it returns a valid response
(version, extension status), MCP is connected.  If the call fails or the
tool is absent from your tool list, MCP is genuinely unavailable — skip to
the fallback at the end of this section and mark baselines as pending.

**You must attempt this call.** The `[NA]` line from `check_env.py` is NOT
a valid reason to skip.  See Core Rule 5.

Once MCP is confirmed available, use a **layered lookup** to find
relevant traffic. Do NOT blindly pull the full proxy history — Chrome
background traffic will dominate the first pages.

Two Burp MCP tools are relevant:

| Tool | Scope | Regex matches against |
|------|-------|-----------------------|
| `site_map_regex` | Items in target scope | URL string |
| `proxy_http_history_regex` | All proxy history | Full serialised request + response |

`site_map_regex` only returns results when the host was added to Burp's
target scope. This is the ideal case, but users commonly do not add every
app to scope. When `site_map_regex` returns nothing, the traffic almost
certainly still exists in proxy history — fall back to the history tools.

`proxy_http_history_regex` matches the **entire serialised entry**
(request line, request headers, request body, response status, response
headers, response body). A bare hostname like `weixin.ngarihealth.com`
will also match:
- `Referer: https://weixin.ngarihealth.com/...` in requests to OTHER hosts
- `Host: weixinnode.ngarihealth.com` (CDN host containing the target
  string as a substring)
- JS source code served from CDN that references the hostname

**Always anchor the regex to the HTTP request line or Host header** to
eliminate these false positives. The patterns below demonstrate the right
approach.

---

**Layer 1 — Extract the exact hostname from source.**

Revisit the SERVER_URL / baseUrl values found in the decompiled source
(Step 2). Parse the hostname from each URL and build a list of exact
hostnames, e.g. `weixin.ngarihealth.com`, `dev.ngarihealth.com`,
`zjshlwyy.zjjgpt.com`.

Prioritise the hostname that appears in the production or default
configuration. If the source has multiple environments, start with the
production host.

**Record this hostname list explicitly.** Every hostname on this list
MUST be tried (Layer 3) before concluding that no traffic exists. Do NOT
skip straight to wildcard patterns.

**Layer 2 — Search Burp's site map (target scope) first.**

The site map is the fastest and cleanest source — it only contains hosts
the user has added to scope. Try exact hostname first, then wildcard:

```
mcp__burp-ai-agent__site_map_regex(regex="<exact hostname>", count=5, offset=0)
```

If no results, try a wildcard regex that matches subdomains or related
hosts (the regex parameter is a standard regex — `.` matches any char,
`.*` is the wildcard):

```
mcp__burp-ai-agent__site_map_regex(regex="ngarihealth\.com", count=5, offset=0)
mcp__burp-ai-agent__site_map_regex(regex="<partial>.*\.com", count=5, offset=0)
```

If a result file was saved due to size, read it in small chunks
(offset/limit). If all site map queries return nothing, the host is not
in scope — proceed to Layer 3. This is common and does NOT mean traffic
is absent.

**Layer 3 — Search proxy history: exact hostnames first, then wildcards.**

The regex matches the full request + response text. Anchor to the HTTP
Host header for precision. `Host: ` as a literal prefix ensures you only
match the actual request target, not Referer headers or response body
content.

**Step 3a — Iterate through every exact hostname from Layer 1.**

For each hostname on the Layer 1 list (production host first):

```
mcp__burp-ai-agent__proxy_http_history_regex(regex="Host: <exact hostname>", count=5, offset=0)
```

If the result is saved to a file (too large), do NOT skip it. Use the
**keyword filtering** technique in Step 3b below to locate relevant
entries without reading the entire file.

If no results for a hostname, try paginating:

```
mcp__burp-ai-agent__proxy_http_history_regex(regex="Host: <exact hostname>", count=10, offset=0)
mcp__burp-ai-agent__proxy_http_history_regex(regex="Host: <exact hostname>", count=10, offset=10)
```

**Step 3b — When a result file is too large, filter by source keywords.**

Do NOT read the entire file blindly. Instead, use Python to scan for
entries containing keywords you already know from source analysis —
signing header names, path patterns, encryption indicators, parameter
names. This pinpoints the exact entries to read:

```powershell
python -c "
text = open(r'<result_path>', encoding='utf-8').read()
# Use keywords discovered during source analysis (Step 2/3)
keywords = ['X-Ca-Signature', 'X-Service-Encrypt', 'gateway', 'X-Content-MD5']
for kw in keywords:
    idx = text.find(kw)
    if idx >= 0:
        # Print surrounding context (500 chars each side)
        start = max(0, idx - 500)
        end = min(len(text), idx + len(kw) + 500)
        print(f'=== Found keyword: {kw} at offset {idx} ===')
        print(text[start:end])
        print('...')
"
```

If no source keywords match, the file may contain only unrelated traffic
(CDN assets, images). In that case, try the next hostname.

**Step 3c — Only after ALL exact hostnames have been tried**, use
wildcard patterns as a last resort:

```
mcp__burp-ai-agent__proxy_http_history_regex(regex="Host: .*ngarihealth", count=5, offset=0)
```

**Step 3d — Before concluding "no traffic found."**

List every hostname you tried alongside the hostnames from Layer 1.
If you did not try a hostname from the Layer 1 list, explain why.
This checklist prevents prematurely declaring failure when the correct
hostname was simply never searched.

**Layer 4 — Narrow to the exact baseline request.**

Once you have confirmed traffic exists for a hostname, retrieve
just the signing-relevant requests. Use the exact hostname combined
with path or method filters. Prefer path-based anchors over
header-in-body patterns — the proxy history regex matches the full
serialised text, and header names like `X-Ca-Signature` also appear
in JS source code within CDN responses, producing false positives.

Recommended narrowing order:

```
# 1. Exact hostname + HTTP method + path keyword from source
mcp__burp-ai-agent__proxy_http_history_regex(regex="POST.*Host: <hostname>", count=5, offset=0)

# 2. Exact hostname + signing header name (anchored to avoid JS false positives)
mcp__burp-ai-agent__proxy_http_history_regex(regex="Host: <hostname>.*X-Ca-Signature", count=3, offset=0)
```

Note: `Host: <hostname>.*gateway` only matches if "gateway" appears
on the same line or within the same regex match span as the Host header.
If the path `/weixin/gateway` is on a different line in the serialised
output, this regex will miss it. Prefer `POST.*Host: <hostname>` or
use the keyword filtering technique from Step 3b on saved result files.

You only need **one reliable baseline request** per signing variant
(GET vs POST, encrypted vs plaintext).

Record for each baseline:

- method, full URL/path, query parameters, and body;
- the exact value of every signing-related header found in Step 2/3;
- timestamp and baseline signature value;
- token/user data only as needed by the implementation;
- the corresponding response status, content-type, and body excerpt.

If MCP is not installed or available, continue without querying it. Tell the
user that automatic Burp history lookup and automatic baseline comparison are
unavailable. Ask the user to provide a raw HTTP request and response, or the
minimum equivalent fields above. If the user cannot provide them, continue
source analysis and script preparation, but mark signing correctness as
pending user verification.

## 4b. Save baselines to the output directory

For every confirmed baseline request and response, save the raw data to
`./output/baselines/` so the verification script can read it automatically.
Long hex ciphertexts must not be copy-pasted by hand — use Python to extract
them from Burp output. This also creates an audit trail for human review.

Directory structure:

```
output/baselines/
  _metadata.json            # structured request/signature metadata
  001_request.txt           # optional raw HTTP request
  001_req_encrypted.txt     # optional captured request ciphertext
  001_req_plaintext.txt     # optional decrypted request plaintext
  001_resp_encrypted.txt    # optional captured response ciphertext
  001_resp_plaintext.txt    # optional decrypted response plaintext
  002_request.txt           # additional raw baselines
  ...
```

`_metadata.json` should carry enough information for automatic signature
verification. The preferred format is:

```json
{
  "hostname": "ws.kukeduo.cn",
  "baselines": [
    {
      "id": "001",
      "method": "POST",
      "path": "/UserWebService.asmx/UserLogin",
      "raw_request": "001_request.txt",
      "description": "UserLogin request/response with AES-CBC encryption",
      "signature_header": "sign",
      "timestamp_header": "timestamp",
      "sign_data": {"hospitalId": 1, "synUserName": "demo"},
      "signature": "CAPTURED_SIGNATURE",
      "evidence": "Burp proxy history: POST Host: ws.kukeduo.cn"
    }
  ]
}
```

如果 `sign_data` 没有提供，验证脚本会从 raw request 或明文 body 自动解析
JSON/form 参数；如果签名值、时间戳或字段范围无法可靠推导，只报告最小缺失
字段并标记为 `PENDING`，不会要求人工填写 Python `TEST_CASES`。

`_metadata.json` 和 baseline 文件写入 `./output/baselines/`，由
`verify_sign.py` 自动读取。密文/明文文件仍可用于自动加解密往返检查。

> 这些文件包含实时 API 流量。`output/` 应排除在版本控制之外，不要提交到公开仓库。

## 4c. Run the automatic offline check

复制并按应用实际函数适配 `./output/verify_sign.py` 后直接运行：

```powershell
python ./output/verify_sign.py
```

验证脚本优先读取结构化 metadata 和 raw request，自动构造签名输入并比较
baseline 签名；同时自动加载请求/响应密文文件进行解密检查。不要人工填写
`TEST_CASES` 作为正常流程。签名基线缺少关键字段时退出状态为 `PENDING`（非零），
没有确认签名接口时在 metadata 中设置 `"signing": false` 才标记为 N/A。

**确定性加密：重加密一致性检查。** 当加密算法是确定性的（ECB 模式、
无随机 IV），adapter 的 `encrypt_body(plaintext)` 必须产出一个和
基线密文字节一致的输出。这能捕获所有格式错误：body 包装方式不对
（裸 base64 vs `d=<base64>`）、密钥推导错误、编解码层多余或缺失、
`json.dumps` 序列化差异等。在声明 adapter 完成前，至少对一个基线响应
明文跑这个检查——如果确定性的加密输出和基线不匹配，就一定有问题。

```python
# 在 verify_sign.py 中加入这个检查
plain = decrypt_body(baseline_ciphertext)
re_enc = encrypt_body(plain)
assert re_enc == baseline_ciphertext, "re-encrypt mismatch!"
```

签名失败时按以下顺序检查：

1. exact input fields and their types;
2. timestamp value and units;
3. sorting and JavaScript value serialization;
4. special-character regex and operation order;
5. JavaScript URL encoding behavior;
6. hash input bytes and output case.

**AES-encrypted signatures: decrypt-first verification.** When the source
encrypts the sign payload with AES (recognisable by `AES.encrypt()` or
`CryptoJS.AES.encrypt()` in the signing module), the fastest way to
confirm the extracted key is:

1. Base64-decode the captured `X-Api-Key` (or equivalent header).
2. AES-CBC decrypt it with the candidate key and IV.
3. If the result is valid JSON with expected fields (`accessEntry`,
   `timestamp`, `hashDigest`, etc.), the key is confirmed.
4. Only then implement the full sign pipeline (hash → JSON → AES → Base64).

This is faster than building the entire signing chain first and comparing
final signature values. A successful decrypt gives immediate confidence
that the key extraction was correct, even before the hash algorithm is
fully implemented.
