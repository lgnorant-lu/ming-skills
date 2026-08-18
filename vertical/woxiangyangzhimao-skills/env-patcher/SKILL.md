---
name: env-patcher
description: "补环境 — 为 Node.js VM 沙箱生成浏览器 API mock 脚本(browser.js),让原始 JS SDK(极验/易盾/京东jcap/阿里AWSC/同盾/数美)在 Node 里正常跑;含三级模板与指纹注入。遇 window/document is not defined、要补浏览器环境时用。"
description_en: |
description_zh: "补环境 — 为 Node 沙箱生成浏览器 API mock 脚本(browser.js)"
---

# Env Patcher · 浏览器环境补丁生成器

> 基于 12+ 补环境实战项目的经验提炼。
> 核心理念：**最小依赖补全 → 指纹注入 → SDK加载 → 验证通过**
> 目标：让原始 JS SDK 在 Node.js vm 沙箱中"以为自己在浏览器里"。

---

## 角色规则

**此 Skill 激活后，以浏览器环境模拟专家身份工作。**

- 从最小环境开始，按需递增（不一次补全所有API）
- 优先使用项目已有的补环境模板，避免重复造轮子
- 每个 mock 函数的 `toString()` 必须返回 `[native code]`
- Canvas/WebGL 指纹必须固定值（同一 session 内一致）
- 补完环境后必须用目标 SDK 实际加载验证

## Phase 映射

本 Skill 在 CLAUDE.md Phase 0-4 工作流中的定位：

| Phase | 本 Skill 的角色 | 与其他 Skill 的协作 |
|-------|----------------|-------------------|
| Phase 0 情报收集 | ❌ 不参与 | — |
| Phase 1 流量分析 | ❌ 不参与 | — |
| Phase 2 定位加密 | 🟡 辅助：SDK 加载报错时提供 API 需求清单 | web-reverse-master 通过 js-reverse-mcp 定位 SDK 入口 |
| Phase 3 方案制定 | ✅ 核心参与：选择补环境 Level，产出 browser.js 规划 | 配合 param-encryptor（加密函数调用）和 captcha-solver（验证码 SDK） |
| Phase 4 代码还原 | ✅ 核心参与：生成 browser.js + call_sdk.js + Python 桥接 | Python 主脚本通过 NodeSigner 调用 Node.js |

**典型调用链：**
```
web-reverse-master Phase 2 定位到加密 SDK
  → env-patcher 生成 browser.js 补环境
  → param-encryptor 调用 SDK 获取签名
  → Python 主脚本发送请求
```

**MCP 工具使用：**
- 本 Skill 纯模板生成，不直接调用 MCP 工具
- 如需浏览器调试定位 SDK 需要的 API，使用 `web-reverse-master` → `js-reverse-mcp.evaluate_script` 注入 `watch()` Proxy
- 如需验证补环境效果，使用 `web-reverse-master` → `scripts/compare_env.py` 对比差异

---

## 〇、执行工作流（补环境5步法）

> 每次补环境任务必须按以下5步执行，禁止跳步。

### Step 1: 诊断SDK需求
**输入**：目标SDK的JS源码文件 + 报错日志（如有）
**输出**：SDK需要的API清单（标注优先级）
**动作**：
1. 读取SDK源码，搜索 `window.` `document.` `navigator.` `screen.` `canvas` `webgl` `audio` 等关键词
2. 检查SDK是否有WASM依赖（搜索 `WebAssembly.instantiate` `importObject`）
3. 标注哪些API是必补（直接调用）、哪些是可选（条件分支内调用）

🔴 **CHECKPOINT**：API清单列出后暂停，确认覆盖范围再继续。

### Step 2: 选择补环境模板
**输入**：Step 1 的API清单
**输出**：选定的模板Level + 是否需要SDK专用模板
**决策**：
```
API清单只有 window/document/navigator → Level 1 基础环境
API清单含 Canvas/WebGL/Audio           → Level 1 + Level 2 增强环境
SDK在已有模板索引表中                   → 直接复用（Level 3 专用模板）
SDK含 WASM 依赖                        → Level 1 + WASM桥接模板
SDK未知/复杂                           → Level 2 起步 + 按报错递增
```

