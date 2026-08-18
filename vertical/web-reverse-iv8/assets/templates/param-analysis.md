# 参数分析报告模板

> 阶段一(HAR 分析)输出。按本模板填写后**写入 `./<task-name>/stage1-params.md`**,作为后续阶段的输入(详见 [SKILL.md](../../SKILL.md) "产物持久化"小节)。

## 接口信息
- 接口 URL:
- 请求方法:
- 接口用途:

## 样本清单
| 样本 | 采集时间 | 用户 | 业务参数 | 来源 |
|------|----------|------|----------|------|
| 1    |          |      |          | HAR  |
| 2    |          |      |          | HAR  |

## 参数溯源表
| 参数名 | 位置 | 类型 | 来源 | 上游接口/加密点 | 依赖输入 | 终止 | 备注 |
|--------|------|------|------|-----------------|----------|------|------|
| token  | body | JS生成 | encrypt(uid,ts) | gcaptcha4.js#m31 | uid,ts | ✓JS  |      |
| sign   | body | 接口透传 | /api/getSign | /api/getSign | uid | | 需追溯 |
| devId  | body | 固定常量 | 前端硬编码 | — | — | ✓固定 |      |

## 透传链路图
```
token(JS生成) ← 无上游
sign(透传) ← /api/getSign
  └─ /api/getSign 的参数: uid(透传←/api/login)、ts(JS生成←Date.now)
     └─ /api/login 的参数: user(用户输入)、pwd(JS生成←encryptPwd)
        └─ encryptPwd: JS生成,无上游 → 终止
```

## 加密参数清单(待定位)
| 参数 | 加密函数 | 文件 | 模块 | 输入 | 状态 |
|------|----------|------|------|------|------|
| token | encrypt | gcaptcha4.js | m31 | uid,ts | 待定位 |
| pwd | encryptPwd | login.js | 全局 | user,pwd | 待定位 |

## 环形依赖检查
(如有环依赖在此标注,说明处理方式)

## 结论
- 待逆向参数:N 个
- 透传接口:M 个(需逐一打通)
- 固定常量:K 个(直接硬编码)
