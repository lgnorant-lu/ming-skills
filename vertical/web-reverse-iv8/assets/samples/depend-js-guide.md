# dependJsContent 编写指南

本文档教 AI 如何从 OB 字符串表混淆的原始 JS 中识别、扣取并编写 `dependJsContent` / `depend.js`。

## 目标

`dependJsContent` 是最小可执行解密运行时。它只需要保证：

```js
eval(dependJsContent);
DECNAME(args);
```

能返回与原混淆代码运行时一致的字符串。

不要把原始脚本主流程、业务逻辑、埋点、浏览器交互或反调试触发代码搬进来。最好的 `dependJsContent` 只包含：

- 字符串数组声明或字符串数组函数
- 数组旋转逻辑,或旋转后的最终数组
- 解密函数本体
- 解密函数直接或间接依赖的 helper

一份原 JS 可能有多套字符串表。所有需要被当前解混淆脚本求值的字符串表运行时,都要放进同一个 `dependJsContent`。

## depend 组成

OB 字符串表混淆常见由 4 类代码组成。

### 1. 字符串数组

直接数组：

```js
var _0xarr = ["log", "hello", "world"];
var _0xenc = ["bG9n", "aGVsbG8=", "d29ybGQ="];
```

函数包装数组：

```js
function _0xgetArr() {
  var arr = ["abc", "def"];
  _0xgetArr = function () {
    return arr;
  };
  return _0xgetArr();
}
```

识别要点：

- 数组元素多数是字符串,数量通常较多
- 函数包装数组常见“自重写”：`X = function(){ return arr; }`
- 名字常见 `_0x` 乱码,也可能是短名或 Unicode 名

### 2. 数组旋转 IIFE

标准旋转：

```js
(function (arr, count) {
  while (--count) {
    arr.push(arr.shift());
  }
})(_0xarr, 0x123);
```

校验循环变体：

```js
(function (getArr, target) {
  var arr = getArr();
  while (!![]) {
    try {
      var checksum = parseInt(dec(0x10)) / 1 + parseInt(dec(0x11)) / 2;
      if (checksum === target) break;
      arr.push(arr.shift());
    } catch (e) {
      arr.push(arr.shift());
    }
  }
})(_0xgetArr, 0xabcde);
```

识别要点：

- `ExpressionStatement` 包着 IIFE `CallExpression`
- 第一个实参通常是数组名或数组函数名
- 函数体出现 `push(shift())` 或 `unshift(pop())`
- try/catch 校验型可能在旋转阶段调用解密函数

优先把旋转执行完,写入最终数组。只有静态还原成本太高时,才把旋转 IIFE 保留进 `dependJsContent`。

### 3. 解密函数

简单形式：

```js
function dec(index) {
  return arr[index];
}
```

常见复杂形式：

```js
function dec(index, key) {
  var arr = getArr();
  dec = function (realIndex, realKey) {
    realIndex = realIndex - 0x181;
    var value = arr[realIndex];
    value = rc4(base64Decode(value), realKey);
    return value;
  };
  return dec(index, key);
}
```

识别要点：

- 函数名就是 CLI `--decrypt` / report `解密函数` 中要传的名字
- 函数体会引用字符串数组或数组函数
- 常见索引偏移：`index = index - 0x181`
- 可能有自重写、缓存、base64、RC4、URI 解码

保留解密语义,不要删除自重写和缓存逻辑。它们通常是解密函数的一部分。

### 4. helper

helper 是解密函数内部调用、但声明在解密函数外部的辅助函数。

常见 helper：

- `atob` polyfill
- base64 解码
- RC4 / XOR 解码
- URI 编解码包装

识别方法：

```text
从解密函数体出发,收集所有外部函数引用。
对每个外部函数继续递归收集它依赖的外部 helper。
函数内部定义的局部 helper 不需要单独扣取。
```

不要保留只用于反调试、DOM、环境检测、埋点的 helper,除非它直接影响 `DECNAME(args)` 返回值。

## 组装顺序

组装顺序由 JavaScript 声明提升决定。

