# config-examples — host 配置选择指南

按 **目标站点的反爬强度** 选配置文件，不要一上来就全装：

| 文件 | 站点类型 | 装的 MCP | 适用场景 |
|---|---|---|---|
| `claude-code.json` (3-MCP) | 中弱反爬 | reverse-skill + js-reverse + camoufox-reverse | 默认起步推荐 |
| `claude-code-full.json` (4-MCP) | 强反爬 | + chrome-devtools | RS / Akamai / CF / DataDome / 抖音 webmssdk |
| `claude-desktop.json` (3-MCP) | 同上 | 同上 | Claude Desktop 用户 |
| `claude-desktop-full.json` (4-MCP) | 同上 | 同上 | Claude Desktop + 强反爬 |
| `cursor.json` | 任意 | 3-MCP | Cursor IDE |
| `cline.json` | 任意 | 3-MCP | Cline 插件 |

## 决策树

```
打开目标站, 看 Network 面板
  ↓
有 412 redirect / sensor_data / cf_turnstile / datadome？
  ├─ YES → claude-code-full.json (4-MCP, camoufox 是 must)
  └─ NO  ↓
        看到 webpack chunk / axios 拦截器 / 标准 sign 头？
          ├─ YES → claude-code.json (3-MCP)
          └─ NO  → claude-code.json 仍可，reverse-skill 单飞即可
```

或者让 skill 自己判断：
```
新会话里直接说: "我要分析 <url>, 帮我看看该用哪个 MCP 套餐"
AI 会调 mcp__reverse-skill__mcp_stack_recommendation, 自动给出 tier 1-4 + 装机命令
```

## 装机命令速查

```bash
# reverse-skill (本仓库, 必装, 不需要装包, 配置文件指向 mcp/server.py 即可)
pip install -r mcp/requirements.txt   # 只装 mcp[cli]>=1.2

# chrome-devtools (npx 自动拉取)
# 配置里写 npx -y chrome-devtools-mcp@latest 即可, 无需预装

# js-reverse (推荐预装一次)
npx js-reverse-mcp --version

# camoufox-reverse (强反爬站必装)
pip install camoufox-reverse-mcp
python -m camoufox fetch              # ~150MB 浏览器二进制, 一次性
# 验证:
python -c "import camoufox_reverse_mcp; print('OK')"
```

也可以让 skill 帮你算：
```
新会话: 帮我装 camoufox-reverse-mcp
AI 会调 mcp__reverse-skill__camoufox_install_helper(host='claude-code')
拿到 install_steps + host_config_snippet 直接给你贴
```

## 重启 host

新增 / 改动 MCP 配置后**必须重启 host**（Claude Code 用 `claude --restart`；Claude Desktop 退出再开；Cursor / Cline 重载插件）。Skill 是文件系统的，不需要重启。
