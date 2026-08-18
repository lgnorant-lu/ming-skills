# Frida 魔改参考：特征点与修改位置

本文档列出 Frida 的常见检测特征及其在源码中的位置，便于系统化魔改。

## 1. 核心常量与字符串

### frida-core/lib/base/

源文件为 Vala，编译后生成 `frida-base.h`。需在 Vala 源中修改：

| 宏/常量 | 当前值 | 检测用途 | 修改位置 |
|---------|--------|----------|----------|
| `FRIDA_SERVER_GUID_HOST_SESSION_SERVICE` | `"6769746875622e636f6d2f6672696461"` | D-Bus GUID（hex 解码为 "github.com/frida"） | lib/base/session.vala ServerGuid → rusda |
| `FRIDA_OBJECT_PATH_HOST_SESSION` | `"/re/frida/HostSession"` | D-Bus 对象路径 | lib/base/session.vala ObjectPath → /re/rusda/ |
| `FRIDA_OBJECT_PATH_AGENT_SESSION` | `"/re/frida/AgentSession"` | D-Bus 对象路径 | lib/base/*.vala |
| `FRIDA_OBJECT_PATH_GADGET_SESSION` | `"/re/frida/GadgetSession"` | Gadget D-Bus 路径 | lib/base/*.vala |
| 其他 `/re/frida/*` 路径 | 见 frida-base.h | D-Bus 服务发现 | lib/base/*.vala |
| `FRIDA_DEFAULT_CONTROL_PORT` | 27042 | 默认控制端口 | lib/base/*.vala |
| `FRIDA_DEFAULT_CLUSTER_PORT` | 27052 | 集群端口 | lib/base/*.vala |

**说明**：`frida-base.h` 由 Vala 编译器生成，修改 Vala 源后重新编译即可更新。

---

## 2. 二进制与库名

| 目标 | 默认名 | 输出路径 | 定义位置 |
|------|--------|----------|----------|
| Server | frida-server | bin/frida-server | frida-core/server/meson.build |
| Inject | frida-inject | bin/frida-inject | frida-core/inject/meson.build |
| Gadget | frida-gadget.so | lib/frida/32/, lib/frida/64/ | frida-core/compat/arch-support/meson.build |
| Agent | frida-agent.so | 内嵌 payload | frida-core/lib/agent/ |

修改：在各 subproject 的 meson.build 中搜索 `frida-server`、`frida-inject`、`frida-gadget` 并替换。

---

## 3. 符号与导出前缀

**releng/devkit.py** 第 372 行：

```python
frida_prefixes = ["frida", "_frida", "gum", "_gum"]
```

用于区分 Frida 自身符号与第三方符号。若将品牌名改为 `rusda`，需同步修改为：

```python
frida_prefixes = ["rusda", "_rusda", "gum", "_gum"]
```

若同时魔改 gum 品牌，可改为：

```python
frida_prefixes = ["rusda", "_rusda", "rusgum", "_rusgum"]
```

---

## 4. 常见检测手段及对应修改

| 检测方式 | 检测内容 | 魔改方向 |
|----------|----------|----------|
| 字符串扫描 | 二进制/so 中的 "frida"、"gum"、"gadget" | 全局替换品牌名 |
| 端口扫描 | 27042、27052 | 修改 FRIDA_DEFAULT_*_PORT |
| D-Bus 探测 | /re/frida/* 对象路径 | 修改 FRIDA_OBJECT_PATH_* |
| 库名检测 | libfrida-gadget.so、frida-agent | 修改 meson target 名称 |
| 内存模式 | 特征内存布局 | 需深入分析并调整数据结构/对齐 |
| 线程名检测 | /proc/pid/task/*/comm 中 gum-js-loop、gmain、gdbus、frida-gadget | topatch.py sed 替换，gadget.vala 源码 |
| HTTP 头检测 | User-Agent: Frida/、Server: Frida/、HTML 中 Frida/ | lib/base/socket.vala L166、L580、L797 |
| RPC 协议 | frida:rpc 内存扫描 | lib/base/rpc.vala L20、L73、L102 → rusda:rpc |
| 路径检测 | /data/local/tmp/frida-*、/usr/lib/frida/、memfd:frida-agent | injector.vala、linux.vala jit-cache |

---

## 5. 典型魔改示例：品牌替换

以 `frida` → `rusda` 为例：

1. **subprojects/frida-core**：
   - 在 Vala 源中替换 `/re/frida/` → `/re/rusda/`
   - 替换 `FRIDA_` 前缀为 `RUSDA_`（需在 Vala 命名空间中修改）
   - 修改端口常量（可选）

2. **releng/devkit.py**：
   - `frida_prefixes` 加入 `rusda`、`_rusda`

3. **meson.build / meson.options**：
   - `frida-server` → `rusda-server`
   - `frida-inject` → `rusda-inject`
   - `frida-gadget` → `rusda-gadget`

4. **tools/build-android-all.sh**（若存在）：
   - 输出名 `rusda-server-*.xz` 等已按新品牌命名

**注意**：Vala 命名空间和类型名（如 `FridaHostSession`）改动较多，可只改字符串和二进制名，以降低工作量。

---

## 6. 子项目职责

| 子项目 | 职责 | 关键目录 |
|--------|------|----------|
| frida-gum | 注入、汇编、V8/QuickJS 绑定 | gum/, lib/gumjs/ |
| frida-core | Server、Gadget、Inject、Host 逻辑 | server/, lib/, inject/, compat/ |
| frida-tools | CLI 工具 | frida-tools/ |
| releng | 构建、依赖、prebuild | deps.toml, meson_configure.py, devkit.py |

---

## 7. 构建与环境

- **configure**：`./configure --host=android-arm64 --enable-server --enable-gadget --enable-inject`
- **NDK**：需设置 `ANDROID_NDK_ROOT`
- **submodules**：`git submodule update --init` 或 `python tools/ensure-submodules.py`

---

## 8. 扩展特征点（参考 ajeossida、Florida、rusda 等）

| 特征 | 检测方式 | 修改位置 |
|------|----------|----------|
| `gum-js-loop` | 线程名 /proc/pid/task/*/comm | topatch.py → russellloop |
| `gmain`、`gdbus` | GLib/GDBus 默认线程名 | topatch.py → rmain、rubus |
| `frida-gadget`、`frida-gadget-tcp-*`、`frida-gadget-unix` | gadget 线程名 | lib/gadget/gadget-glue.c、gadget.vala + topatch |
| `pool-frida`、`pool-spawner` | iOS GLib 线程池 | 需查 GLib 源码 |
| `libfrida-agent-raw.so` | 链接器 so 列表 | lib/agent meson.build（可选） |
| `memfd:frida-agent-64.so` | /proc/pid/maps | lib/base/linux.vala memfd 名称 → jit-cache |
| exit/abort/task_threads hooking | libc 函数 hook 检测 | lib/payload/libc-shim.c 等（高级） |
| `_frida.abi3.so` | frida-tools Python 扩展 | Fridare 可 patch frida-tools |
| `frida:rpc` | RPC 协议内存扫描 | rpc.vala → rusda:rpc |
| `frida-error-quark` | GError 域 | xpc.vala → rusda-error-quark |
| `6769746875622e636f6d2f6672696461` | hex github.com/frida | session.vala ServerGuid |
| X509 O="Frida" | 证书组织名 | p2p-glue.c |

**扫描工具**：`python tools/scan-frida-signatures.py` 生成 `doc/frida-signatures.csv`。支持 `--source-dir`、`--binary-dir`、`--output`、`--skip-source`、`--skip-binary`。