### Step 3: 生成browser.js
**输入**：选定的模板Level + API清单
**输出**：完整的 browser.js 文件
**动作**：
1. 从对应Level模板复制基础代码
2. 按API清单补充缺失的mock函数
3. 注入固定指纹数据（Canvas/WebGL/Audio）
4. 应用Function.prototype.toString修复

🛑 **STOP**：生成后必须检查——每个SDK调用的API都有对应的mock？mock返回值类型正确？

### Step 4: 加载验证
**输入**：browser.js + SDK源码文件
**输出**：验证通过/失败 + 错误日志
**动作**：
1. 创建Node.js vm沙箱，注入browser.js
2. 加载SDK源码到沙箱，设置timeout=10s
3. 调用SDK的入口函数
4. 记录成功输出或错误信息

🔴 **CHECKPOINT · 关键门控**：
- ✅ 验证通过 → 进入Step 5
- ❌ 报错 → 查看失败模式编码表，修复后回到Step 3
- ❌ 连续3次修复失败 → 提升模板Level（Level 1→2→3）

### Step 5: 产出交付
**输入**：验证通过的browser.js + SDK调用结果
**输出**：交付物清单
**动作**：
1. 输出 browser.js（补环境脚本）
2. 输出 call_sdk.js（SDK加载+调用入口）
3. 输出 Python桥接代码（NodeSigner类模板）
4. 记录已验证的SDK版本号 + 补环境Level

---

## 一、补环境最小依赖清单

### Level 1: 基础环境（所有项目必补）

```javascript
// === 全局对象 ===
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.top = globalThis;
globalThis.parent = globalThis;
globalThis.frames = globalThis;

// === document ===
const doc = {
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    style: {},
    children: [],
    appendChild: () => {},
    removeChild: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getAttribute: () => null,
    setAttribute: () => {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 100 }),
    getElementsByTagName: () => [],
    querySelectorAll: () => [],
    querySelector: () => null,
    innerHTML: '', innerText: '', textContent: '',
    offsetWidth: 100, offsetHeight: 100,
    classList: { add: () => {}, remove: () => {}, contains: () => false },
  }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  documentElement: { style: {}, clientWidth: 1920, clientHeight: 1080 },
  body: { appendChild: () => {}, removeChild: () => {} },
  cookie: '',
  readyState: 'complete',
  title: '',
  referrer: '',
  domain: '',
  URL: 'https://www.example.com/',
  addEventListener: () => {},
  removeEventListener: () => {},
  createEvent: () => ({ initEvent: () => {} }),
  head: {},
};
globalThis.document = doc;

// === navigator ===
globalThis.navigator = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  platform: 'Win32',
  language: 'zh-CN',
  languages: ['zh-CN', 'zh', 'en'],
  vendor: 'Google Inc.',
  appVersion: '5.0 (Windows NT 10.0; Win64; x64)',
  appName: 'Netscape',
  product: 'Gecko',
  productSub: '20030107',
  cookieEnabled: true,
  onLine: true,
  hardwareConcurrency: 8,
  deviceMemory: 8,
  maxTouchPoints: 0,
  plugins: { length: 0 },
  mimeTypes: { length: 0 },
  connection: { effectiveType: '4g', downlink: 10, rtt: 50 },
  // Chrome 90+
  userAgentData: {
    brands: [{ brand: 'Chromium', version: '136' }, { brand: 'Google Chrome', version: '136' }],
    mobile: false,
    platform: 'Windows',
  },
};

// === screen ===
globalThis.screen = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24 };

// === location ===
globalThis.location = { href: 'https://www.example.com/', hostname: 'www.example.com', protocol: 'https:', pathname: '/', search: '', hash: '' };

// === 性能API ===
const startTime = Date.now();
globalThis.performance = {
  now: () => Date.now() - startTime + Math.random() * 0.1,
  timing: { navigationStart: startTime },
  getEntriesByType: () => [],
  getEntriesByName: () => [],
  mark: () => {},
  measure: () => {},
};

// === 存储API ===
const storage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; },
  get length() { return Object.keys(this._data).length; },
  key(i) { return Object.keys(this._data)[i] || null; },
};
globalThis.localStorage = storage;
globalThis.sessionStorage = { ...storage, _data: {} };

// === 编码API ===
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');

// === 定时器 ===
globalThis.setTimeout = (fn, ms) => setTimeout(fn, Math.min(ms || 0, 100));
globalThis.setInterval = (fn, ms) => setInterval(fn, Math.min(ms || 0, 100));
globalThis.clearTimeout = clearTimeout;
globalThis.clearInterval = clearInterval;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
```

