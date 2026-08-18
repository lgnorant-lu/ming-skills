# JS反混淆完整方法

## 快速判断混淆类型

打开JS文件，看前100行：

| 症状 | 混淆类型 | 复杂度 | 处理方式 |
|------|----------|--------|----------|
| `var _0x1234 = [...]` | 字符串表 | ⭐ | 运行解码函数替换 |
| `_0x1234('0x1a2b')` | 字符串表引用 | ⭐ | 同上 |
| `while(!![]) { switch(...) { case 0: } }` | 控制流平坦化 | ⭐⭐ | AST拍平 |
| `for(;;) { if(...) ... }` | 简化控制流 | ⭐⭐ | AST拍平 |
| 大数组+解释器+位运算 | JSVMP | ⭐⭐⭐ | 需专用工具 |
| `if(false) ...` / `if(true) ...` | 死代码/虚假分支 | ⭐ | 直接删除 |
| `0x1a2b + 0x3c4d` | 数字常量混淆 | ⭐ | 直接计算替换 |
| `!![]` = `true`, `![]` = `false` | JSFuck风格 | ⭐ | 直接替换 |

---

## 方法1：手动快速反混淆（小文件 < 50KB）

### Step 1：找到字符串表

```javascript
// 混淆代码通常在最前面有一个字符串数组
var _0x1234 = [
    'encrypt', 'md5', 'toString', 'apply', 'AES',
    'CBC', 'PKCS7', 'publicKey', 'sign', 'getToken',
    // ... 几十到几百个字符串
];

// 解码函数通常紧跟其后
function _0x5678(idx, _) {
    idx = idx - 0x1a2;
    return _0x1234[idx];
}
// 或
var _0x5678 = function(idx) {
    return _0x1234[idx - 0x1a2];
};
```

### Step 2：在Node.js中运行解码

```javascript
// decode_strings.js
const fs = require('fs');
const vm = require('vm');

// 1. 读取混淆文件
let code = fs.readFileSync('input.js', 'utf8');

// 2. 提取字符串表和其解码函数
// 在vm中运行提取的代码
const sandbox = { console, _0x1234: null, _0x5678: null };
vm.createContext(sandbox);

// 执行字符串表定义
vm.runInContext(/* 字符串表定义代码 */, sandbox);
// 执行解码函数定义
vm.runInContext(/* 解码函数代码 */, sandbox);

// 3. 替换所有 _0x5678('0x1a2') 引用
code = code.replace(/_0x5678\('(0x[0-9a-f]+)'\)/g, (match, idx) => {
    const result = sandbox._0x5678(parseInt(idx));
    return JSON.stringify(result);
});

fs.writeFileSync('output.js', code);
```

### Step 3：清理

```javascript
// 删除死代码
code = code.replace(/if\s*\(\s*true\s*\)\s*\{/g, '{');
code = code.replace(/if\s*\(\s*false\s*\)\s*\{[\s\S]*?\}/g, '');
code = code.replace(/if\s*\(!\[\]\)\s*\{[\s\S]*?\}/g, ''); // ![] = false

// 删除字符串表（已不再使用）
code = code.replace(/var _0x1234 = \[[\s\S]*?\];/, '// string table removed');
code = code.replace(/function _0x5678[\s\S]*?\n\}/, '// decoder removed');

// 用 prettier 格式化
// npx prettier --write output.js
```

---

## 方法2：使用项目AST反混淆工具（大文件 > 50KB）

### 工具位置
```
.qoder/skills/ast-deobfuscation/
├── scripts/
│   ├── detect-patterns.js    # 检测混淆家族
│   ├── run-pipeline.js       # 运行反混淆流水线
│   └── collect-residue-metrics.js  # 统计剩余混淆
└── references/patterns/      # 站点专用规则
```

### 使用步骤

