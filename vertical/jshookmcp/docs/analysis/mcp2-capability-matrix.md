# MCP 2.0 能力盘点与迁移矩阵

更新时间：2026-08-30

本文记录当前仓库对 MCP TypeScript SDK v2 的实际使用情况。

“已支持”仅表示代码路径和测试已经存在；“可试点”表示协议能力具备，但还没有在生产工具面上启用。

## 当前边界

- 旧 `/mcp` 保持 sessionful `MultiplexedStreamableHttpTransport`，不改变既有客户端行为。
- 新 `/mcp/v2` 使用 SDK v2 `createMcpHandler`，并以 `legacy: 'reject'` 拒绝 legacy 请求。
- modern 请求创建独立的 `McpServer`，业务 runtime、domain 实例和执行管理器仍由进程级 `MCPServer` 持有。
- HTML Canvas、WebGPU 等浏览器能力属于 domain 工具实现，不属于 MCP 2.0 协议层，本次不迁移。

## 能力矩阵

| 能力 | 当前状态 | 对 JSHookMCP 的价值 | 主要风险 | 建议 |
| --- | --- | --- | --- | --- |
| modern Streamable HTTP | 已完成。`/mcp/v2` 为 modern-only，按请求隔离 SDK server | 为新客户端提供无 legacy 兼容负担的协议入口 | 共享 domain/context 仍可能串请求 | 继续用并补充并发回归测试 |
| Tool annotations | builder 已生成 `readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint`；现已透传到 SDK 注册配置 | 客户端可据此决定确认、重试和联网提示 | 旧工具默认值不一定反映真实副作用 | 以 `query/readOnly/destructive/openWorld` 为单位逐步校准 |
| `structuredContent` | `ResponseBuilder.structured()` 已可生成结构化 payload，并保留 text fallback | 客户端无需解析 JSON 文本，适合分析摘要、任务状态和证据图 | payload 结构不稳定时会增加兼容成本 | 先选 3-5 个稳定结果工具试点 |
| `outputSchema` | builder 支持；现已透传为 SDK `fromJsonSchema` schema；生产工具尚未声明具体输出 schema | 让客户端在调用后校验并安全消费字段 | 错误 schema 会导致调用结果校验失败 | 与 structuredContent 同步，小范围启用 |
| Tasks | 项目已有 `TaskManager`、`tasks_get/result/list/cancel` 和若干 `async: true` 工具；builder 只声明 `taskSupport: optional` | 适合 Frida 扫描、pcap/trace、heap/profile 等长任务 | SDK v2 的 Tasks 属扩展轨道，不能假设会自动接管现有 TaskManager | 先确认 SDK 官方 task store/执行扩展点，再做一个端到端试点 |
| `subscriptions/listen` | SDK v2 支持；项目 EventBus 尚未接入 SDK `ServerEventBus` | 可推送任务状态、证据图和 registry 变化，减少轮询 | 多连接生命周期、事件权限和泄漏 | 先做只读 task/evidence 事件，不暴露 legacy session state |
| response mode | `createMcpHandler` 使用默认 `auto` | 短请求可 JSON，流式进度可 SSE | 不同客户端对 SSE/JSON 支持不一致 | 保持 `auto`，用真实客户端覆盖 JSON/SSE 行为后再细化 |
| `McpRequestContext` / `authInfo` | 当前 adapter 只消费 `era`，认证仍走项目自有 `checkAuth` | 可提供 principal、租户和审计上下文 | 敏感认证信息写入日志或任务结果 | 先只接审计 correlation id，不替换现有认证链 |
| Sampling | `LLMSamplingBridge` 已存在 | 允许工具请求宿主 LLM 做解释或命名 | 成本、提示注入和数据外发 | 保持显式 opt-in，沿用现有桥接和权限控制 |
| Elicitation | `ElicitationBridge` 支持 form/url | 适合验证码人工接管、危险操作确认 | 阻塞、超时和用户输入信任边界 | 继续用于需要人工确认的流程 |
| Progress / logging | EventBus、progress notification、`McpLogTransport` 已存在 | 为长任务和调试提供可观测性 | 高频通知造成带宽和日志噪声 | 与 Tasks/订阅试点绑定，设置节流 |
| Resources / prompts / completions | 资源、提示和自定义 completion handler 已注册 | 提供上下文、模板和参数补全 | 自定义 completion 与 SDK `completable()` 双轨维护 | 后续评估兼容层，暂不替换现有 handler |
| SDK auth helpers | SDK 暴露 bearer auth helpers；项目已有自定义认证 | 可统一 modern 认证错误和上下文 | 影响 legacy 客户端及部署配置 | 仅在 modern 路由单独评估，不直接替换 legacy |

## 优先级与验收标准

### P0：已落地

1. modern 请求级 `McpServer` 隔离和 body size 限制。
2. annotations、`structuredContent`、`outputSchema` 的注册链路可用且有单元测试。
3. legacy `/mcp` 行为保持不变。

### P1：下一步试点

1. 为任务状态、证据图摘要和工具搜索结果定义稳定 output schema，并让 handler 返回 `structuredContent`。
2. 接入只读 `ServerEventBus` 事件，明确订阅取消、连接关闭和事件过滤规则。
3. 选一个长任务验证 SDK Tasks 扩展点；若 SDK 无法注入现有 TaskManager，则继续使用显式 `tasks_*` 兼容面，不做伪原生接入。

### P2：后续评估

- 将现有 autocomplete handler 映射到 SDK `completable()` schema。
- 将 `authInfo` 转换为不含秘密的审计上下文。
- 根据客户端兼容性数据细化 response mode 和 SSE 事件策略。

## 明确不做

- 不把 HTML Canvas、WebGPU、截图渲染等浏览器 domain 能力塞进 MCP 协议层。
- 不为了“支持 MCP 2.0”给全部工具机械添加 output schema；schema 必须与真实 payload 和回归测试同步。
- 不在 SDK Tasks 扩展点未确认前移除现有 `TaskManager` 或改变 legacy 任务协议。