### Level 2: 增强环境（风控严格的站点）

```javascript
// === Canvas 2D ===
class MockCanvas2D {
  constructor() {
    this.fillStyle = '#000000';
    this.font = '10px sans-serif';
    this.textBaseline = 'alphabetic';
    this.globalCompositeOperation = 'source-over';
    this.canvas = { width: 300, height: 150 };
    // ... 其他属性和 no-op 方法
  }
  fillRect() {}
  fillText() {}
  measureText() { return { width: 10 }; }
  getImageData() { return { data: new Uint8ClampedArray(400) }; }
  putImageData() {}
  toDataURL() { return 'data:image/png;base64,iVBOR...'; }
  arc() {} beginPath() {} closePath() {} lineTo() {} moveTo() {}
  stroke() {} fill() {} save() {} restore() {} translate() {}
  rect() {} clip() {} drawImage() {} createLinearGradient() { return { addColorStop: () => {} }; }
}

// === WebGL ===
class MockWebGL {
  getParameter(p) {
    const params = {
      37445: 'Google Inc. (NVIDIA)',           // UNMASKED_VENDOR
      37446: 'ANGLE (NVIDIA, GeForce GTX 1060, OpenGL 4.5)', // UNMASKED_RENDERER
      7937: 'WebKit WebGL',                     // RENDERER
      7936: 'WebKit',                           // VENDOR
      7938: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)', // VERSION
    };
    return params[p] || null;
  }
  getExtension(name) {
    if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
    return null;
  }
  getSupportedExtensions() {
    return ['ANGLE_instanced_arrays', 'EXT_blend_minmax', 'WEBGL_debug_renderer_info'];
  }
  createBuffer() { return {}; }
  bindBuffer() {}
  bufferData() {}
  // ... 其他 no-op 方法
}

// === AudioContext ===
globalThis.AudioContext = class {
  createOscillator() { return { connect: () => {}, start: () => {}, stop: () => {}, frequency: { value: 0 } }; }
  createDynamicsCompressor() { return { connect: () => {}, threshold: { value: 0 }, knee: { value: 0 } }; }
  createAnalyser() { return { connect: () => {}, getFloatFrequencyData: () => {} }; }
  createGain() { return { connect: () => {}, gain: { value: 0 } }; }
  get destination() { return {}; }
  close() {}
};
globalThis.OfflineAudioContext = class extends globalThis.AudioContext {
  startRendering() { return Promise.resolve({ getChannelData: () => new Float32Array(0) }); }
};

// === EventTarget ===
class MockEventTarget {
  constructor() { this._listeners = {}; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter(f => f !== fn); }
  dispatchEvent(event) { (this._listeners[event.type] || []).forEach(fn => fn(event)); return true; }
}

// === 其他增强API ===
globalThis.MutationObserver = class { constructor() {} observe() {} disconnect() {} };
globalThis.IntersectionObserver = class { constructor() {} observe() {} disconnect() {} };
globalThis.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
globalThis.speechSynthesis = { getVoices: () => [] };
globalThis.Notification = { permission: 'default' };
```

### Level 3: SDK专用（按需加载的完整模板）

| SDK | 补环境规模 | 已有模板 | 参考路径 |
|-----|-----------|---------|---------|
| 阿里云AWSC | ~200行 | ✅ | `sites/aliyun_captcha/env/browser.js`（示例实现，非必需） |
| 网易易盾IR | 1032行 | ✅ | `sites/dun_163_com/env/browser.js`（示例实现，非必需） |
| 京东jcap WASM | 完整 | ✅ | `sites/jd_login/node/jcap_env.js`（示例实现，非必需） |
| 极验4 | 最小 | ✅ | `sites/crv-captcha/env/browser.js`（示例实现，非必需） |
| 同盾fm | SDK内含 | ✅ | `sites/juneyaoair/src/fm.js`（示例实现，非必需） |

