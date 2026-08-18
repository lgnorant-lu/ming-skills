# 扣代码与本地模拟

> 本文件负责阶段四(本地模拟与验证)的两种实现模式:扣代码模式 + iv8 补环境模式(方案 1 / 方案 2)。
>
> 阶段三产出分支选择(见 [stage3.md](stage3.md) §5),阶段四产出方案 1/2 判定与具体实现(见 [stage4.md](stage4.md) §5.2-§5.4),本文件负责具体实现细节。
>
> 阶段二产出的加密点位 + 脱壳代码集(见 [stage2-tracing.md](../workflow/stage2-tracing.md))是本文件的输入。

> **v9.10 修订**:Black-box reuse 模式已删除并禁用(见 SKILL.md P0 禁令)。iv8 补环境失败时不再走 Black-box 兜底,改为触发阶段门阻断 → 回溯阶段二检查脱壳代码完整性 → 无法修复则走"任务失败交付物"流程。

## 5.1 概述:两种实现模式

阶段四(本地模拟与验证)有两种实现模式,按阶段三确认的分支和阶段四确认的方案降级链选择:

| 模式 | 核心思路 | 适用场景 | 运行依赖 |
|------|---------|---------|---------|
| Python 重写模式(方案 1) | Python 重写加密算法逻辑,所有参数作为函数输入 | 逻辑可读懂(分支 C);算法代码路径只做纯计算(不调用浏览器 API 产出密钥材料);输入参数由用户提供(见 stage4.md "职责边界") | Python |
| iv8 补环境模式(方案 2) | 加密点位涉及的代码放入 iv8,补环境跑原 JS | 非标准+复杂(2.1+2.3 后仍不可读),或算法代码路径调用浏览器 API 且无法用 Python 等价替代,或方案 1 失败(分支 C);分支 B(JSVMP)必走本模式 | iv8 |

**两种模式的共同点**:都用 HAR 真实参数做输出校验(见 §5.7 验证策略)。

## 5.2 扣代码模式

### 5.2.1 前置条件

进入扣代码模式前,必须已完成:
- 阶段二:产出加密点位 + 脱壳代码集(见 [stage2-tracing.md](../workflow/stage2-tracing.md))
- 阶段三:确认载体形态 + 分支选择(见 [stage3.md](stage3.md) §3.1 + §3.6);阶段四:选定方案(见 [stage4.md](stage4.md) §5.2)

### 5.2.2 扣代码工作流

#### 第一步:取加密点位与脱壳代码

从阶段二产出物中取:
- 加密点位定位结论(函数名、文件名:行号:列号)
- 脱壳代码集(每个节点的脱壳后纯净 JS 代码片段)

> 不重新做加密点定位和依赖分析——阶段二已完成(见 [stage2-tracing.md](../workflow/stage2-tracing.md))。

#### 第二步:扣出代码

按加密点位涉及的代码,提取相关节点:
- webpack 模块:扣出加载器 + 所需模块(见 §5.2.3)
- 全局函数:直接复制函数及其依赖
- 对象方法:扣出对象定义及其依赖

#### 第三步:改写模块系统

webpack 改写示例:

```javascript
// 原始:webpack 模块
var modules = {
    31: function(module, exports, require) {
        var AES = require(32);
        function encrypt(data) { return AES.encrypt(data, key); }
        module.exports = encrypt;
    },
    32: function(module, exports, require) { /* AES 实现 */ }
};
// 改写:Node.js 可直接运行
const modules = {};
function require(id) { return modules[id]({exports:{}, require, module:{}}); }
// ... 定义 modules,然后调用 require(31)
```

#### 第四步:运行验证

按方案降级链(§5.3)选择运行方式,用 §5.7 验证策略校验输出。

### 5.2.3 webpack 扣代码要点