```powershell
# Step 1: 检测混淆类型
node .qoder/skills/ast-deobfuscation/scripts/detect-patterns.js input.js
# 输出: Detected patterns: cn-bidding-ob, string-array, control-flow

# Step 2: 运行反混淆流水线
node .qoder/skills/ast-deobfuscation/scripts/run-pipeline.js input.js output/
# 输出: 
#   Step 1/9: normalize-sequence ... done (1.2s)
#   Step 2/9: inline-literals ... done (3.5s)
#   Step 3/9: flatten-control-flow ... done (8.1s)
#   ...

# Step 3: 检查残留
node .qoder/skills/ast-deobfuscation/scripts/collect-residue-metrics.js output/final.js
# 输出: 剩余 _0x 标识符: 25915 → 可能需要多轮处理
```

### 常见工具报错修复

```javascript
// 报错: valueToNode: unsupported type
// 修复: 在 pattern-utils.js 中添加 try-catch
try {
    return valueToNode(value);
} catch (e) {
    console.warn('valueToNode fallback for:', typeof value);
    return t.stringLiteral(String(value));
}
```

---

## 方法3：控制流平坦化处理

### 识别
```javascript
// 平坦化前（原始代码）：
function encrypt(data) {
    var key = getKey();
    var iv = getIV();
    return AES.encrypt(data, key, {iv: iv});
}

// 平坦化后（混淆代码）：
function encrypt(_0x1, _0x2) {
    var _0x3 = 0x0;
    while (!![]) {
        switch (_0x3) {
            case 0x0:
                var _0x4 = getKey();
                _0x3 = 0x1;
                continue;
            case 0x1:
                var _0x5 = getIV();
                _0x3 = 0x2;
                continue;
            case 0x2:
                return AES['encrypt'](_0x1, _0x4, {'iv': _0x5});
        }
        break;
    }
}
```

### 手动拍平步骤

1. 找到 switch 的所有 case
2. 按 case 编号排序
3. 移除 switch/while 包装
4. 按顺序拼接代码
5. 处理 continue/break

---

## 混淆家族速查

| 家族 | 特征 | 出现站点 | 处理脚本 |
|------|------|----------|----------|
| OB变种 | `_0x` 前缀、字符串表 | ouc_exam, ocyuan | cn-bidding-ob |
| 顶象 | `_$` 前缀、自执行包装 | 顶象系站点 | dingxiang |
| 极验4 | 大数组+for/switch | 极验系站点 | geetest4 |
| 小红书 | `_webmsxyw` 入口 | xiaohongshu | xiaohongshu |
| 网易易盾 | `__TENCENT_CHAOS_VM` | 网易系 | yidun |

---

## JSVMP 虚拟机保护逆向技巧

JSVMP 是将原始 JS 代码编译成字节码，通过虚拟机解释执行的保护技术。
常见于抖音/头条/携程等大型站点的签名参数保护。

### 特征识别
- 大数组 + `switch` 或 `apply` 分发
- 输出参数长度固定（如 a_bogus ~150-200字符）
- 代码完全不可读，无有意义的函数名

### 技巧1：条件断点定位（推荐）

```javascript
// 在 apply/call 上设条件断点——JSVMP通过fn.apply(this, args)分发
// 利用输出参数的特征过滤

// 浏览器Console中执行：
(function() {
    const origApply = Function.prototype.apply;
    Function.prototype.apply = function(thisArg, args) {
        // 条件：返回值的长度在目标范围内
        const result = origApply.call(this, thisArg, args);
        if (typeof result === 'string' && result.length >= 150 && result.length <= 200) {
            console.log('[JSVMP Candidate] length:', result.length);
            console.log('  result prefix:', result.substring(0, 50));
            console.log('  this:', this.toString().substring(0, 100));
            console.log('  args:', args);
            debugger;  // 自动断点
        }
        return result;
    };
})();
```

### 技巧2：根据前缀/后缀特征过滤

```javascript
// a_bogus 特征：包含特定前缀
Function.prototype.apply = function(thisArg, args) {
    const result = origApply.call(this, thisArg, args);
    if (typeof result === 'string' && 
        (result.startsWith('_02B4Z6wo00') ||   // _signature 前缀
         result.includes('DkDPgh') ||           // X-Bogus 特征
         result.length === 168)) {              // a_bogus 长度
        debugger;
    }
    return result;
};
```

### 技巧3：根据参数名长度过滤