---

## 二、Function.prototype.toString 修复

```javascript
// 所有 mock 函数必须通过 native code 检测
const nativeFunctions = [
  'createElement', 'getElementById', 'querySelector',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
  'getContext', 'toDataURL', 'getParameter', 'getExtension',
  'getItem', 'setItem', 'removeItem',
  // ... 所有 mock 的函数
];

nativeFunctions.forEach(name => {
  const orig = globalThis[name];
  if (orig) {
    orig.toString = () => `function ${name}() { [native code] }`;
  }
});

// 通用修复：让所有 Function 都看起来是 native
const origToString = Function.prototype.toString;
Function.prototype.toString = function() {
  if (this._nativeName) return `function ${this._nativeName}() { [native code] }`;
  return origToString.call(this);
};
```

---

## 三、指纹注入模板

```javascript
// 固定设备指纹（同一session内一致）
const FINGERPRINT = {
  canvas: 'data:image/png;base64,iVBORw0KGgo...',  // Canvas 2D指纹
  webgl_vendor: 'Google Inc. (NVIDIA)',
  webgl_renderer: 'ANGLE (NVIDIA, GeForce GTX 1060)',
  audio: '35.770000000000003',  // AudioContext指纹
  fonts: ['Arial', 'Times New Roman', 'Consolas'],
  screen: '1920x1080x24',
  timezone: -480,
  platform: 'Win32',
  plugins_count: 0,
  hardwareConcurrency: 8,
  deviceMemory: 8,
};

// 注入到 navigator/screen 等
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => FINGERPRINT.hardwareConcurrency });
Object.defineProperty(navigator, 'deviceMemory', { get: () => FINGERPRINT.deviceMemory });
```

---

## 四、VM 沙箱创建模板

```javascript
const { VM } = require('vm2'); // 或 Node.js 内置 vm
const vm = require('vm');

function createSandbox() {
  const context = vm.createContext({
    // 注入 Level 1-3 环境
    ...require('./browser.js'),
    console,  // 保留console用于调试
    Buffer,
    process: { argv: [], env: {}, version: 'v20.0.0' },
    require,  // 如需限制require，使用自定义函数
  });
  return context;
}

function loadSDK(context, sdkCode) {
  try {
    const script = new vm.Script(sdkCode, { filename: 'sdk.js' });
    script.runInContext(context, { timeout: 10000 });
    return context;
  } catch (e) {
    console.error('SDK加载失败:', e.message);
    throw e;
  }
}
```

---

## 五、SDK加载器模板

```javascript
// 通用SDK加载器
function loadSDKAndGenerate(sdkPath, methodName, args) {
  const fs = require('fs');
  const vm = require('vm');

  // 1. 创建沙箱
  const context = createSandbox();

  // 2. 加载SDK
  const sdkCode = fs.readFileSync(sdkPath, 'utf-8');
  loadSDK(context, sdkCode);

  // 3. 调用方法
  const result = context[methodName](...args);

  // 4. 返回结果给Python（JSON序列化）
  return JSON.stringify(result);
}

// 从命令行调用
if (require.main === module) {
  const [,, sdkPath, method, ...restArgs] = process.argv;
  const args = JSON.parse(restArgs[0] || '[]');
  console.log(loadSDKAndGenerate(sdkPath, method, args));
}
```

### WASM 桥接模板（京东jcap/字节rmc-captcha/阿里Baxia专用）