- 扣加载器(webpack runtime)
- 扣所需模块(按依赖图)
- 处理 chunk 加载(动态 import)——若用到动态加载的模块,需模拟加载或改为静态
- 处理 splitChunks(公共依赖提取)

> Webpack bootstrap 拆解等纯计算场景可用 Node.js 备选。详见 [stage2-tracing.md](../workflow/stage2-tracing.md) §2.3.5 "Webpack 整体被壳的顺序约束"。

## 5.3 方案降级链实现

对应 [stage4.md](stage4.md) §5.2 的方案 1/2 判定,本节给出具体实现。

### 5.3.1 方案 1:Python 重写 + API 说明

**触发条件**:见 [stage4.md](stage4.md) §5.2 方案 1。

**实现步骤**:

1. 确认算法类型(AES/RSA/SHA/HMAC/SM2/SM4)——可用 trace 的 interface+args 确认(trace 仅用于算法指纹,不做加密点定位)
2. 用 Python 库实现(cryptography/pycryptodome/gmssl 等)
3. 用 HAR 真实值验证(固定值 === 比对,非固定值看结构 + httpx 发包看服务器验证)
4. 魔改算法(如改了 S 盒、轮数)不算标准算法,走方案 1 试跑(逻辑简单可读懂时)或直接方案 2

**API 说明(强制产出)**:

方案 1 必须产出 Python 函数 + API 说明文档,让下游使用者知道每个参数怎么传。API 说明模板:

```python
def generate_xxx(
    param1: type,   # 含义。获取方式:用户操作产生/服务端接口返回/内部生成/固定常量
    param2: type,   # 含义。获取方式:...
    ...
) -> dict:
    """生成 xxx 加密参数
    
    Returns:
        {"param_name": "value", ...}
    """
```

API 说明要素:
- 函数签名(所有必需输入参数,缺任何一个加密结果都会与浏览器对不齐)
- 每个参数的含义、类型、单位(适用时)
- 获取方式:用户操作产生/服务端接口返回/函数内部生成/固定常量
- 返回值结构

**试跑失败**:输出对不齐浏览器 → 不定位根因(不能动态调试)→ 直接降级方案 2。

### 5.3.2 方案 2:iv8 补环境

**触发**:见 [stage4.md](stage4.md) §5.2 方案 2。

**实现**(按载体形态分情况):

**Webpack 场景**(载体形态=Webpack,载体清晰度=清晰):
1. 扣取模块和加载器到独立 JS 文件(扣代码方式见 §5.2.2-§5.2.3)
2. 用 iv8 page.load 加载扣出的 JS 文件(包一层最小 HTML)
3. 按 [iv8-env-patching.md](iv8-env-patching.md) 补环境(trace 前置为主 + iv8 debug 为辅)
4. 加密函数可正常调用

**其他场景**(JSVMP/纯 JS 等):
1. iv8 直接 page.load 加载原 JS 文件
2. 按 [iv8-env-patching.md](iv8-env-patching.md) 补环境
3. 加密函数可正常调用

**二级依赖处理**(主 JS 依赖子 JS,如 gcaptcha4.js 依赖 gct4.js 提供 PoW 模块):

当 page.load 加载主 JS 后,debug 日志或运行时报错显示主 JS 尝试加载子 JS(如 `importScripts`、动态 `createElement('script')`、`fetch` 子 JS URL)时:

1. 从 HAR 下载记录找到子 JS 的 URL 和内容
2. 把子 JS 加入 page.load 的 `resources` 映射(URL → 内容)
3. 重新 page.load(主 JS + 子 JS 一起加载,子 JS 在主 JS 之前执行)
4. 若子 JS 也有自己的依赖,递归处理(深度建议 ≤3 层)

