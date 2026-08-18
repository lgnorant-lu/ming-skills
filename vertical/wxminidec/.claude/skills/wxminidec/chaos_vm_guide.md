# Tencent Chaos VM — Dynamic Extraction Guide

## Recognition

`__TENCENT_CHAOS_VM("base64...", false)(entryOffset, [], contextGetters, varNames, errorHandler)`

The VM is a stack-based bytecode interpreter. It stores string constants
as char-by-char `String.fromCharCode(N)` sequences in the bytecode.
**Do not attempt to decode the bytecode or reimplement the algorithm in
Python.** Instead, run the actual JavaScript in Node.js.

## Strategy: Load the Full Module Chain and Hook `wx.request`

This is the approach that succeeded. The principle: instead of extracting
individual keys, **let the app code compute the signature itself**, then
capture the result.

### Step 1: Provide mini-program globals

```javascript
global.window = global;
global.navigator = { appName: 'Netscape' };
global.document = { createElement() { return {}; } };
global.location = { href: 'https://servicewechat.com/' };
global.screen = { width: 375, height: 667 };
global.XMLHttpRequest = function() {};
global.WebSocket = function() {};
// ... etc (see sign_helper_template.js for full list)
```

### Step 2: Hook `Module.prototype.require`

The decompiled modules use hashed filenames like `1A00C6860766B0CF...js`.
They `require()` each other and also `@babel/runtime/helpers/*`.
Provide a require hook that resolves these:

```javascript
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    try { return origRequire.apply(this, arguments); } catch(e) {
        if (id.includes('@babel')) {
            const name = path.basename(id.replace(/\\/g, '/'), '.js');
            const hp = path.resolve(OUTPUT_DIR, '@babel/runtime/helpers', name + '.js');
            if (fs.existsSync(hp)) return origRequire(hp);
        }
        if (id.endsWith('.js')) {
            const fp = path.resolve(OUTPUT_DIR, path.basename(id));
            if (fs.existsSync(fp)) return origRequire(fp);
        }
        return {};
    }
};
```

### Step 3: Hook `wx.request` to capture the signed output

```javascript
let _capturedRequest = null;
global.wx = {
    // ... other mocks ...
    request(opts) {
        _capturedRequest = opts;  // Capture the signed request
        if (opts.success) opts.success({ data: {}, header:{}, statusCode: 200 });
    },
    login(opts) {
        // For endpoints that call wx.login(), return the real jsCode
        const code = _originalParams.jsCode || _originalParams.code || 'test';
        if (opts.success) opts.success({ code: code });
    },
};
```

### Step 4: Load and call the request module

```javascript
const reqMod = origRequire(path.resolve(OUTPUT_DIR, '1A00C6860766B0CF...js'));
const result = reqMod.default({
    method: 'post',
    url: '/sip/apppay/endpoint',
    data: params,
    params: {},
});
```

The `wx.request` hook captures `opts.data` which contains the fully signed
body, including the `sign` parameter and all headers.

### Step 5: Wrap as a helper script for mitmproxy

The Python adapter calls this Node.js script via `subprocess.run()`:

```python
args = ["node", "sign_helper.js", method, url, json.dumps(params)]
proc = subprocess.run(args, capture_output=True, text=True, encoding="utf-8")
```

The helper outputs JSON: `{"sign": "...", "body": "...", "headers": {...}}`

## Pitfalls

### 1. The request module mutates `data` in-place

**Always deep-copy params before passing to the request module:**

```javascript
_originalParams = JSON.parse(JSON.stringify(params));
const requestOpts = { data: params, ... };
reqMod.default(requestOpts);
// params is now mutated — use _originalParams for the final body
```

### 2. `jscode2session` has special wx.login() handling

For login endpoints, `wx.login()` is called internally. The mock must
return the original jsCode from `_originalParams.jsCode`, not a hardcoded
value. The sign is computed WITHOUT jsCode (it's added to the body separately).

### 3. Timestamp consistency

The request module generates its own timestamp internally. Extract it from
the debug output (`requestSignTime=(\d{13})`) and use it as the
`Requestsigntime` header value. The sign string timestamp and the header
timestamp MUST match.

### 4. The `define()` sandbox approach does NOT work

Do NOT use `vm.createContext()` + `define()` to load modules. The Chaos VM
functions have closure dependencies that break in a V8 sandbox. Instead,
use direct `require()` at the Node.js level with proper globals.

### 5. The VM bytecode approach is a dead end

Do NOT attempt to:
- Decode the VLQ/ZigZag bytecode
- Hook `String.fromCharCode` to extract strings
- Patch the VM switch cases
- Use Proxy on the sandbox

All of these fail because the VM functions need their original closure
context. Skip straight to the "run the full module chain" approach.

## Extracting Individual Secrets (RSA keys, appSecret)

Sometimes you need specific secrets without running the full signing flow.
In that case:

1. **Hook constructors**: `JSEncrypt.prototype.setPublicKey = function(key) { ... }`
2. **Hook specific functions**: Replace module exports with instrumented versions
3. **Read debug output**: The Chaos VM code often prints `console.log` messages
   in Chinese (e.g., "元数据", "明文", "MD5加密") that reveal internal state

Example — extracting RSA public key:
```javascript
const JSEncrypt = origRequire('02B60ED1...js');
const orig = JSEncrypt.prototype.setPublicKey;
JSEncrypt.prototype.setPublicKey = function(key) {
    console.log('RSA KEY:', key);
    return orig.call(this, key);
};
const met = origRequire('33434DE1...js');  // Uses JSEncrypt internally
// The key is captured when the module initializes
```

## When NOT to use this approach

If the decompiled source has NO `__TENCENT_CHAOS_VM` (plain readable JS),
standard static analysis and Python reimplementation is preferred.
This guide is specifically for Chaos-VM-obfuscated apps.
