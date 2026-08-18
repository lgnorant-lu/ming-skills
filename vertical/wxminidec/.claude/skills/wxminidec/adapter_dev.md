# Step 5 & 5b & 6: Build Dual-Proxy Adapters and Verify

## Step 5: Build dual-proxy adapters (downstream + upstream)

The standard approach uses **two mitmproxy instances** so Burp sees plaintext
in both directions:

```
Browser → :<downstream> (下游, MITM 解密) → Burp :8080 → :<upstream> (上游, 加密) → Server
```

| Instance | Port convention | Faces | Request | Response |
|----------|----------------|-------|---------|----------|
| 下游 (downstream) | 8082 | Browser/Mini Program | 密文→明文 | 明文→密文 |
| 上游 (upstream) | 8083 | Target server | 明文→密文 | 密文→明文 |

### Pre-implementation checklist (complete BEFORE writing code)

Answer every item below from the decompiled source. If an answer is unclear,
re-read the relevant source section. Guessing here produces the most common
and hardest-to-debug errors (content-MD5 mismatch, wrong body format, wrong
sign/encrypt order).

```
□ Host: exact hostname(s) the adapter handles? (not substring match)
□ Path: exact path or path pattern that triggers signing?
□ Path-dependence: does the request module's behavior change based on the
   URL path? (different params included in sign, different headers set)
□ Body serialisation: what does JSON.stringify() do to the body before
   signing? Does the body value pass through JSON.stringify once (dict →
   JSON object string) or twice (dict → ciphertext → JSON-quoted string)?
□ MD5 scope: is the Content-MD5 computed on the same byte string that is
   sent as the HTTP body?
□ Sign headers: exact header names that participate in the signature?
   What order? Lowercased in the sign string?
□ Sign algorithm: HMAC-SHA256? MD5? Other? What output encoding (Base64, hex)?
□ Content-Type: what value for encrypted POST? For plain POST?
□ Encryption trigger: which header/flag marks a request as encrypted?
   Is the flag on the request, the response, or both?
□ Encrypt-then-sign or sign-then-encrypt? This determines whether the
   signature covers plaintext or ciphertext.
□ Response decryption: what header and Content-Type combination triggers
   decryption? Is the response body raw ciphertext or JSON-wrapped?
□ Request body wrapper: how does the encryption function's output get
   wrapped into the HTTP body? (raw base64? `d=<base64>` form-encoded?
   `{"data":"hex..."}` JSON? a header field?) Trace the code path from
   the encryption return value to the actual bytes sent over HTTP.
□ Response body wrapper: how does the decryption entry point READ the
   body before decrypting? (same format as request? or different?) Do NOT
   assume it matches the request wrapper — read both code paths separately.
   E.g. the request may use `d=<base64>` form-encoded while the response
   decryption reads raw base64 from `t.data`.
□ Key material: where exactly are appSecret, aesKey, and other secrets
   defined in the source? Line numbers.
□ Multiple API hosts: does the app use more than one API host?
   If so, which hosts share the same encryption/signing scheme?
□ Cross-reference check (Rule 15): which values does the module place in
   multiple locations? (e.g. timestamp in header X + sign string, nonce in
   header Y + body param).  List every pair that must share one source.
```

### Implementation rules (mandatory, from Core Rules 13–15)

Three rules govern the adapter implementation. Violating any of them
produces signatures that look valid but fail server-side verification.

**Rule 13 — One source for every value.** The `compute_sign()` helper
(or equivalent) must extract internally-generated values from the module's
output. It must never generate its own timestamps, nonces, or IVs and then
use them in headers or body fields that the module also populates.  Parse
the values from the module's stdout/stderr instead.

```python
# BAD — two independent timestamps that will never match
timestamp = int(time.time() * 1000)
sign, _ = compute_sign(data)  # module generates its own internal ts
flow.request.headers["X-Timestamp"] = str(timestamp)  # mismatch!

# GOOD — one timestamp, extracted from the module output
sign, ts = compute_sign(data, path=req_path, method=req_method)
# compute_sign parses the actual requestSignTime from the module's stderr
flow.request.headers["X-Timestamp"] = str(ts)
```

