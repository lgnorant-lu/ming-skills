# Troubleshooting

## Downstream: no DECRYPTED log for target host (request body stays encrypted in Burp)

This is the most common dual-proxy issue. Debug in order:

1. **Wrong proxy config** — verify the browser/Mini Program proxy points to
   the **downstream** port (not directly to Burp). If the upstream terminal
   shows `is_enc=True` (body arriving as `{"data":"hex"}`), the client is
   sending encrypted data — meaning the downstream was bypassed.
2. **Missing `--set upstream_cert=false`** — without this flag, mitmproxy
   eagerly connects to the upstream proxy during CONNECT, the tunnel is
   forwarded without MITM, and `request()` never fires for HTTPS.
3. **Missing `--ssl-insecure`** — the target server may use a self-signed
   certificate. The error `Certificate verify failed: self-signed certificate`
   means mitmproxy aborted the MITM. Add `--ssl-insecure`.
4. **mitmproxy CA not trusted** — the client must trust the mitmproxy CA
   certificate. On Windows, install it to "Trusted Root Certification
   Authorities". On WeChat, mitmproxy CA must be installed system-wide.
5. **`--no-upstream-cert` is deprecated** — in mitmproxy 10+, use
   `--set upstream_cert=false` instead. The old flag produces "unrecognized
   arguments" error.

## Downstream: mitmdump rejects `--no-upstream-cert` and exits

Error: `mitmdump: error: unrecognized arguments: --no-upstream-cert`

The `--no-upstream-cert` flag was deprecated in mitmproxy 10+. Replace it:

```powershell
# 旧版参数（仅历史版本）
mitmdump ... --no-upstream-cert

# 当前 mitmproxy
mitmdump ... --set upstream_cert=false
```

## Downstream: "Cannot change server.via on open connection"

This error means `flow.server_conn.via` is being set inside `request()` (too
late — the server connection is already established). **Do not set `via` in
the addon at all.** Routing is handled by the `--mode upstream` CLI flag.

## Upstream: body arrives as ciphertext (is_enc=True)

This means the downstream is not in the path. The request went direct to Burp
and from Burp to the upstream. The upstream should handle this gracefully:
if `is_encrypted_request()` returns true, decrypt the body first, then
re-encrypt with fresh ciphertext.

## Server returns "parameter missing" after re-encryption

This usually means the body format doesn't match what the server expects.
Check that:
- `Content-Type` is set correctly (usually `application/json`)
- The encrypted body is wrapped in the correct JSON structure
  (e.g., `{"data":"hex..."}` not raw hex)
- Query parameters (guid, v, source) are present if required

## Python script fails before running

Confirm Python 3.10 or later:

```powershell
python --version
```

Then run the dependency checker and inspect the printed exception instead of
assuming a missing optional dependency is a signing failure.

## mitmproxy script fails to load (ModuleNotFoundError)

mitmproxy standalone binaries include their own Python environment. If the
error is `ModuleNotFoundError: No module named 'Crypto'`:

1. Check that `sign_core.py` uses lazy imports (import `Crypto` only inside
   `encrypt_body`/`decrypt_body`, not at module level).
2. The standalone binary cannot use pycryptodome. Install the current Python
   mitmproxy and pycryptodome instead:

```powershell
python -m pip install mitmproxy pycryptodome -i https://pypi.tuna.tsinghua.edu.cn/simple
```

3. Verify the selected executable with `(Get-Command mitmdump).Source`.

## mitmproxy process left running after test

测试命令必须在 `finally` 中只停止本次 `Start-Process` 返回的 PID。不要使用
不要运行 `Stop-Process -Name mitmdump`，因为它可能终止用户已经运行的代理。若端口仍被占用，先检查监听进程：

```powershell
Get-NetTCPConnection -LocalPort 8082,8083 -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalAddress,LocalPort,OwningProcess
```

## Server returns "error signature" after re-signing

This is almost always a key mismatch. Debug in order:

1. **Empty secret due to env var overwrite** — the adapter's
   `os.environ.get("KEY", "")` may have overwritten a hardcoded default with
   `""`. Check that `set_config()` only receives non-empty overrides. Verify
   by adding a temporary `print(get_config())` at adapter startup.

2. **Wrong secret** — decode the source's obfuscated key values (common
   patterns: double-base64, hex, string reversal) and verify by computing
   the HMAC of a known baseline request. If the computed signature matches
   the captured one, the secret is correct.

3. **Sign string format** — diff the constructed sign string against the
   expected format from the source. Check header order, key casing (lowercase
   in this protocol), separator characters, and trailing `&`.

4. **Body mismatch** — verify that the body fed to `md5_base64()` is
   byte-for-byte identical to what `JSON.stringify()` would produce. For
   encrypted requests, the body is the JSON-quoted ciphertext string.

## Server returns "contentMd5 error" or similar

This means the `Content-MD5` header does not match the body bytes the server
received. The signature itself may be valid, but the MD5 digest of the body
is wrong. Debug in order:

1. **MD5 computed on wrong data** — the adapter is computing MD5 on the
   plaintext dict when the body sent is the ciphertext, or vice versa. The
   MD5 input must be byte-for-byte identical to the actual HTTP body.

2. **Inbound encrypted body not decrypted** — the adapter received an
   already-encrypted body from a replayed request, did not detect the
   encryption indicator, and either double-encrypted or computed MD5 on
   the wrong payload. See Step 5c inbound body state detection.

3. **JSON.stringify semantics** — if the source does `JSON.stringify(body)`
   and the adapter passes the raw string without quoting, the MD5 will
   differ. `JSON.stringify("ciphertext")` produces `"ciphertext"` (with
   double-quote characters as part of the body). The adapter must match
   this exactly.

4. **Body modified after MD5** — the adapter computed MD5, then a later
   step changed the body (e.g. re-encoding, adding fields, changing
   separators). The MD5 must be the last thing computed before the
   request is sent.

## Signature mismatch

Compare the baseline and implementation in this order:

1. exact fields and value types;
2. timestamp and units;
3. key sorting;
4. string concatenation and special-character removal;
5. JavaScript `encodeURIComponent` reserved characters;
6. UTF-8 bytes and hash case.

## Addon error: `_MultiDict.set_all() missing 1 required positional argument: 'values'`

mitmproxy 11 changed `MultiDict.set_all()` from "replace entire multidict" to
"replace values for one key". Code that calls `form.set_all(list_of_tuples)`
on mitmproxy 10 will crash on mitmproxy 11.

Fix: use per-key assignment instead of `set_all()`:

```python
# Before (broken on mitmproxy 11)
req.urlencoded_form.set_all([(k, str(v)) for k, v in params.items()])

# After (works on mitmproxy 10 and 11)
for k, v in params.items():
    req.urlencoded_form[k] = str(v)
```

The same pattern applies to `req.query` for GET parameters.

## Addon error logged but request still returns 200

This means an exception was thrown in `request()` or `response()` but the
unmodified request/response was forwarded anyway. The server returned
success — but the signing/encryption step was SKIPPED, so the response
is actually from an unsigned or stale-signed request.

Check the terminal for "Addon error:" lines above the HTTP status line.
If the error is in `set_all`, see the troubleshooting entry above.
If it's a different error, the body manipulation code is outside the
`try/except` block — move it inside.

To verify: comment out the `try/except` temporarily and re-run to see
the full traceback. Then wrap ALL body/header mutation in one `try` block.

## Adapter does not process a request

Print and compare the actual hostname, method, and path with the adapter's
rules. A path or hostname mismatch is preferable to accidentally modifying an
unconfirmed endpoint.

## Burp shows plaintext both ways but Mini Program shows errors

Burp 能看到双向明文说明上游的加解密逻辑是正常的。问题出在下游发回给小程序
的报文格式上。最快的定位方法：

1. **绕过下游** — 把小程序代理直接指向 Burp（`127.0.0.1:8080`）。
2. 如果直连 Burp + 上游正常，问题在下游：可能是下游对响应做了不必要的
   重新加密，或者重新加密后的 body 包装格式（`d=<base64>` vs 裸 base64 vs
   JSON 嵌套）和小程序源码中的解密入口不匹配。
3. 如果直连仍然有问题，排查上游的请求转换或响应处理。

这个 2 分钟测试能省掉大量 header 格式对比和猜测的时间。一旦确认问题在下游，
检查方向：
- 下游是否在 response() 里重新加密了响应？小程序是否真的需要加密响应？
- 如果小程序有类似 `encrypt: true` 响应头来触发解密，下游重新加密后是否
  正确设置了这个头？上游解密响应后是否删除了它？
- 响应密文的包装格式（裸 base64 / JSON 字段 / 其他）是否和源码中
  decryption 入口的参数格式完全一致？

## Request or response decryption fails

Check the confirmed rule before changing crypto parameters. Verify the body
scope, Base64/hex layer, key representation, IV source, mode, padding, and
signing order against the source and baseline. The adapter should print the
exception and retain the original body so the failure can be inspected.

## No Burp MCP is available

Continue source analysis and offline script preparation. Ask the user for a
raw baseline request and response, including the signature/ciphertext values
needed for comparison. If they prefer to verify manually, provide the exact
constructed request fields and the comparison criteria, and mark the report
as user-verified or pending rather than claiming automatic verification.

## UnpackMiniApp.exe fails to decrypt

1. Verify the file header is `V1MMWX` — if not, the file is already
   decrypted and can go directly to wedecode.
2. Check that the wxapkg path's parent directories contain the correct wxid
   (a directory name starting with `wx`). The tool extracts this from the
   path to derive the decryption key. For a file at
   `target\wx43************a8\17\__APP__.wxapkg`, the wxid is
   `wx43************a8`.
3. If the error is "填充无效，无法被移除" (padding is invalid), the wrong
   wxid was used — check the path structure.
4. If the output is still not usable, verify the input package and output path,
   then continue with the normal Windows runtime diagnostics. The dependency
   checker does not perform a separate .NET Framework check.