```javascript
// 直接在加密参数的 setter 处设断点
// 例如拦截 URL 参数拼接：
const origStringify = JSON.stringify;
JSON.stringify = function(obj) {
    const result = origStringify.call(this, obj);
    // 检查是否包含目标参数名
    if (result.includes('a_bogus') || result.includes('_signature')) {
        console.log('[JSON.stringify] 参数生成中...');
        debugger;
    }
    return result;
};
```

### 技巧4：XHR 断点回溯

```
1. js-reverse-mcp → break_on_xhr → XHR发送时自动断点
2. 查看调用栈 → 逐层向上追踪
3. 找到参数写入点 → 设条件断点
```

### 决策：纯算 vs 补环境

| JSVMP复杂度 | 方案 |
|------------|------|
| 单层、逻辑清晰 | 反混淆后纯算 |
| 多层嵌套、依赖 DOM API | 补环境 + 扣代码 |
| 极度复杂、频繁更新 | 放弃纯算，走 CDP 桥 |

---

## 方法4：自包含 AST 反混淆管线（本技能内置）

> 以下代码可直接运行，不依赖 `ast-deobfuscation` 技能

### 4a. 字符串表自动解码（Python）

无需 Node.js，纯 Python 解码 `_0x` 风格混淆的字符串表：

```python
# deobfuscate_strings.py — 自动解码 _0x 风格字符串表
import re
import sys

def extract_and_decode_strings(filepath: str, output_path: str = None):
    """从混淆JS中提取字符串表并替换所有引用
    
    支持以下模式：
    1. var _0x1234 = ['str1', 'str2', ...];
       function _0x5678(idx, _) { return _0x1234[idx - 0x1a2]; }
    2. var _0xabc = ['str1', ...];
       var _0xdef = function(idx) { return _0xabc[idx - 0x100]; };
    3. 嵌套数组 + 位移解码
    """
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()
    
    # Step 1: 找到字符串表（大数组）
    array_pattern = r'(?:var|const|let)\s+(_0x\w+)\s*=\s*\[([^\]]+)\]'
    array_matches = re.findall(array_pattern, code, re.DOTALL)
    
    if not array_matches:
        print("[WARN] 未找到字符串表，尝试搜索其他模式...")
        # 搜索任何变量名的大数组
        array_pattern2 = r'(?:var|const|let)\s+(\w+)\s*=\s*\[([^\]]{100,})\]'
        array_matches = re.findall(array_pattern2, code, re.DOTALL)
    
    if not array_matches:
        print("[FAIL] 无法找到字符串表")
        return code
    
    results = {}
    
    for var_name, array_content in array_matches:
        # 解析数组元素
        elements = []
        for m in re.finditer(r"'([^']*)'|\"([^\"]*)\"", array_content):
            elements.append(m.group(1) or m.group(2))
        
        if len(elements) < 5:
            continue  # 太小，不是字符串表
        
        print(f"[FOUND] 字符串表: {var_name} ({len(elements)} 个元素)")
        
        # Step 2: 找到解码函数
        # 模式A: function xxx(idx, _) { return arr[idx - offset]; }
        func_pattern = rf'(?:function\s+(_0x\w+)\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\{{\s*return\s+{var_name}\[[^\]]+-\s*(0x[0-9a-fA-F]+)\s*\]|var\s+(_0x\w+)\s*=\s*function\s*\(\s*\w+\s*\)\s*\{{\s*return\s+{var_name}\[[^\]]+-\s*(0x[0-9a-fA-F]+)\s*\])'
        
        func_match = re.search(func_pattern, code)
        if not func_match:
            # 宽松模式：找引用该数组的函数
            func_pattern2 = rf'(?:function|var)\s+(_0x\w+)\s*[=(\(]'
            func_matches = re.findall(func_pattern2, code)
            # 对每个候选函数检查是否引用了数组
            decoder_name = None
            offset = 0
            for fn_name in set(func_matches):
                # 检查函数定义中是否包含数组名
                fn_def = re.search(
                    rf'(?:function\s+{fn_name}|{fn_name}\s*=\s*function)\s*\([^)]*\)\s*\{{([^}}]{50,500}?)\}}',
                    code, re.DOTALL
                )
                if fn_def and var_name in fn_def.group(1):
                    decoder_name = fn_name
                    # 尝试提取偏移
                    offset_match = re.search(rf'{var_name}\[[^\]]*-\s*(0x[0-9a-fA-F]+)', fn_def.group(1))
                    if offset_match:
                        offset = int(offset_match.group(1), 16)
                    break
        else:
            decoder_name = func_match.group(1) or func_match.group(3)
            offset = int(func_match.group(2) or func_match.group(4), 16)
        
        if not decoder_name:
            print(f"[WARN] 未找到 {var_name} 的解码函数，跳过")
            continue
        
        print(f"[FOUND] 解码函数: {decoder_name}, 偏移: {offset} (0x{offset:x})")
        
        # Step 3: 替换所有调用
        # 模式: decoder_name('0x1a2b') 或 decoder_name("0x1a2b")
        replace_count = 0
        call_pattern = rf'{decoder_name}\s*\(\s*["\'](0x[0-9a-fA-F]+)["\']\s*\)'
        
        def replacer(m):
            nonlocal replace_count
            idx_hex = m.group(1)
            idx = int(idx_hex, 16) - offset
            if 0 <= idx < len(elements):
                replace_count += 1
                return f"'{elements[idx]}'"
            return m.group(0)  # 索引越界，保持原样
        
        code = re.sub(call_pattern, replacer, code)
        print(f"[DONE] 替换了 {replace_count} 处引用")
        
        # Step 4: 删除字符串表和解码函数定义（可选）
        # code = re.sub(rf'var {var_name}\s*=\s*\[[^\]]+\];?\s*', '/* string table removed */\n', code)
        # code = re.sub(rf'(?:function\s+{decoder_name}\s*\([^)]*\)\s*\{{[^}}]+\}}|var\s+{decoder_name}\s*=\s*function\s*\([^)]*\)\s*\{{[^}}]+\}});?\s*', '/* decoder removed */\n', code)
    
    # Step 5: 输出结果
    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(code)
        print(f"[OUTPUT] {output_path}")
    
    return code


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python deobfuscate_strings.py input.js [output.js]")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else input_file.replace('.js', '_deobf.js')
    extract_and_decode_strings(input_file, output_file)
```

