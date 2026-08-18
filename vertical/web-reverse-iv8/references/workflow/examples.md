# 示例集(辅助参考,非必读)

> **定位**:辅助理解,非必读。本文件例子均为"AI 不会犯错但深入理解有益"的场景。
> **必读例子已内嵌**到对应主文档的 Gotchas 章节(标注 [内嵌理由])。
> **加载时机**:仅当主文档规则理解困难时,按需查阅本文件对应章节。

---

# 阶段一示例

> 阶段一主文档:[stage1-basics.md](stage1-basics.md)。必读 Gotchas 已内嵌到 stage1-basics.md §2。

## 示例 1:参数分类示例

**关联规则**:[stage1-basics.md](stage1-basics.md) §3 Step 1

对目标接口的每个参数,对比多份样本,分类:

| 类型 | 判定 | 处理 |
|------|------|------|
| 固定常量 | 所有样本值相同,且明显是硬编码 | 直接硬编码,无需溯源 |
| 接口透传 | 值来自上游接口的响应 | 追溯上游接口 |
| JS 生成 | 值不在任何接口响应里,由 JS 算出 | 切到阶段二 |
| 用户输入 | 值由用户操作产生(如搜索词) | 标记为外部输入,不溯源 |

**示例**:
- 参数 `app_id=12345` 在所有样本中相同,且在 JS 源码中找到硬编码 → 固定常量
- 参数 `ts=1690000000` 每次不同,但在上游接口 `/api/config` 的响应中有 `server_time` → 接口透传
- 参数 `sign=abc123def456` 不在任何接口响应中,长度固定,看似随机 → JS 生成(切阶段二)
- 参数 `keyword=hello` 由用户输入 → 用户输入

## 示例 2:WASM 检测示例

**关联规则**:[stage1-basics.md](stage1-basics.md) §3 Step 3

检测方式:
- 扫描所有请求的 URL,匹配 `.wasm` 后缀
- 扫描响应体的 Content-Type,匹配 `application/wasm`
- 扫描 JS 请求的响应体,搜索 `WebAssembly.instantiate` / `WebAssembly.instantiateStreaming` 调用(可能 .wasm 以 Base64 嵌入 JS)

**输出字段**:
```markdown
### WASM 加载存在标记
- 是否检测到 .wasm 加载: 是/否
- .wasm 文件 URL 列表(仅当"是"时填写):
  - <URL1>
  - <URL2>
```

**约束**:
- 不记录加载时机/顺序/发起接口(细节留阶段二回溯)
- 仅标记"存在"与"URL",供阶段二/阶段三参考
- 未检测到 .wasm 加载不代表无 WASM(可能是 Base64 嵌入),阶段二脱壳时会进一步确认

## 示例 3:trace 数据结构详解

**关联规则**:[stage1-basics.md](stage1-basics.md) §4.3

每行 NDJSON 字段:

| 字段 | 类型 | 说明 |
|------|------|------|
| seq | number | 调用序列号(递增) |
| ts | number | 时间戳(毫秒) |
| type | string | get/set/call/construct/typeof/instanceof/timer/console/trace_init |
| interface | string | API 所属接口(如 Navigator、CanvasRenderingContext2D) |
| member | string | 访问的成员(如 userAgent、toDataURL) |
| args | array | 函数调用参数 |
| value | any | 属性读/写的值,或函数调用返回值(不同 type 取值字段不同) |
| stack | array | 调用栈,每项含 func/file/line/col(仅记录触达 Web API 的 JS 帧) |

**filter 输出 entry 字段**:

| 字段 | 说明 |
|------|------|
| op | interface.member 拼接的 API 标识(如 Navigator.userAgent) |
| value | 属性值或返回值(get/set 取 value,call/construct 取 return,typeof/instanceof 取 result) |
| seq | 调用序列号 |
| type | 事件原始 type |

## 示例 4:filter 输出格式示例

**关联规则**:[stage1-basics.md](stage1-basics.md) §5.2

```json
{
  "tdc.js": [
    {"op": "Navigator.userAgent", "value": "Mozilla/5.0...", "seq": 123, "type": "get"},
    {"op": "HTMLCanvasElement.toDataURL", "value": "data:image/png...", "seq": 456, "type": "call"},
    {"op": "XMLHttpRequest.", "value": "[object XMLHttpRequest]", "seq": 789, "type": "construct"}
  ],
  "dy-ele.js": [
    {"op": "WebGLRenderingContext.getParameter", "value": "Intel Inc.", "seq": 999, "type": "call"}
  ]
}
```

## 示例 5:HAR 参数分析报告模板字段

**关联规则**:[stage1-basics.md](stage1-basics.md) §7.1

按 [param-analysis.md](../../assets/templates/param-analysis.md) 模板输出,必含:
- 接口信息(URL、方法、用途)
- 样本清单
- 参数溯源表(参数名、位置、类型、来源、上游/加密点、依赖输入、终止标记)
- 透传链路图(树形展示依赖关系)
- 加密参数清单(含 `_initiator.stack` 字段化输出)
- WASM 加载存在标记
- HAR 来源校验结果
- 环形依赖检查
- 结论(待逆向参数数、透传接口数、固定常量数)

## 示例 6:HAR 注意事项

**关联规则**:[stage1-basics.md](stage1-basics.md) §3

- HAR 里同名参数可能在 query/body/header 多处出现,都要分析
- 某些参数值看起来随机但其实是 base64/hex 编码的固定值,注意解码后再对比
- 透传参数的上游接口可能需要 cookie/鉴权,记录这些依赖
- `_initiator.stack` 的行列号是原始压缩代码的字节偏移,**columnNumber 是最可靠定位信息**(混淆函数名可能多处重复)
- 抓包工具导出的 HAR 可能丢失 `_initiator`,必须用浏览器(推荐 Chrome)导出

