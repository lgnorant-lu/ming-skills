# 常见案例模式

本文件用于识别补环境任务中的常见形态，只作为分析提示，不替代证据。

## Header 签名型

信号：目标参数在 Header 中，例如 `x-sign`、`x-s`、`x-token`。

重点：

- `setRequestHeader` 或 fetch init.headers 是 writer。
- builder 常在 request interceptor 或 SDK request wrapper。
- source 往往包含 URL、Body、时间戳、Cookie、设备标识。

## Query 混淆参数型

信号：目标参数在 URL Query 中，例如 `sign`、`a_bogus`。

重点：

- Hook `URLSearchParams.append/set` 与 XHR/fetch URL。
- 注意 Query 排序、编码方式、空值和数组序列化。
- 常依赖 UA、Referer、时间和随机数。

## Body 签名型

信号：目标参数在 JSON 或表单 Body 中。

重点：

- 保留原始 Body 字符串，避免 JSON 重新序列化造成差异。
- 比对 Content-Type 与空格、顺序、转义。
- Hook `JSON.stringify` 可辅助定位 builder。

## SDK 初始化型

信号：入口函数找到了但直接调用失败，或必须先执行 init。

重点：

- 查 `init`、`config`、`setConfig`、`install`、`use`、`start`。
- 记录全局配置、meta 标签、script 标签参数。
- 先补初始化链，再补环境对象。

## 异步消息型

信号：签名结果通过 Promise、回调、Worker message 返回。

重点：

- 记录消息类型和 payload。
- 区分初始化消息与签名请求消息。
- 用 fixtures 验证最终异步输出。