### 4b. AST 反混淆最小管线（Node.js + Babel）

自包含的 Babel AST 反混淆脚本，无需安装 `ast-deobfuscation` 技能：

```javascript
// deobfuscate_ast.js — 自包含 Babel AST 反混淆管线
// 安装依赖: npm install @babel/parser @babel/generator @babel/traverse @babel/types

const parser = require('@babel/parser');
const generate = require('@babel/generator').default;
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const fs = require('fs');

const code = fs.readFileSync(process.argv[2], 'utf-8');

// Step 1: 解析
const ast = parser.parse(code, {
    sourceType: 'unambiguous',
    errorRecovery: true,
});

let changes = 0;

// === Pass 1: 内联字符串常量 ===
traverse(ast, {
    CallExpression(path) {
        // 匹配: _0x1234('0x1a2b')
        if (t.isIdentifier(path.node.callee) &&
            path.node.callee.name.startsWith('_0x') &&
            path.node.arguments.length === 1 &&
            t.isStringLiteral(path.node.arguments[0]) &&
            path.node.arguments[0].value.startsWith('0x')) {
            
            // 尝试计算（如果字符串表和解码函数在当前作用域）
            try {
                const evalCode = generate(path.node).code;
                const result = eval(evalCode);
                if (typeof result === 'string') {
                    path.replaceWith(t.stringLiteral(result));
                    changes++;
                }
            } catch (e) {
                // 解码失败，保持原样
            }
        }
    },
    
    // === Pass 2: 删除死代码分支 ===
    IfStatement(path) {
        const test = path.node.test;
        
        // if (true) { ... } → 保留 consequent
        if (t.isBooleanLiteral(test) && test.value === true) {
            if (path.node.consequent) {
                path.replaceWithMultiple(
                    t.isBlockStatement(path.node.consequent)
                        ? path.node.consequent.body
                        : [path.node.consequent]
                );
                changes++;
            }
        }
        
        // if (false) { ... } → 移除（或用 alternate）
        if (t.isBooleanLiteral(test) && test.value === false) {
            if (path.node.alternate) {
                path.replaceWithMultiple(
                    t.isBlockStatement(path.node.alternate)
                        ? path.node.alternate.body
                        : [path.node.alternate]
                );
            } else {
                path.remove();
            }
            changes++;
        }
        
        // if (!![]) → true（JSFuck风格）
        if (t.isUnaryExpression(test) && 
            test.operator === '!' &&
            t.isUnaryExpression(test.argument) &&
            test.argument.operator === '!' &&
            t.isArrayExpression(test.argument.argument)) {
            if (path.node.consequent) {
                path.replaceWithMultiple(
                    t.isBlockStatement(path.node.consequent)
                        ? path.node.consequent.body
                        : [path.node.consequent]
                );
                changes++;
            }
        }
    },
});

// === Pass 3: 简化表达式 ===
traverse(ast, {
    BinaryExpression(path) {
        const { left, right, operator } = path.node;
        
        // 字符串拼接: 'a' + 'b' → 'ab'
        if (operator === '+' && t.isStringLiteral(left) && t.isStringLiteral(right)) {
            path.replaceWith(t.stringLiteral(left.value + right.value));
            changes++;
        }
        
        // 数字运算: 0x1a + 0x2b → 数字
        if (['+', '-', '*', '/', '%'].includes(operator) &&
            t.isNumericLiteral(left) && t.isNumericLiteral(right)) {
            const result = eval(`${left.value} ${operator} ${right.value}`);
            path.replaceWith(t.numericLiteral(result));
            changes++;
        }
    },
    
    // !![] → true, ![] → false
    UnaryExpression(path) {
        if (path.node.operator === '!' &&
            t.isUnaryExpression(path.node.argument) &&
            path.node.argument.operator === '!' &&
            t.isArrayExpression(path.node.argument.argument)) {
            path.replaceWith(t.booleanLiteral(true));
            changes++;
        }
        if (path.node.operator === '!' &&
            t.isArrayExpression(path.node.argument)) {
            path.replaceWith(t.booleanLiteral(false));
            changes++;
        }
    },
});

// Step 3: 生成代码
const output = generate(ast, {
    compact: false,
    comments: true,
    retainLines: false,
}).code;

const outputPath = process.argv[3] || process.argv[2].replace('.js', '_deobf.js');
fs.writeFileSync(outputPath, output);
console.log(`[DONE] ${changes} 处修改 → ${outputPath}`);
```

