# ai-reverse-toolkit

AI-assisted skills, rules and prompts for reverse engineering.

Covers **Web/JS**, **Android/iOS App**, and more.

Works with Claude Code, and other AI coding tools.

## What is this?

一套将逆向工程经验编码为 AI 可执行指令的工具集。不是"让 AI 帮你写代码"，而是**让 AI 成为独立的逆向分析员**——它能自己判断该搜什么、断在哪、怎么追踪、怎么补环境。

核心思路：**工具解决"怎么做"，经验解决"做什么"。** MCP 工具给 AI 一双手，Skill 给 AI 一个脑子。

## Structure

```
ai-reverse-toolkit/
├── skills/                        # 任务导向的技能
│   ├── find-crypto-entry/         # 定位加密入口（静态搜索 + 动态断点）
│   ├── env-patch/                 # 补环境方案（Proxy 监控 + webpack 提取）
│   │   └── scripts/               # 模板脚本（proxy_monitor.js, webpack_runtime.js）
│   ├── ast-deobfuscate/           # AST 解混淆（Babel 还原）
│   └── skill-creator/             # 创建和优化 Skill
├── rules/                         # 背景知识和流程参考
│   └── js-reverse.md              # JS 逆向技术手册
└── CLAUDE.md                      # 项目规范（目录结构、文档驱动等）
```

## Usage

### For Claude Code

Copy to your project's `.claude/` directory:

```bash
cp -r skills/* your-project/.claude/skills/
cp -r rules/* your-project/.claude/rules/
```

Then use skills as slash commands in Claude Code:

```
> /find-crypto-entry x-sign        # 定位加密入口
> /env-patch                        # 补环境
> /ast-deobfuscate                  # AST 解混淆
```

### For Other AI Tools

Use the markdown files directly as system prompts or context.

## Skills

| Skill | Description | Input | Output |
|-------|-------------|-------|--------|
| `find-crypto-entry` | 定位加密参数的生成入口 | 参数名（如 `x-sign`） | 脚本 URL + 函数位置 + 调用链 + 加密类型 |
| `env-patch` | 补环境方案：提取模块 + Proxy 监控 + 封装接口 | 已知的加密入口信息 | 可独立运行的 `sign.js` 签名接口 |
| `ast-deobfuscate` | AST 解混淆：字符串还原、控制流还原等 | 混淆的 JS 文件 | 可读的 JS 文件 |
| `skill-creator` | 创建、评测、优化 Skill | Skill 需求描述 | 完整的 Skill 文件 |

## Rules

| Rule | Description |
|------|-------------|
| `js-reverse.md` | JS 逆向分析技术手册：6 阶段流程、混淆/算法识别表、MCP 工具速查、高级场景（VM/WASM） |

## Demo Video

> **AI 全链路逆向知乎 x-zse-96 签名**（15 分钟，3 条指令）

[▶ 观看完整录屏](https://github.com/zhizhuodemao/ai-reverse-toolkit/releases/download/video/demo-zhihu-x-zse-96.mov)

## Example: Zhihu x-zse-96

3 条指令，15 分钟，全自动完成知乎签名逆向：

```
指令 1: "找到推荐接口的 x-zse-96 签名参数"
  → AI 打开页面、抓包、找到目标请求

指令 2: "/find-crypto-entry x-zse-96"
  → AI 静态搜索定位 + XHR 断点验证，找到签名入口
  → 发现 SM4 + JSVMP 保护，建议补环境

指令 3: "/env-patch"
  → AI 从 4MB bundle 提取 30 个模块（57KB）
  → Proxy 监控首次运行 0 error，只补 1 行 window.name
  → Python 验证：200 + 12 篇推荐文章
```

## Dependencies

- [js-reverse MCP server](https://github.com/anthropics/anthropic-cookbook) — Chrome DevTools automation via MCP (required for `find-crypto-entry`)
- [Claude Code](https://claude.ai/code) — Recommended AI coding tool

## Roadmap

- [ ] WASM reverse engineering skill (Ghidra MCP integration)
- [ ] App reverse engineering skills (Frida, IDA)
- [ ] Protocol analysis rules
- [ ] More real-world examples

## License

MIT
