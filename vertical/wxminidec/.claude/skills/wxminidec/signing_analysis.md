# Step 2 & 3: Locate the Signing Algorithm and Build the Reference

## Step 2: Locate the signing algorithm

Start with likely bundle files such as `common/vendor.js`,
`common/main.js`, and `common/runtime.js`, but search the complete
 decompiled output when the expected files or symbols are absent.

Useful search terms include:

```text
baseUrl
interceptor.request
wx.request
uni.request
fetch
axios
sign
signature
timestamp
md5
sha256
hmac
encodeURIComponent
getStorageSync
```

The following are search hints, not mandatory structure:

- a request interceptor may add signature headers;
- a request wrapper may append signature query/body fields;
- a hash function may be imported from a webpack module;
- token and user information may come from storage;
- request behavior may be configured per endpoint rather than globally.

Confirm the actual algorithm from the source and record:

- source file and line/function location;
- timestamp generation and accepted time units;
- input fields and fields excluded from signing;
- key sorting and JavaScript value-to-string behavior;
- special-character removal and its exact regex;
- URL encoding and hash algorithm/case;
- where the signature is placed: header, query, form body, JSON, or another
  field;
- hostname, HTTP method, path, and parameter conditions where signing applies;
- whether the signature uses plaintext data, ciphertext, or a separate subset
  of fields.

Do not assume that a signature is always in `interceptor.request`, always uses
MD5, or always uses the header names in the bundled example.

### If the source contains `__TENCENT_CHAOS_VM`

Tencent Chaos VM is a stack-based bytecode VM used to obfuscate critical
logic in WeChat Mini Programs. It is recognisable by the signature
`__TENCENT_CHAOS_VM("base64...", false)(...)`.

When you encounter this, **do NOT attempt to reimplement the obfuscated
algorithm in Python.** Instead, use Node.js to load and execute the actual
app modules — the full technique is documented in `chaos_vm_guide.md`.
Key principle: `require()` the obfuscated module directly in Node.js with
proper globals mocked, hook `wx.request` to capture the signed output,
and use that as your signing implementation.

Also read `pitfalls.md` for common mistakes when dealing with decompiled
Mini Programs.

### If the source contains string-table obfuscation (no Chaos VM)

Some apps use a lighter form of obfuscation: a **string array that is rotated
at init time**, combined with **index-based access via `arr[idx - N]`**.
The signature looks like:

```javascript
var _0x = ["encrypt", "key", "AES", "decrypt", ...];
// rotation loop shifts elements until a numeric condition is met
(function(arr, target) {
    while(1) {
        var check = parseInt(arr[i]) + ...;
        if (check === target) break;
        arr.push(arr.shift());
    }
})(_0x, 987654);

// After rotation, all indices are scrambled
function encrypt(e, t) {
    var n = _0x;
    // n(201) really means "word", n(192) really means "key", etc.
    return t[n(195)][n(217)](e[n(201)], e[n(192)], { ... });
}
```

**Recognition**: The module has a function that returns a hardcoded array of
short strings (`"encrypt"`, `"mode"`, `"CBC"`, `"toString"`, etc.), followed
by a `while(1)` rotation loop with `push(shift())` and a numeric break
condition.

**Extraction strategy** (simpler than full app loading):

1. Copy the string array and the rotation loop from the source into a
   standalone Node.js script.
2. Run the rotation loop in isolation — it only needs the array and the
   `parseInt` function, no app globals.
3. Read the rotated array to decode every `arr[idx - N]` access.
4. Concatenate the decoded string fragments to get the actual key, IV,
   header names, etc.
5. Verify by decrypting a captured baseline signature with the extracted key.

This is much faster than mocking 100+ WeChat APIs for full app loading.
Only fall back to full loading when the signing logic itself (not just
string constants) is obfuscated.

### When full app loading fails