| 声明形式 | 声明是否提升 | 赋值是否提升 |
| --- | --- | --- |
| `function f(){}` | 是,函数体整体提升 | 不适用 |
| `var x = [...]` | 是,变量名提升 | 否 |
| IIFE 表达式 | 否 | 否 |

推荐规则：

1. 如果字符串数组是 `var arr = [...]`,数组声明必须放在旋转 IIFE 之前。
2. 如果字符串数组是 `function getArr(){...}`,函数声明可以写在旋转 IIFE 后面,因为函数声明提升。
3. 旋转 IIFE 必须在第一次调用解密函数之前执行。
4. helper 必须在第一次调用解密函数之前可用；函数声明通常天然满足。

`var` 数组推荐顺序：

```text
1. var 字符串数组声明
2. 旋转 IIFE,或省略并直接使用最终数组
3. helper 函数
4. 解密函数
```

函数包装数组推荐顺序：

```text
1. 旋转 IIFE,或省略并直接使用最终数组
2. 字符串数组函数声明
3. helper 函数
4. 解密函数
```

如果直接写旋转后的最终数组,则顺序更简单：

```text
1. 最终数组
2. helper 函数
3. 解密函数
```

## 推荐输出形态

优先输出纯净形态：

```js
var _arr = [
  "...",
  "..."
];

function _0x21dc5e(index) {
  index = index - 0x100;
  return _arr[index];
}
```

复杂解密保留必要 helper：

```js
var _arr = [
  "..."
];

function _0x21dc5e(index, key) {
  index = index - 0x100;
  var value = _arr[index];
  return rc4(base64Decode(value), key);
}

function base64Decode(value) {
  return Buffer.from(value, "base64").toString("binary");
}

function rc4(value, key) {
  // only code required by _0x21dc5e
}
```

如果原函数依赖缓存或自重写,保留完整结构：

```js
function dec(index, key) {
  var arr = getArr();
  return dec = function (realIndex, realKey) {
    realIndex = realIndex - 0x181;
    var cacheKey = realIndex + ":" + realKey;
    dec.cache = dec.cache || {};
    if (dec.cache[cacheKey]) return dec.cache[cacheKey];
    var value = rc4(arr[realIndex], realKey);
    return dec.cache[cacheKey] = value;
  }, dec(index, key);
}
```

## 识别流程

按这个顺序处理：

1. 找到原代码中的解密调用点。

   ```js
   dec(0x123)
   dec(0x123, "key")
   obj.dec(0x123)
   arr[12]
   ```

2. 找到对应解密函数或明文数组。

   ```js
   function dec(i) {}
   var dec = function (i) {};
   obj.dec = function (i) {};
   var arr = ["a", "b"];
   ```

3. 从解密函数体反向追踪数组、数组函数、helper。

4. 找到数组旋转 IIFE 或旋转校验循环。

5. 决定输出方式：

   ```text
   能静态得到最终数组 -> 直接输出最终数组
   不能稳定静态还原 -> 保留必要旋转 IIFE
   ```

6. 按组装顺序拼接成 `dependJsContent`。

7. 用多个真实调用点验证。

## 扣取方法

推荐源码字符切片：

1. 用 Babel parser 解析原 JS。
2. traverse 找到数组声明、旋转 IIFE、解密函数、helper。
3. 用节点 `start` / `end` 从原源码切片。
4. 按组装顺序拼接。

源码切片比重新生成代码更适合保留反调试正则、字符串转义和函数 `toString()` 形态。若确认这些不影响解密,也可以用 `@babel/generator` 重新生成。

## 反调试处理

真实 OB 依赖代码可能包含反调试,`eval` 时会卡死或改变状态。

识别特征：

- `debugger`
- `RegExp` + `toString()` + `test`
- `while (!![])` / `for (;;) `
- 无限递归或无限 `push`
- `new X(...).method()` 触发检测

处理策略：

```text
保留不会执行的类/函数定义。
删除或注释触发语句。
不要把 setInterval、debugger、console.clear 等主流程保护带进 depend。
```

例如：