```javascript
const fs = require('fs');
const path = require('path');

function setupWasmBridge(context, wasmPath) {
  // 1. 模拟WebAssembly全局对象
  context.WebAssembly = {
    instantiate: async (bufferSource, importObject) => {
      const wasmBuffer = fs.readFileSync(wasmPath);
      // 如果importObject中需要env函数，必须逐一提供
      const defaultImports = {
        env: {
          memory: new WebAssembly.Memory({ initial: 256, maximum: 256 }),
          table: new WebAssembly.Table({ initial: 0, element: 'anyfunc' }),
          // 常见WASM导入函数
          abort: () => { throw new Error('WASM abort'); },
          _abort: () => { throw new Error('WASM _abort'); },
          _grow: () => {},
          segfault: () => { throw new Error('WASM segfault'); },
          alignfault: () => { throw new Error('WASM alignfault'); },
          // 数学函数
          Math_sqrt: Math.sqrt,
          Math_abs: Math.abs,
          Math_floor: Math.floor,
          Math_ceil: Math.ceil,
          Math_min: Math.min,
          Math_max: Math.max,
          // 特定SDK函数（按需补充）
          ...importObject?.env || {},
        },
        wasi_snapshot_preview1: {
          fd_write: () => 0,
          proc_exit: () => {},
          random_get: (ptr, len) => {
            const mem = new Uint8Array(context.WebAssembly.instance.exports.memory.buffer);
            for (let i = 0; i < len; i++) mem[ptr + i] = Math.floor(Math.random() * 256);
            return 0;
          },
        },
      };

      const mergedImports = { ...defaultImports, ...importObject };
      const result = await WebAssembly.instantiate(wasmBuffer, mergedImports);
      context.WebAssembly.instance = result.instance;
      return result;
    },
    Instance: WebAssembly.Instance,
    Memory: WebAssembly.Memory,
    Table: WebAssembly.Table,
    instance: null, // 运行时填充
  };

  // 2. 模拟fetch加载WASM的路径
  context.fetch = async (url) => {
    if (url.endsWith('.wasm')) {
      const wasmBuffer = fs.readFileSync(path.resolve(wasmPath));
      return { arrayBuffer: () => Promise.resolve(wasmBuffer) };
    }
    return { text: () => Promise.resolve(''), json: () => Promise.resolve({}) };
  };
}
```

🔴 **CHECKPOINT**：WASM桥接完成后，必须验证 `WebAssembly.instance.exports` 包含SDK所需的导出函数名。常见导出函数：`__update_img`（Baxia）、`getCTData`（jcap）、`encrypt`（rmc-captcha）。

---

## 六、Python 桥接模板

```python
import subprocess, json

class NodeSigner:
    """Python调用Node.js签名器的桥接类"""
    
    def __init__(self, node_script: str, sdk_path: str):
        self.node_script = node_script
        self.sdk_path = sdk_path
    
    def call(self, method: str, args: list = None) -> dict:
        """调用Node.js方法"""
        cmd = ['node', self.node_script, self.sdk_path, method, json.dumps(args or [])]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise RuntimeError(f"Node.js错误: {result.stderr}")
        return json.loads(result.stdout)
```

---

## 七、对抗深度增强

> 补环境不仅是 API 模拟，还必须对抗 SDK 的多层级检测。以下是高级对抗策略。

### 7.1 WebGL 状态机深度模拟

```javascript
// SDK 检测 WebGL 状态一致性：bindTexture → texParameter → drawArrays 调用链
// 简单 stub 会导致状态检查失败
class MockWebGLStateMachine {
    constructor() {
        this._textures = new Map();
        this._buffers = new Map();
        this._programs = new Map();
        this._currentTexture = null;
        this._currentProgram = null;
        this._viewport = { x: 0, y: 0, w: 300, h: 150 };
        this._error = 0;  // gl.NO_ERROR
    }
    
    createTexture() { const id = { _id: Math.random() }; this._textures.set(id, {}); return id; }
    bindTexture(target, texture) { this._currentTexture = texture; }
    texParameteri(target, pname, param) { /* 记录参数但不报错 */ }
    texImage2D() {}
    
    createShader(type) { return { _type: type, _source: '' }; }
    shaderSource(shader, source) { shader._source = source; }
    compileShader(shader) { shader._compiled = true; }
    getShaderParameter(shader, pname) {
        if (pname === 0x8B81) return true;  // COMPILE_STATUS
        return null;
    }
    
    createProgram() { const id = { _shaders: [] }; this._programs.set(id, id); return id; }
    attachShader(program, shader) { program._shaders.push(shader); }
    linkProgram(program) { program._linked = true; }
    getProgramParameter(program, pname) {
        if (pname === 0x8B82) return true;  // LINK_STATUS
        return null;
    }
    useProgram(program) { this._currentProgram = program; }
    
    getError() { const e = this._error; this._error = 0; return e; }
    viewport(x, y, w, h) { this._viewport = { x, y, w, h }; }
    
    drawingBufferWidth = 300;
    drawingBufferHeight = 150;
}
```