```python
# 示例:主 JS 依赖子 JS
ctx.eval("""
window.__ZY__.page.load({
    baseURL: 'https://example.com',
    html: '<html><head>' +
          '<script src="/gct4.js"></script>' +  // 子 JS 先加载
          '<script src="/gcaptcha4.js"></script>' +  // 主 JS 后加载
          '</head><body></body></html>',
    resources: {
        'https://example.com/gct4.js': { body: gct4_js_content },
        'https://example.com/gcaptcha4.js': { body: gcaptcha4_js_content }
    }
});
""")
```

> **判定子 JS 是否与加密相关**:若主 JS 的加密函数调用链触达子 JS 导出的函数(如 PoW 模块的 `pow_msg`/`pow_sign` 生成),则子 JS 是加密依赖,必须加载;若子 JS 仅提供 UI/样式,与加密参数数据流无关,可不加载。

> **运行时载体用原始压缩代码**(详见 [stage2-tracing.md](../workflow/stage2-tracing.md) "核心策略"):
> - 原始压缩代码本身能跑,运行时直接用(行号/列号与 trace stack 对齐,语法不被改写)
> - §5.5 闭包 hook 注入直接在原始压缩代码上注入,不需重新压缩
> - 改写/beautify 后的代码直接 page.load 可能因 sourcemap 失效/自动补分号引入隐性 bug

**子模式**(只有透明模式)**:
- 透明模式(默认且唯一):补全环境后,加密函数可正常调用
- 环境补不全时 → 触发阶段门阻断(回溯阶段二检查脱壳代码完整性,见 [iv8-env-patching.md](iv8-env-patching.md) "iv8 失败止损规则");Black-box 模式已禁用

## 5.5 闭包内函数 hook 策略

加密函数常位于 Webpack 闭包 / IIFE 闭包内,iv8 expose 桥接从外部访问不到(全局搜索找不到,递归遍历也找不到)。此时需修改源码注入 hook。

### 5.5.1 注入 hook 方法

**定位闭包入口**:
- Webpack: `__webpack_require__(moduleId)` 调用点 / 模块工厂函数 `function(module, exports, __webpack_require__){...}`
- IIFE: `(function(){...})()` 入口
- ES Module: `export` 语句前

**注入位置**: 在原始压缩代码上注入(见 §5.3.2)。用字符串替换定位注入点。

**注入示例**:
```javascript
// 原始(Webpack 模块工厂):
function(module,exports,__webpack_require__){
    var encrypt = function(data, key){ ... };
    return {encrypt: encrypt};
}

// 注入后:
function(module,exports,__webpack_require__){
    var encrypt = function(data, key){ ... };
    window.__HOOK__ = encrypt;   // 注入这一行
    return {encrypt: encrypt};
}
```

**访问 Webpack 模块缓存(require.c)的注入模板**:

当目标函数(如 AES 加密)在某个 Webpack 模块内部,且无法通过 `__webpack_require__(moduleId)` 从外部调用时,需注入到 bootstrap 的模块返回点,暴露 `require.c`(模块缓存对象):

```javascript
// 原始 Webpack bootstrap 尾部(常见结构):
function(e){var t={};function n(r){if(t[r])return t[r].exports;
var o=t[r]={i:r,l:!1,exports:{}};
return e[r].call(o.exports,o,o.exports,n),o.l=!0,o.exports}
// 注入点:在 return 后暴露 require.c
return n.c=t,n.m=e,n}    // 原始 return

// 注入后(暴露 require.c 到全局):
return window.__REQUIRE__=n,n.c=t,n.m=e,n}    // 注入 window.__REQUIRE__=n
```

注入后从 Python 侧访问任意模块:
```python
# 通过模块 ID 访问目标模块的 exports(如模块 31 是 AES)
ctx.eval("window.__REQUIRE__(31).encrypt(data, key)")
# 或遍历所有已加载模块,找含 encrypt 函数的模块
ctx.eval("""
var mods = window.__REQUIRE__.c;
for (var id in mods) {
    var exports = mods[id].exports;
    if (typeof exports.encrypt === 'function') {
        window.__FOUND_MODULE__ = id;
        window.__HOOK__ = exports.encrypt;
        break;
    }
}
""")
```