```js
// new _0xb0f2b1(dec).KzabiP();
```

触发语句不影响 `DECNAME(args)` 返回值时,应删除或注释。

## 浏览器 API 与环境

当前脚本直接 `eval(dependJsContent)`,运行环境是 Node.js。不要默认存在完整浏览器 API。

优先改写为纯函数 helper。确实需要环境对象时,在 `dependJsContent` 头部补最小 stub：

```js
var window = globalThis;
var self = globalThis;
var document = { cookie: "" };
var navigator = { userAgent: "Mozilla/5.0", plugins: [], platform: "Win32" };
```

不要补庞大的浏览器模拟环境。只补解密函数实际读取的字段。

如果需要 base64：

```js
function atob(value) {
  return Buffer.from(value, "base64").toString("binary");
}

function btoa(value) {
  return Buffer.from(value, "binary").toString("base64");
}
```

## 安全边界

`dependJsContent` 会执行,不要包含未知副作用代码。

必须避免：

```js
require("fs")
process.env
child_process
fetch(...)
XMLHttpRequest
document.cookie = ...
localStorage.setItem(...)
setTimeout(...)
setInterval(...)
```

如果原代码包含这些语句,但它们不影响解密函数返回值,删除。

## 验证标准

最小验证：

```bash
# <实际样本索引偏移> 替换为目标 JS 中解密函数的实际索引偏移(如 0x181、0x100 等)
# 示例 0x181 来自 geetest4 案例,不同样本偏移不同,不可照搬
node -e "eval(require('fs').readFileSync('depend.js','utf8')); console.log(typeof dec); console.log(dec(<实际样本索引偏移>))"
```

期望：

```text
function
<明文字符串>
```

更严格的断言验证：

```js
eval(dependJsContent);

const checks = [
  [[0x181], "expected text"],
  [[0x182, "key"], "another text"]
];

for (const [args, expected] of checks) {
  const actual = DECNAME(...args);
  if (actual !== expected) {
    throw new Error(`${args.join(",")}: ${actual} !== ${expected}`);
  }
}
```

验证失败含义：

- `ReferenceError: xxx is not defined`：漏扣 helper 或环境 stub
- `Cannot read properties of undefined`：组装顺序错,常见是 var 数组在旋转 IIFE 后
- 返回 `undefined`：索引偏移、数组旋转或解密函数名错
- 返回乱码/错位：旋转 IIFE 没执行或最终数组状态不对
- eval 卡死：反调试触发或无限循环未处理

## 多套字符串表

一份原 JS 可能同时包含：

```js
plainArr[12]
decA(0x181)
decB(0x20, "key")
```

`dependJsContent` 应包含所有当前解混淆任务会求值的数组和解密函数。

注意：

```text
当前 CLI 的 --decrypt 主要处理函数调用形式。
直接数组索引 arr[idx] 是否替换,取决于脚本是否实现对应逻辑。
即便如此,depend 中仍可包含明文数组,方便后续扩展或手动验证。
```

## 自检清单

扣取完成后逐项检查：

- [ ] 包含所有需要的字符串数组声明或数组函数
- [ ] 包含所有必要旋转 IIFE,或已经写入旋转后的最终数组
- [ ] 包含目标解密函数完整结构
- [ ] 自重写逻辑没有误删
- [ ] state cache 没有误删
- [ ] 外部 helper 已递归扣取完整
- [ ] 内嵌 helper 没有被误当作外部 helper 重复扣取
- [ ] var 数组在旋转 IIFE 之前
- [ ] 旋转 IIFE 在首次解密调用之前执行
- [ ] 反调试触发语句已删除或注释
- [ ] 浏览器 API 只补了最小 stub
- [ ] 已用 3 到 10 个真实调用点验证
- [ ] CLI `--decrypt` 名称与 depend 中可调用函数一致
- [ ] 多套字符串表没有遗漏

## 最小原则

每次编写 `dependJsContent` 只问一个问题：

```text
DECNAME(args) 是否能稳定返回原始运行时字符串？
```

如果答案是能,停止添加代码。