### 4c. 反混淆快速命令

```powershell
# === 纯 Python 方案（零依赖，字符串表解码） ===
python deobfuscate_strings.py input.js output.js

# === Node.js + Babel 方案（AST级反混淆） ===
# 安装依赖（一次性）
npm install @babel/parser @babel/generator @babel/traverse @babel/types
# 运行
node deobfuscate_ast.js input.js output.js

# === 完整流水线（Python解码 + Babel清理） ===
python deobfuscate_strings.py input.js temp.js; node deobfuscate_ast.js temp.js output.js
```

### 4d. JSVMP 字节码反编译（进阶）

当面对完整的 JSVMP 虚拟机保护（如抖音 a_bogus、极验4 w 参数）：

```javascript
// jsvmp_decompiler.js — JSVMP 字节码反编译器框架
// 核心思路：通过插桩记录虚拟机执行的每条指令 → 反汇编 → 还原算法

(function() {
    // === 步骤1: Hook 虚拟机解释器循环 ===
    // 找到 VM 中的 switch/if-else 分发循环
    // 特征: while(true) + switch(opcode) 或 if(opcode === N)
    
    const origEval = eval;  // 有些 VM 用 eval 执行动态生成的代码
    let instructionLog = [];
    
    // === 步骤2: 插桩记录每条指令 ===
    // 在 VM 解释器的每个 case 分支前插入日志
    // 方法: 找到解释器函数 → toString → 正则替换插入 console.log
    
    function instrumentVM(interpreterCode) {
        // 在每个 case 分支前插入日志
        return interpreterCode.replace(
            /case\s+(\d+)\s*:/g,
            (match, opcode) => {
                return `case ${opcode}: console.log('[VM] opcode=${opcode}, stack=', stack.slice(-5)); ${match}`;
            }
        );
    }
    
    // === 步骤3: 反汇编字节码 → Python 代码 ===
    // 将所有字节码指令翻译为等价 Python 代码
    
    const OPCODE_MAP = {
        0: 'PUSH',      // 压栈
        1: 'POP',       // 弹栈
        2: 'ADD',       // 加法
        3: 'SUB',       // 减法
        4: 'MUL',       // 乘法
        5: 'XOR',       // 异或 → 可能是加密操作
        6: 'CALL',      // 函数调用
        7: 'JMP',       // 跳转
        8: 'JMP_IF',    // 条件跳转
        9: 'LOAD_VAR',  // 加载变量
        10: 'STORE_VAR', // 存储变量
        11: 'RET',      // 返回
        // ... 根据具体VM补充
    };
    
    function disassemble(opcodes) {
        const instructions = [];
        let ip = 0;  // instruction pointer
        
        while (ip < opcodes.length) {
            const opcode = opcodes[ip];
            const name = OPCODE_MAP[opcode] || `UNKNOWN_${opcode}`;
            
            let operands = [];
            switch (opcode) {
                case 0:  // PUSH
                    operands = [opcodes[++ip]];
                    break;
                case 6:  // CALL
                    operands = [opcodes[++ip], opcodes[++ip]];  // func_id, arg_count
                    break;
                case 7:  // JMP
                    operands = [opcodes[++ip]];  // target_offset
                    break;
                case 8:  // JMP_IF
                    operands = [opcodes[++ip]];  // target_offset
                    break;
                case 9:  // LOAD_VAR
                case 10: // STORE_VAR
                    operands = [opcodes[++ip]];  // var_index
                    break;
                default:
                    // 单字节指令，无操作数
                    break;
            }
            
            instructions.push({ offset: ip, opcode, name, operands });
            ip++;
        }
        
        return instructions;
    }
    
    // === 步骤4: 转换为 Python ===
    function toPython(instructions) {
        const lines = [];
        const indent = '    ';
        let depth = 0;
        
        for (const inst of instructions) {
            const prefix = indent.repeat(depth);
            
            switch (inst.opcode) {
                case 0:
                    lines.push(`${prefix}stack.append(${inst.operands[0]})`);
                    break;
                case 1:
                    lines.push(`${prefix}stack.pop()`);
                    break;
                case 2:
                    lines.push(`${prefix}b = stack.pop(); a = stack.pop(); stack.append(a + b)`);
                    break;
                case 3:
                    lines.push(`${prefix}b = stack.pop(); a = stack.pop(); stack.append(a - b)`);
                    break;
                case 5:
                    lines.push(`${prefix}b = stack.pop(); a = stack.pop(); stack.append(a ^ b)`);
                    break;
                case 11:
                    lines.push(`${prefix}return stack.pop()`);
                    break;
                default:
                    lines.push(`${prefix}# ${inst.name} ${inst.operands}`);
            }
        }
        
        return 'def vm_execute():\n' + indent + 'stack = []\n' + '\n'.join(lines);
    }
    
    console.log('[JSVMP Decompiler] Ready');
    console.log('[JSVMP Decompiler] Usage: instrumentVM(interpreterCode) → disassemble(opcodes) → toPython(instructions)');
})();
```

### 反混淆流水线决策

```
输入混淆JS
  │
  ├─ 可读性判断
  │   ├─ 只是压缩(minify) → npx js-beautify
  │   ├─ _0x 字符串表混淆 → Python deobfuscate_strings.py
  │   ├─ 控制流平坦化 + 死代码 → Babel AST deobfuscate_ast.js
  │   ├─ webpack/obfuscator.io → npx webcrack（外部工具首选）
  │   └─ JSVMP 虚拟机保护 → jsvmp_decompiler.js 插桩分析
  │
  └─ 输出可读代码 → 继续定位加密逻辑
```