### 7.2 Canvas 渲染哈希稳定性

```javascript
// Canvas 指纹检测的核心：toDataURL() 必须在多次调用间返回相同值
// 否则 SDK 判定为伪造环境
class StableCanvas {
    constructor() {
        this._fixedDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...'; // 从真实浏览器捕获
        this._callCount = 0;
    }
    
    toDataURL(type) {
        this._callCount++;
        // 关键：每次返回完全相同的值
        return this._fixedDataUrl;
    }
    
    toBlob(callback, type, quality) {
        // 同样必须稳定
        const blob = new Blob([Buffer.from(this._fixedDataUrl.split(',')[1], 'base64')]);
        callback(blob);
    }
}
```

### 7.3 requestAnimationFrame 时序检测对抗

```javascript
// 部分 SDK 检测 requestAnimationFrame 的回调间隔
// 真实浏览器约 16.67ms (60fps)，固定间隔暴露伪造
let rafId = 0;
const rafCallbacks = new Map();

globalThis.requestAnimationFrame = (callback) => {
    const id = ++rafId;
    // 模拟 16.67ms ± 2ms 的自然抖动
    const delay = 16 + Math.random() * 4 - 2;
    const timer = setTimeout(() => {
        const now = performance.now();
        callback(now);
        rafCallbacks.delete(id);
    }, delay);
    rafCallbacks.set(id, timer);
    return id;
};

globalThis.cancelAnimationFrame = (id) => {
    const timer = rafCallbacks.get(id);
    if (timer) {
        clearTimeout(timer);
        rafCallbacks.delete(id);
    }
};
```

### 7.4 CSSOM 属性枚举检测对抗

```javascript
// 高级 SDK 会检查 document.styleSheets、getComputedStyle 等
globalThis.getComputedStyle = (element) => {
    const proxy = new Proxy({}, {
        get(target, prop) {
            // 返回合理的默认 CSS 值
            const defaults = {
                display: 'block', position: 'static', visibility: 'visible',
                opacity: '1', overflow: 'visible', zIndex: 'auto',
                width: '100px', height: '100px', margin: '0px', padding: '0px',
                fontFamily: 'Arial, sans-serif', fontSize: '16px', color: 'rgb(0, 0, 0)',
                backgroundColor: 'rgba(0, 0, 0, 0)', border: '0px none rgb(0, 0, 0)',
            };
            return defaults[prop] || '';
        }
    });
    return proxy;
};

globalThis.document.styleSheets = [];
```

---

## 失败模式编码

| 症状 | 原因 | 一线修复 | 仍失败兜底 |
|------|------|---------|-----------|
| `window is not defined` | 缺少window全局对象 | 补 Level 1 基础环境 | 检查SDK是否用了`globalThis`以外的方式访问 |
| `canvas.getContext is not a function` | Canvas API未模拟 | 补 Level 2 Canvas 2D | 检查是否还需要WebGL |
| `AudioContext not defined` | 音频指纹API缺失 | 补OfflineAudioContext | 检查是否返回了正确的Float32Array |
| SDK加载超时 | 无限循环或死锁 | 设置vm timeout=10s | 检查SDK是否有setInterval未清理 |
| `Function.toString`检测失败 | native code检测 | 应用toString修复 | 检查是否是`bind`后的函数 |
| navigator.userAgentData缺失 | Chrome 90+ API | 补userAgentData对象 | 检查brands格式 |
| Cookie操作报错 | document.cookie未实现 | 补cookie getter/setter | 检查是否需要httpOnly模拟 |
| `WebAssembly.instantiate`失败 | WASM导入函数缺失 | 补WASM桥接模板（见下文） | 用IdaPro分析WASM导入表 |
| Proxy/iframe检测 | SDK检测到代理或沙箱 | 补iframe contentWindow | 补Proxy handler默认行为 |
| 时区/语言不一致 | new Date()时区偏移 | 补Date.prototype.getTimezoneOffset | 统一navigator.language与时区 |

### SDK检测到非浏览器：系统性排查清单

当Step 4验证失败且错误信息模糊（如"环境异常"、"检测失败"无具体API名），按以下顺序逐一排查：