**Rule 14 — Explicit path and method.** `compute_sign()` must accept the
actual HTTP path and method as arguments. No hardcoded default path. The
upstream adapter passes `flow.request.path` and `flow.request.method`
directly.  If the sign helper receives a URL path, verify it matches the
inbound request path byte-for-byte.

```python
# BAD — hardcoded default path
def compute_sign(data, timestamp=None):
    path = "/sip/apppay/queryHospitalInfo"  # wrong for every other endpoint!
    ...

# GOOD — caller supplies the real path
def compute_sign(data, timestamp=None, path="", method="post"):
    ...
```

**Rule 15 — Cross-reference audit before declaring done.**  After
building both adapters, pick one baseline request.  Print every value
that the module distributes across multiple locations (headers, body
params, sign string) and verify they are byte-identical and sourced from
the same module output.  Map your app's specific field pairs:

| Module output | Header | Body/Sign string | Check |
|---------------|--------|------------------|-------|
| `requestSignTime=1734567890123` | `Requestsigntime` | inside sign plaintext | must be identical |
| *(your app's nonce)* | *(your header)* | *(your body)* | must be identical |

If any pair differs, trace the value back to its source and ensure both
uses read from the same variable.

### 5a. Extract and embed secrets as defaults

The most critical step. **Secrets found in the decompiled source must be
embedded as hardcoded defaults in `sign_core.py`.** Users typically do not
know what `appSecret` or `aesKey` are and will not set them. The adapter
must work out-of-the-box without environment variables.

Search the decompiled source for hardcoded keys:

```text
none1 none2 appSecret aesKey caKey secret key
```

Common patterns in WeChat Mini Programs:
- Double-base64-encoded strings passed through helper functions
- Plain hex strings
- Strings stored in obfuscated variables at class construction time
- Values from `wx.getStorageSync` that have hardcoded fallbacks

For every extracted secret, verify it against a Burp baseline by computing
the signature with that secret and comparing to the captured value. Do NOT
assume a secret is correct without baseline verification.

Embed verified secrets into `sign_core.py` defaults:

```python
_cfg: dict = {
    "caKey": "ngari-wx",           # from source line XXX
    "appSecret": "a9d4eb7...",     # extracted from source, verified against baseline
    "aesKey": "vss7db...",         # extracted from source
}
```

### 5b. Environment variable overrides — do NOT overwrite with empty values

This is a hard rule. The adapter must NOT wipe out built-in defaults with
empty environment variable values. The following pattern is **BUGGY**:

```python
# BUG: empty env var overwrites built-in default with ""
set_config(appSecret=os.environ.get("MITM_APP_SECRET", ""))
```

Use this pattern instead — only override when the env var is non-empty:

```python
_env_overrides = {}
for _env_key, _cfg_key in [("MITM_APP_SECRET", "appSecret"), ("MITM_AES_KEY", "aesKey")]:
    _val = os.environ.get(_env_key, "")
    if _val:                                    # <-- critical: skip empty
        _env_overrides[_cfg_key] = _val
if _env_overrides:
    set_config(**_env_overrides)
```

The status message in `__init__` must read from the actual config (via
`get_config()`), NOT from raw `os.environ`. This avoids misleading the user
into thinking secrets are missing when built-in defaults are active.

### 5c. Downstream script structure

Copy `mitm_downstream_template.py` to `./output/mitm_downstream.py`.

**The downstream does NOT set `flow.server_conn.via` or handle CONNECT.**
Routing is entirely handled by the startup command. The script only does
body transformation:

```python
def request(self, flow):
    if not self._handles(flow):
        return
    # Decrypt body: {"data":"hex..."} → plaintext JSON
    # Burp sees the plaintext

def response(self, flow):
    if not self._handles(flow):
        return
    # Encrypt body: plaintext JSON → {"d":"hex..."}
    # Browser gets the ciphertext
```

**Startup command** (three required flags):

```powershell
mitmdump -s ./output/mitm_downstream.py -p 8082 `
    --mode upstream:http://127.0.0.1:8080 `
    --set upstream_cert=false `
    --ssl-insecure
```

| Flag | Purpose |
|------|---------|
| `--mode upstream:http://127.0.0.1:8080` | Forward decrypted HTTP to Burp |
| `--set upstream_cert=false` | Defer upstream connection so MITM happens first. Without this, mitmproxy eagerly connects upstream and `request()` never fires for HTTPS. |
| `--ssl-insecure` | Trust self-signed certs from the target server |

> **Note:** The deprecated `--no-upstream-cert` flag is equivalent to
> `--set upstream_cert=false` in mitmproxy 10+.

### 5d. Upstream script structure

Copy `mitm_upstream_template.py` to `./output/mitm_upstream.py`.

The upstream receives plaintext HTTP from Burp (Burp already terminated TLS).
No special startup flags needed:

```powershell
mitmdump -s ./output/mitm_upstream.py -p 8083
```

The upstream handles two inbound scenarios for requests:

1. **Plaintext inbound** — the arriving body is JSON the user edited in Burp.
   Encrypt it, add any required signing/query params, send to server.

2. **Pre-encrypted inbound** — the body is still `{"data":"hex"}` (user
   replayed without downstream decryption). Decrypt first, then re-encrypt.

For response: decrypt `{"d":"hex"}` back to plaintext JSON for Burp.

#### Signing-only adapters (no application-layer encryption)

When the app uses request signing but NO body encryption, the upstream adapter
must **re-sign requests after Burp edits them**. The downstream is typically a
pass-through (bodies are already plaintext).

The upstream request handler must do the following in one `try/except` block:

| Step | Operation | Notes |
|------|-----------|-------|
| 1 | Parse params from body (form, JSON, or query) | `req.urlencoded_form`, `req.json()`, or `req.query` |
| 2 | Remove old `sign`/`countersign` fields | `params.pop("sign", None)` |
| 3 | Call `compute_sign(method, path, params)` | Uses the actual `req.path` and `req.method` |
| 4 | Write new sign back into params | `params["sign"] = sign` |
| 5 | Rebuild the body with new params | Per-key assignment, NOT `set_all()` |
| 6 | Update signing-related headers | `sign`, `requestSignTime`, etc. |

**Body format decision**: match the Content-Type the server expects. For
form-encoded bodies, use `req.urlencoded_form` with per-key `form[k] = v`.
For JSON bodies, serialise with `json.dumps()` and assign to `req.text`.
For GET requests, use `req.query` with the same per-key pattern.

**Error handling**: If any step fails, log the error and return without
modifying the request. The original (unsigned) request goes through, and
the server's error response tells the user what went wrong. Never silently
forward a half-transformed body.

### 5e. Burp configuration

In Burp Suite:
- Proxy → Options → Upstream Proxy Servers → Add:
  - Destination host: `<target API host>`
  - Proxy host: `127.0.0.1`
  - Proxy port: `8083` (upstream)

Browser/Mini Program proxy settings point to `127.0.0.1:8082` (downstream).

### 5f. Verify before declaring done

Before reporting the adapter as complete:
1. Verify the extracted secrets produce the correct signature/ciphertext for at
   least one baseline request (see Step 4).
2. Test that `mitmdump -s ./output/mitm_upstream.py -p 8083` starts without errors.
3. Test that the downstream command with all three flags starts without errors.
4. Kill both test processes after verification.

The downstream logs `DECRYPTED`/`ENCRYPTED response` only after a confirmed
app-specific rule matches and its transformation succeeds. The upstream logs
`encrypted`/`decrypted response` under the same condition. Unconfigured
reference templates intentionally leave bodies unchanged.

---

## Step 5b: Determine and implement application-layer encryption (conditional)

Only implement this step when source analysis or baseline traffic indicates
application-layer encryption. A user mentioning encryption starts an
investigation; it does not enable encryption automatically.

### 5b-1. Inspect the source and baseline traffic

Search the decompiled source for:

```text
AES DES encrypt decrypt CryptoJS base64 btoa atob cipher iv mode padding
```

For every confirmed rule, answer all of these questions:

- Is the request body, response body, or both encrypted?
- Is the entire body encrypted, or only a query/form/JSON parameter?
- Which exact hostname, method, and path use it?
- Is the body encoded as Base64, URL-safe Base64, hex, JSON, or another form?
- What algorithm, mode, key representation, IV/nonce source, and padding are
  used?
- Does signing cover plaintext, ciphertext, or another field?
- Is the order sign-then-encrypt or encrypt-then-sign?
- Does the response use the same or a different rule?

A Burp baseline takes precedence over a generic crypto pattern in the source.
If a body is readable in the baseline, leave it unencrypted unless source and
traffic show that a specific field is transformed elsewhere.

If no encrypted request/response can be found in Burp history, or MCP is not
available, ask the user for:

- hostname, method, and path of the encrypted interface;
- the encrypted parameter or whether the whole body is encrypted;
- a raw HTTP request and corresponding response;
- the relevant signature, timestamp, headers, and content type;
- any known key/IV/mode/padding or source location.

Continue the other steps if the user cannot provide these details, but do not
enable crypto by guesswork. Record the range as unconfirmed and disabled.

### 5b-2. Configure only confirmed rules

Represent each confirmed crypto rule in the app-specific adapter with at
least:

| Field | Example meaning |
|---|---|
| hostname | exact host or explicit host allowlist |
| method | `GET`, `POST`, or another method |
| path | exact path or documented path prefix |
| scope | one field, query parameter, form parameter, or whole body |
| direction | request decrypt/encrypt or response decrypt |
| encoding | Base64, hex, JSON string, etc. |
| algorithm | AES mode and padding, based on source |
| order | sign-then-encrypt or encrypt-then-sign |
| evidence | Burp history item or user-supplied request/response |

Request and response rules are independent. A request rule must not imply a
response rule. A rule must not match every endpoint on a host unless the
baseline evidence explicitly establishes that scope.

The bundled `sign_core.py` AES functions cover only a common Base64/AES/PKCS7
reference flow. Rewrite them when the source uses a different format. Do not
add automatic algorithm guessing.

### 5b-3. Proxy behavior

The adapter should follow this sequence only when its confirmed rule says so:

- decrypt a captured encrypted request before extracting/signing plaintext;
- sign plaintext and then encrypt it for sign-then-encrypt;
- encrypt first and sign ciphertext for encrypt-then-sign;
- decrypt only responses covered by a confirmed response rule.

If no crypto rule matches, leave the original body unchanged. If a confirmed
transformation fails, print the operation, method, hostname/path, exception
type, and message. Keep the original content when possible rather than
silently passing a corrupted or partially transformed body.

---

## Step 6: Verify the constructed request and response

Use two simple verification angles.

### Request comparison

Construct a request from the same baseline inputs and timestamp and compare:

- the generated signature with the baseline signature;
- the generated ciphertext with the baseline ciphertext when encryption is
  deterministic;
- for random IV/nonce encryption, the decoded structure, decryptable content,
  or other protocol properties confirmed from the source instead of requiring
  identical ciphertext bytes.

A newly generated live request with a new timestamp cannot be expected to
have the same signature bytes as an old baseline. Compare its structure and
server result instead.

### Response comparison

If a live request is sent, compare its response with the corresponding
baseline response. Check the HTTP status, content type, response shape, and
normal-success indicators visible in the baseline. Also check for explicit
failure indicators such as invalid token, bad signature, or parameter errors.
Do not require a fixed field such as `resultCode: "00"`; the baseline
response determines what success looks like.

Live testing is optional. If the user has no valid token, no reachable test
service, no mitmproxy, or no Burp MCP, mark live verification as pending and
tell the user how to perform the comparison themselves. This does not block
the offline analysis or script preparation.