---

# 阶段二示例

> 阶段二主文档:[stage2-tracing.md](stage2-tracing.md)。必读 Gotchas 已内嵌到 stage2-tracing.md §4。
> 以下示例均为"AI 不会犯错但深入理解有益"的场景,非必读。决策性反例已内嵌到 stage2-tracing.md §4。

## 示例 7:depend 调整循环详细诊断

**关联规则**:[stage2-tracing.md](stage2-tracing.md) §2.1.2-A 方案一 depend 调整循环 attempt 2-5 Step 1

depend 调整循环 attempt 2-5 的 Step 1 诊断(基于上次 report 失败字段):

```
IF evalFailures > 0
   → 诊断:depend.js eval 抛异常
     可能原因:漏扣 helper / 反调试触发 / 组装顺序错 / 浏览器 API 缺 stub

IF unsupportedResultFailures > 0
   → 诊断:解密返回值非字符串
     可能原因:depend.js 解密函数名错 / 解密函数自重写逻辑误删

IF replacedCalls / targetCalls < 0.95 且 3 项失败计数均为 0
   → 诊断:未识别调用形式
     可能原因:depend.js 缺少某套字符串表 / 解密函数名不完整

IF 标准A通过但标准B失败
   → 诊断:depend.js 解密语义错误
     可能原因:旋转 IIFE 未执行 / 最终数组状态错 / 解密函数偏移错
```

**修订流程**:
1. 参照 depend-js-guide.md 自检清单 13 项逐条排查
2. 用验证标准单测(占位符,替换 `<实际样本索引偏移>` 为真实值):
   ```
   node -e "eval(require('fs').readFileSync('depend.js','utf8')); console.log(typeof dec); console.log(dec(<实际样本索引偏移>))"
   ```

## 示例 8:标准B人工抽检详细规则

**关联规则**:[stage2-tracing.md](stage2-tracing.md) §2.1.2-A 达标判定标准 标准B

**抽样数量分层**(基于 targetCalls):

```
IF targetCalls <= 10  → 全抽
IF 10 < targetCalls <= 100  → 抽 10 个(头部3 + 中部4 + 尾部3)
IF targetCalls > 100  → 抽 5 个(头部2 + 中部2 + 尾部1)
```

**验证方法**(确定性,4 步):

1. 从 outputFile 用 AST 提取抽样点的字符串字面量
2. iv8 page.load 加载原混淆 JS,Hook 解密函数返回值
3. 对每个抽样点,用相同参数调用解密函数,拿运行时返回值
4. 比对字面量与 iv8 运行时返回值

```
IF 全部一致 → 标准B通过
IF 任一不一致 → 标准B失败
```

## 示例 9:require.c 注入模板详细代码

**关联规则**:[stage2-tracing.md](stage2-tracing.md) §2.3.5 "访问 Webpack 模块缓存"

模块缓存在闭包内(`require.c`),无法直接外部访问。注入模板(在 bootstrap 尾部注入,暴露 require 和 cache 到全局):

```javascript
// 定位注入点:bootstrap 的 return 语句前
// 常见注入锚点:
//   return i['m']=modules,i['c']=cache,...
//   return n.c=t,n.m=e
// 用 grep 搜 "return.*\.c=" 或 "return.*\.m=" 定位 bootstrap 尾部

// 注入代码(将 require 和 cache 暴露到全局):
}}return i['m']=modules,i['c']=cache,
window.__wpr = i,   // 暴露 require 函数
window.__wpc = cache, // 暴露模块缓存
i;  // 保持原 return 值不变
```

**使用方式**:

```python
# iv8 加载注入后的代码后
ctx.eval("window.__wpr(31)")  # 加载 Module 31,缓存到 window.__wpc[31]
ctx.eval("window.__wpc[31].exports")  # 访问 Module 31 的 exports
```

## 示例 10:常见误判清单

**关联规则**:[stage2-tracing.md](stage2-tracing.md) §2.3 全章节

去壳阶段的常见误判(AI 原生可独立识别,列表用于参考强化):

- 只做 beautify 就宣布恢复完成(没还原字符串表)
- 字符串表未还原就试图读 CFF 逻辑(应先还原字符串表,才能读懂 case 标签)
- 字符串表运行时拉取时,试图静态推导解密函数本身
- 把 JSVMP 当"解不开的壳"硬刚静态还原,而不是回退用五条清单复核
- 把 JSVMP 内部 eval 当壳拆碎 VM(见 [stage2-tracing.md](stage2-tracing.md) §2.3.0 "eval 何时是壳")
- 把反调试分支翻转误判为"还原错误",继续在去壳阶段改代码
- **过度去壳**:已能读懂代码后继续做 CFF 还原/变量重命名/死代码消除

## 示例 11:大文件处理详细规则

**关联规则**:[stage2-tracing.md](stage2-tracing.md) §2 前置条件 + [conventions.md](../modules/conventions.md) §4.9.1

目标 JS 若是单行压缩/混淆文件(常见于 OB 壳,如 tdc.js 78KB 单行),Read 工具会在 ~30KB 处截断。定位字符串表/解密函数时:

- ⛔ 禁止用 Read 直接读取单行大文件
- 改用 Grep 工具定位关键标识符(如 `_0x` / `decode` / `rot`)+ Python 脚本 `str.find()` 提取上下文
- 统计字符串出现次数禁止用 `grep -c`(count 模式误导),改用:
  ```
  python -c "print(open(f).read().count('pattern'))"
  ```