```
□ 1. Function.prototype.toString — 所有mock函数调用.toString()，必须返回 [native code]
□ 2. navigator.userAgent 一致性 — UA中的Chrome版本与userAgentData.brands一致
□ 3. navigator.plugins 长度 — 如需非零，补PluginArray模板
□ 4. iframe检测 — document.createElement('iframe').contentWindow 必须不为null
□ 5. Proxy检测 — 检查SDK是否用Proxy.observe检测代理对象
□ 6. 时区一致性 — Date.getTimezoneOffset() 必须与navigator.language匹配
□ 7. screen尺寸合理性 — width/height/colorDepth组合必须合理
□ 8. canvas指纹稳定性 — 同一session内多次getContext必须返回相同toDataURL
□ 9. WebSocket模拟 — 如SDK尝试ws连接，补WebSocket mock（+03ms随机延迟）
□ 10. localStorage配额 — 补localStorage剩余空间返回值（通常5MB）
```

🛑 **STOP**：排查清单全部通过但验证仍失败 → 进入Phase 2.5探索性重写（从头重新组织browser.js结构）

---

## 反模式黑名单

| # | 不要做 | 替代 |
|---|--------|------|
| 1 | 一次补全所有API | 从最小环境开始，按SDK报错递增 |
| 2 | 用jsdom替代手动补环境 | jsdom太重，触发更多检测，手动mock更可控 |
| 3 | 忽略toString检测 | 所有mock函数必须返回`[native code]` |
| 4 | 随机生成指纹值 | 同一session内指纹必须固定 |
| 5 | 在VM外执行SDK | 必须在VM沙箱内执行，避免污染全局 |
| 6 | 不设超时 | 必须设置10s超时，防止SDK死循环 |

---

## 依赖清单

```
# Node.js（VM沙箱）
# 无额外依赖，使用Node.js内置vm模块

# 可选
npm install canvas  # 如需真实Canvas渲染（阿里云验证码）
```

---

## 补环境框架（可选，非默认路径）

> 本技能默认走**手动最小补环境**（见反模式黑名单 #2：jsdom 太重、易触发更多检测、手动 mock 更可控）。下面框架仅作快速原型或对照排查用，**强风控/生产签名仍按手动最小补环境**。

### sdenv（`pysunday/sdenv`）
- **仓库**: https://github.com/pysunday/sdenv ｜ Node.js ｜ 配 jsdom "真实模拟浏览器执行环境"
- **安装**: `npm i sdenv` / `npx sdenv` / Docker
- **何时用**: 想快速出个能跑的原型；或拿它的输出与你手写 browser.js 对照，反查漏补的 API
- **何时别用**: 生产签名/强风控站点——框架自带的 jsdom 特征反而是被检测面
- 本机 Node 已装；配套 Python 工具一律用 `python3.11`

---

## 已有模板索引

> 以下路径指向项目内的示例实现，非 Skill 必需。在其他项目中使用时，以上 inline 模板代码已足够生成基础补环境脚本。

| 模板 | 路径 | 行数 |
|------|------|------|
| 阿里云AWSC | `sites/aliyun_captcha/env/browser.js`（示例实现，非必需） | ~200 |
| 网易易盾 | `sites/dun_163_com/env/browser.js`（示例实现，非必需） | 1032 |
| 京东jcap | `sites/jd_login/node/jcap_env.js`（示例实现，非必需） | 完整 |
| 极验4 | `sites/crv-captcha/env/browser.js`（示例实现，非必需） | 最小 |
| B站极验v3 | `sites/bilibili_login/src/geetest_crypto.js`（示例实现，非必需） | Node.js纯算 |
| 大众点评VM | `sites/dianping/src/aS_vm.js`（示例实现，非必需） | aS解释器 |

---

## Related Skills

| Skill | 职责 | 何时调用 |
|-------|------|---------|
| `web-reverse-master` | 全流程编排 | 需要诊断环境差异（watch() Proxy 监控、env_diff 对比） |
| `param-encryptor` | 加密参数生成 | 补完环境后需要调用加密/签名函数 |
| `captcha-solver` | 验证码求解 | 验证码 SDK 需要在补环境中运行 |
| `ast-deobfuscation` | JS 反混淆 | SDK 源码混淆严重需先反混淆再补环境 |
