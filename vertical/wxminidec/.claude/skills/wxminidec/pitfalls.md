# Common Pitfalls — WeChat Mini Program Reverse Engineering

## 1. Decompiled code cannot run in WeChat DevTools

**Problem**: wedecode converts `.wxml` to `.html`, uses backslashes in
`app.json` paths, and plugin references (`plugin:\`) break on Windows.

**Fix**: Rename `.html` → `.wxml`, replace `\\` → `/` in app.json.
But accept that complex plugins and subpackages may never load.
**WeChat DevTools is not a reliable way to run decompiled code.**

**Better**: Use Node.js to load individual modules — skip the UI entirely.

## 2. Do not guess the signing algorithm from traffic alone

**Problem**: Saw 1568 hex chars in the baseline sign, assumed SM4-CFB
encryption. The actual algorithm was the full request module chain
(including MD5 hashing + custom encryption), not simple SM4.

**Lesson**: If the sign output length doesn't match any standard algorithm
for the given input length, the algorithm is more complex than a single
crypto primitive. Run the actual code.

## 3. jscode2session excludes jsCode from the sign string

**Problem**: The login endpoint calls `wx.login()` internally. The sign is
computed on `{hospitalId, synUserName, synKey}` WITHOUT jsCode. jsCode is
added to the body AFTER signing.

**Fix**: Preserve original params (deep copy before passing to the request
module) and merge them back into the body. The sign_helper must use
`wx.login()` mock that returns the real jsCode from the original request.

## 4. Timestamp in sign string MUST match Requestsigntime header

**Problem**: The request module generates its own timestamp internally
(`new Date().getTime()`) which goes into the sign string. If the adapter
generates a different timestamp for the `Requestsigntime` header, the
server rejects the request as "签名错误".

**Fix**: Parse `requestSignTime=(\d{13})` from the sign_helper's debug
output, and use THAT value as the `Requestsigntime` header.

## 5. PowerShell mangles JSON in command-line arguments

**Problem**: Testing `node sign_helper.js POST /path '{"key":"value"}'` in
PowerShell corrupts the JSON due to quote escaping.

**Fix**: Test via Python `subprocess.run()` which handles argument passing
correctly, or use a `.js` test harness with `child_process.spawnSync()`.

## 6. Decompiled modules have circular dependencies

**Problem**: Modules like CryptoJS have internal circular references.
Simple recursive `Object.keys()` scanning causes stack overflow.

**Fix**: Use a `visited` Set when recursively inspecting module exports.

## 7. The `define()` sandbox cannot run Chaos VM functions

**Problem**: Using `vm.createContext()` + custom `define()` to load
app-service.js modules. The Chaos VM functions fail because closure
dependencies on `CryptoJS`, `require()` results, and global state are
not properly initialized in the sandbox.

**Fix**: Skip the sandbox entirely. Use direct `require()` in Node.js
with a `Module.prototype.require` hook to resolve module paths.

## 8. Sign length can help identify the algorithm

| Sign Length | Likely Algorithm |
|-------------|-----------------|
| 32 hex | MD5 |
| 40 hex | SHA1 |
| 64 hex | SHA256 |
| 128 hex | SHA512 |
| 1568 hex (784 bytes) | Complex chain (MD5 + custom encryption), not a standard primitive |
| 1024 hex (512 bytes) | RSA-4096 PKCS1v1.5 |
| Variable, multiple of 32 hex | SM4/AES block cipher |

If the sign length doesn't match any of these for the given input,
**don't guess — run the code**.