The `sign_helper_template.js` approach requires mocking the entire
mini-program runtime (`wx.*`, `getApp()`, Taro APIs). Large apps
(10k+ lines of decompiled JS) can trigger dozens of module initializations
at require-time, each needing different mocks.

If you hit a cascade of `TypeError: X is not a function` errors during
`require()`:

1. **Try mock-ahead**: add the missing function to `global.wx` or
   `global.getApp()` and retry.  Common missing APIs: `setInnerAudioOption`,
   `getMenuButtonBoundingClientRect`, `createInnerAudioContext`,
   `getFileSystemManager`.
2. **If mocks exceed ~150 lines and still fail**: stop.  Switch to
   targeted extraction — isolate only the crypto/signing modules and
   extract their constants or run them in a minimal sandbox.
3. **Minimal sandbox**: extract just the target module's code, provide
   only the imports it actually uses (CryptoJS, a few utility functions),
   and call its exported functions directly.  This avoids loading the
   entire app.

The goal is to get the secrets and algorithm, not to run the entire
mini-program in Node.js.

## Step 3: Build the signing reference

Copy the bundled `sign_core.py` into `./output/sign_core.py` and adapt it to the
observed source. It exports reference functions such as:

```python
def compute_sign(data: dict, timestamp: int | None = None) -> tuple[str, int]
def extract_data(method: str, url: str, body: bytes = b"") -> dict
def build_headers(data: dict, token: str = "undefined", ...)
```

The bundled implementation currently demonstrates one common pattern:

1. use a millisecond timestamp;
2. sort parameter keys;
3. concatenate a fixed salt, timestamp, and `key=value` pairs;
4. apply the exact source regex;
5. apply JavaScript `encodeURIComponent` behavior;
6. hash UTF-8 bytes with MD5 and use uppercase hexadecimal output.

**Other common signing patterns** — the bundled template is just one
example.  Always derive the actual format from source code, not from
the template:

| Pattern | Sign string structure | Example |
|---------|----------------------|---------|
| Param sort + salt | `salt&key1=val1&key2=val2&...` → MD5/ HMAC | frequent in REST APIs |
| Multi-part concat | `path?query && headers_csv && body_json` → MD5 | XXXX `@XXXX/api-encrypt` |
| Sign-then-encrypt | `AES(json_payload)` → Base64 → header | AES-encrypted signature token |
| Header-only | HMAC of selected header values → Base64 | Gateway-style `X-Ca-Signature` |
| Body digest | MD5 of `JSON.stringify(body)` → header | Content-MD5 anti-tampering |

Key questions to answer from source before implementing:

- What are the **parts** of the sign string? (path? headers? body? query? all?)
- What **separator** joins them? (`&`, `&&`, `\n`, empty?)
- Are header names **lowercased** in the sign string?
- Is the body **JSON.stringify'd** before hashing, or used raw?
- Is the final signature placed in a **header**, **query param**, or **body field**?
- Is the sign value itself a **hex string**, **Base64**, or something else?
- If AES is involved, is it **sign-then-encrypt** or **encrypt-then-sign**?

`urllib.parse.quote` must preserve the JavaScript `encodeURIComponent`
characters `-_.!~*'()` and encode `/`, `=`, `&`, spaces, and other characters.
Use the target source and a captured baseline as the final authority. The
bundled `extract_data` only covers GET query and form-urlencoded POST as a
reference; JSON, nested values, repeated parameters, field-level encryption,
and custom serialization require app-specific changes.

Keep encryption functions separate from `compute_sign`. Do not silently
encrypt or decrypt inside the signing function.

> **Note for dual-proxy templates:** The downstream/upstream templates import
> `get_config()` and `set_config()` from `sign_core.py`, plus app-specific
> helpers such as `is_encrypted_request()` or `encrypt_body()`. The bundled
> `sign_core.py` does not export these yet — add them when you adapt it in
> Step 5. See the templates' TODO comments for the full list.