> **定位注入点的技巧**:Webpack bootstrap 的 `return i[...]=...` 或 `return n.c=t,n.m=e` 是常见注入锚点。用 grep 搜 `return.*\.c=` 或 `return.*\.m=` 定位 bootstrap 尾部。若 bootstrap 被 CFF 打散,改用 [stage2-tracing.md](../workflow/stage2-tracing.md) §2.3.5 "动态路径:bootstrap 被 CFF 打散"(Hook `__webpack_require__` 拦截 args 拿模块 ID)。

**注入后运行**: iv8 page.load 加载注入后的代码,通过 `window.__HOOK__` 访问闭包内函数,用 expose 桥接 hook 该函数。

### 5.5.2 注入注意事项

- **注入点定位**: 用 grep 搜索目标函数的特征字符串(如 `encrypt`、`AES`、加密算法名),定位到模块工厂函数后,在 return 语句前注入
- **注入不影响原逻辑**: 注入语句只赋值到 window,不改变原函数行为
- **多目标**: 若需 hook 多个函数,用 `window.__HOOKS__ = {fn1: fn1, fn2: fn2}`
- **清理**: 验证完成后从源码中删除注入语句

## 5.6 验证失败排查

方案 1/2 实现后,输出与 HAR 不匹配时的系统排查流程。

### 5.6.1 排查决策树

```
输出不匹配
├─ 输出长度不匹配
│   ├─ 输入数据源:wrapper 是否改变输入?(静态看到的 JSON.stringify(params) 可能不是实际输入,wrapper 可能筛选/重排/添加字段)
│   ├─ 预处理遗漏:压缩/编码/padding
│   ├─ 算法参数:曲线(EC: secp256k1/SM2/P-256)、密钥长度(AES-128/256)、padding(PKCS7/NoPadding/ZeroPadding)
│   └─ 编码方式:hex/base64/raw bytes、字节序(大端/小端)
├─ 输出内容不匹配(长度一致)
│   ├─ EC 曲线参数:从字符串表反向映射到模块 ID → generateEcparam() → 提取 p/a/b/Gx/Gy/n
│   ├─ 密钥派生:密钥从 password/nonce/salt 派生(非直接传入)
│   ├─ 哈希算法:SM3/SHA-256/MD5(国密 vs 国际标准)
│   └─ IV/mode:CBC/ECB/CTR,IV 来源(固定/随机/派生)
└─ 运行时错误
    ├─ 环境依赖(见 [iv8-env-patching.md](iv8-env-patching.md))
    ├─ 闭包访问(见 §5.5)
    └─ 异步状态(回调完成?Promise resolve?)
```

### 5.6.2 常见陷阱

**陷阱1:wrapper 改变输入**
- 静态分析看到 `encrypt(JSON.stringify(params))`,但实际运行时 wrapper 可能对 params 做了筛选/重排/添加字段
- 排查:用 §5.5 闭包 hook 拦截 encrypt 函数,看实际传入的参数

**陷阱2:EC 曲线参数错误**
- secp256k1(BTC)、SM2(国密)、P-256(NIST) 的 p/a/b/Gx/Gy/n 不同,曲线错了输出完全不对
- 排查:从字符串表反向映射到 generateEcparam() 调用,提取实际曲线参数

**陷阱3:静态分析与运行时行为不一致**
- 静态分析看 `data` 变量是 params 对象,运行时可能是 this(captcha 实例)——OB 壳 CFF 变量遮蔽导致
- 排查:用 §5.5 闭包 hook 验证运行时参数类型

**陷阱4:编码方式误判**
- 看到输出是字符串,但没注意到是 hex 还是 base64;看到字节,但没注意大端还是小端
- 排查:对比输出长度——hex 是字节长度×2,base64 是字节长度×4/3

### 5.6.3 排查流程

