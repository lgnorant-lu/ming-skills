# reverse-engineering-skill

> 端到端 JS 逆向 Claude Code Skill —— 自带 MCP server，方法论 + 22 签名 + 12 hook 模板内置开箱可用。

兼容 Claude Code / Claude Desktop / Cursor / Cline 任何支持 MCP + Skill 的 host。

> ⚠️ 仅用于**已获授权**的研究与测试场景。

---

## 这个仓库提供什么

```
reverse-engineering-skill/
├── SKILL.md                # 24KB 主方法论（Checklist + 4 红线 + 22 经验法则 + 5 Phase 工作流）
├── cases/                  # 案例库模板（你自己的踩坑记录）
├── config-examples/        # 四个 host 的 MCP 配置样板
└── mcp/                    # 自带的 6 工具 MCP server（Python 单文件）
    ├── server.py
    ├── requirements.txt
    └── README.md
```

工具 / 角色分工：

| 层 | 谁来做 |
|---|---|
| **方法论守护**（Checklist / 红线 / 三分法 / 决策树） | `SKILL.md`（host 自动加载） |
| **静态分析 + 模板**（22 签名 / 12 hook 模板 / case 模板） | **本仓库的 `mcp/server.py`** |
| **Chrome 断点 / 单步 / WS** | 可选挂 [`js-reverse-mcp`](https://github.com/zhizhuodemao/js-reverse-mcp) |
| **Camoufox 反指纹 / JSVMP 插桩** | 可选挂 [`camoufox-reverse-mcp`](https://github.com/WhiteNightShadow/camoufox-reverse-mcp) |

只装本仓库就能跑静态分析阶段；要做动态调试就再挂另外两家。

---

## 三步装好

### 1. clone

```bash
git clone https://github.com/ZhuSheng-0807/reverse-engineering-skill.git
cd reverse-engineering-skill
```

### 2. 装 skill

**macOS / Linux**

```bash
cp -r . ~/.claude/skills/reverse-engineering
```

**Windows PowerShell**

```powershell
Copy-Item -Recurse . $HOME\.claude\skills\reverse-engineering
```

> 复制时**整个仓库目录**搬过去（包含 SKILL.md + cases/ + mcp/），host 会自动按 `SKILL.md` frontmatter 注册 skill。

### 3. 装 MCP server

```bash
pip install -r mcp/requirements.txt
```

`~/.claude.json` 的 `mcpServers` 加一段（把路径改成你机器的实际绝对路径）：

```jsonc
{
  "mcpServers": {
    "reverse-skill": {
      "type": "stdio",
      "command": "python",
      "args": ["/absolute/path/to/reverse-engineering-skill/mcp/server.py"]
    }
  }
}
```

四种 host 的完整配置见 [`config-examples/`](./config-examples/)。

重启 host → 新会话里说"帮我分析 xxx 站的 sign"，skill 自动激活。

---

## 验证装好了

新会话里输入：

> 帮我看看 X-Bogus 怎么生成的

AI 应当：

1. 复述 SKILL.md Checklist 四项
2. 调 `mcp__reverse-skill__checklist_render`
3. 调 `mcp__reverse-skill__signatures_list` 或 `signatures_scan`
4. 询问目标 URL / JS 源
5. 进入 Phase 0–5 工作流
6. 最后调 `mcp__reverse-skill__case_template` 把过程写进 `cases/`

---

## 可选：挂另两家 MCP

想做 Chrome 断点 / JSVMP 插桩，把另两家也挂上：

```jsonc
{
  "mcpServers": {
    "reverse-skill":     {"command": "python", "args": ["/abs/path/mcp/server.py"]},
    "js-reverse":        {"command": "npx",    "args": ["js-reverse-mcp"]},
    "camoufox-reverse":  {"command": "python", "args": ["-m", "camoufox_reverse_mcp", "--headless"]}
  }
}
```

需要先 `npx js-reverse-mcp --version` 和 `pip install camoufox-reverse-mcp` 安装对应包。

---

## 想看 SKILL 的方法论核心

直接读 [`SKILL.md`](./SKILL.md)。要点：

- **硬约束 Checklist** — 启动必复述，跳过即违规
- **4 条红线** — 浏览器最终方案/硬编码 cookie 等死法
- **22 经验法则** — 实战沉淀
- **反爬三分法** — 签名型 / 行为型 / 纯混淆 三类先判型
- **JSVMP 路径 A vs B 决策树**
- **5 Phase 工作流** — 调试环境 → 侦察 → 源码 → 验证 → 还原 → 交付

## License

MIT
