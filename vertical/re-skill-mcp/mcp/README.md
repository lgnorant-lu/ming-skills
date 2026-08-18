# reverse-engineering-skill MCP server

零依赖单文件 MCP server，跟 SKILL.md 同仓发布。

## 工具一览（6 个）

| 工具 | 用途 |
|---|---|
| `checklist_render`   | 渲染启动 Checklist（强制 Phase 0 仪式） |
| `signatures_list`    | 列出 22 个内置签名指纹（可按 category 过滤） |
| `signatures_scan`    | 对 JS/HTML 文本做正则签名匹配，返回命中样本 |
| `hook_templates`     | 列出 12 个 hook 模板及其用途 |
| `hook_render`        | 渲染 hook 模板（`{KEY}` 占位替换）→ 可贴 DevTools 的 IIFE |
| `case_template`      | 返回 case 库 markdown 模板 |

## 启动

```bash
pip install -r requirements.txt
python server.py        # stdio mode，由 MCP host 拉起
```

## 在 Claude Code 里挂

`~/.claude.json` 的 `mcpServers` 加：

```json
{
  "mcpServers": {
    "reverse-engineering-skill": {
      "command": "python",
      "args": ["/绝对路径/reverse-engineering-skill/mcp/server.py"]
    }
  }
}
```

之后工具名变成 `mcp__reverse-engineering-skill__checklist_render` 等。

## 设计取舍

- **零数据库**：22 签名 + 12 hook 模板都内联进 `server.py`，clone 即用，不需要 init。
- **不重复造轮子**：Chrome 断点、Camoufox 反指纹、JSVMP 插桩这些由 `js-reverse-mcp` 和 `camoufox-reverse-mcp` 负责，本 server 只补"方法论 + 静态指纹 + 模板生成"这层。
- **依赖只有 mcp SDK**：用官方 FastMCP，纯 Python 3.10+。
