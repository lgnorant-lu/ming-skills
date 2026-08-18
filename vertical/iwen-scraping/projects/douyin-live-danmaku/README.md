# 抖音直播弹幕抓取

实时捕获抖音直播间弹幕评论，基于 DOM MutationObserver。

## 用法

1. 修改 `url` 为直播间地址
2. `python douyin_live_danmaku.py`
3. 弹幕自动保存到 `抖音弹幕.txt`

## 技术点

- DrissionPage 接管浏览器，天然通过抖音环境检测
- MutationObserver 监听 `.webcast-chatroom___list` 的 DOM 变化
- 实时过滤系统消息、空内容，只保留真实弹幕
- loguru 输出到文件，支持日志轮转