1. **第一步:长度比对** — 输出长度与 HAR 真实值比对。长度不一致 → 走 5.6.1 决策树的"输出长度不匹配"分支
2. **第二步:内容比对** — 长度一致但内容不同 → 走"输出内容不匹配"分支
3. **第三步:运行时验证** — 静态排查无果 → 用 §5.5 闭包 hook 拦截实际输入输出,对比静态分析的假设

> **与方案 1 试跑失败处理的关系**:方案 1 试跑失败时,先按本节排查流程快速检查(5.6.3 第一步/第二步),排除明显的参数/编码错误。若排查无果,直接降级方案 2——不在方案 1 上搭建动态调试环境做深入根因分析(见禁止事项)。

## 5.7 验证策略

加密算法分两类,验证方式完全不同。两种模式(扣代码/iv8 补环境)都用本节策略校验。

### 5.7.1 确定性算法验证

**适用场景:** AES/DES(固定 key+IV)、SHA 系列、HMAC、SM2/SM4(固定 key)、MD5、Base64

**验证方法:固定输入 → 全量相等比对**

1. 固定输入:时间戳/随机数种子/所有非常量输入从 HAR 取真实值;若算法用 `Math.random()`,在 iv8 中 `ctx.eval("Math.random = () => 0.12345;")` mock 为固定值
2. 调用本地重写函数(Python/iv8),拿本地输出
3. 全量相等比对:本地输出 === HAR 真实值 → 通过;不等 → 排查算法实现(S 盒/轮数/padding/mode 差异)

### 5.7.2 非确定性算法验证

**适用场景:** RSA(随机 padding)、AES(随机 key/IV)、任何含 `Math.random()`/`guid()`/时间戳微秒的算法

**验证方法:长度 + 结构 + 服务器接受度**

1. 长度不变量:本地输出长度 === HAR 真实值长度;跑 10 次长度恒定 → 加密路径稳定
2. 结构不变量:输出格式固定(hex/base64/JSON 字段集),内部结构完整(如 plaintext 字段齐全、pow_sign 格式正确)
3. 服务器语义验证:发送本地参数到服务器 → 返回 `result=fail`(业务参数错)→ 加密格式合法,通过;返回 `param error` / `w invalid` → 加密格式错误,排查实现

### 5.7.3 验证策略选择

- 算法无随机性(固定 key+IV、纯 SHA/HMAC/MD5)→ §5.7.1 固定输入 + === 比对,通过标准:输出完全相等
- 算法含随机性(Math.random/guid/微秒时间戳/RSA 随机 padding/AES 随机 key)→ §5.7.2 长度 + 结构 + 服务器,通过标准:长度恒定 + 结构完整 + 服务器接受

> **阶段四完成**:验证通过后,产出可运行的加密参数生成代码(方案 1:Python 函数 + API 说明;方案 2:iv8 运行时)。逆向任务结束。

## 5.8 禁止事项

- 禁止跳过阶段二脱壳分析直接扣代码(阶段二已产出加密点位 + 脱壳代码集,见 [stage2-tracing.md](../workflow/stage2-tracing.md))
- 禁止用静态语法引用判运行时依赖(方案 1 用 HAR 真实值验证,方案 2 用 trace 前置 + iv8 debug 探测)
- 禁止跳过输出校验(必须与 HAR 真实参数比对,见 §5.7)
- 禁止使用 Black-box reuse 模式(已禁用,见 SKILL.md P0 禁令;iv8 补不全时触发阶段门阻断)
- 禁止用 trace 作加密点定位的边界来源(v8 下 trace 仅环境指纹采集,不做加密点定位,见 [stage1-basics.md](../workflow/stage1-basics.md) §4)
- 禁止跳级(不要一上来就 iv8 整文件跑,除非是 JSVMP 这种明确扣不了的)
- 禁止补 iv8 已有的环境(先查 [api-reference.md](api-reference.md))
