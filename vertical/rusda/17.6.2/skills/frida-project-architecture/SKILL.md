---
name: frida-project-architecture
description: Frida 单仓结构、交付补丁顺序、Android/通用编译排障、topatch 与典型魔改清单；依据 patch 与本节内嵌要点回答「改了什么」。勿依赖 doc/ 下备份文档。
---

# Frida 项目架构与魔改指南

## Agent 使用顺序（拿到 patch 或本仓库时）

1. **基线与步骤**：以 `patches/deliver/README.txt` 中的 **Frida 基线 commit** 与 **superrepo → releng → frida-core → frida-gum** 顺序为准。
2. **回答「改了什么」**：对各个 `.patch` 用 `git apply --stat`、`git apply --check`（或 `patch -p1 --dry-run`）列出触及文件；再结合下文 **「典型改动清单」**、**「topatch 映射」**、**「故意保留 / 未改项」** 向用户解释意图；必要时直接读 patch 内 hunk。
3. **帮用户编译**：按「编译与排障」；Android 全架构优先 `./tools/build-android-all.sh`（若补丁已带该脚本）。

## 项目结构概览

```
frida/
├── meson.build, meson.options, configure
├── releng/                     # submodule：meson、deps、devkit.py
├── subprojects/
│   ├── frida-gum
│   └── frida-core             # server、gadget、inject、topatch、post-process
├── patches/deliver/           # README.txt + *.patch
└── tools/
    ├── ensure-submodules.py
    ├── build-android-all.sh
    └── verify-patch.py        # 构建后抽检（若存在）
```

## 交付补丁：应用顺序与排障

（细则仍以 `patches/deliver/README.txt` 为准。）

1. 检出 README 写明的 **基线 commit**。
2. `git submodule update --init --recursive`
3. 仓库根：`git apply patches/deliver/superrepo.patch`
4. **releng**：若补丁固定 releng 的 commit，`cd releng && git fetch … && git checkout <commit>`，回根目录后视情况再 `submodule update`。
5. `cd subprojects/frida-core && git apply ../../patches/deliver/frida-core.patch`
6. `cd subprojects/frida-gum && git apply ../../patches/deliver/frida-gum.patch`

**常见失败**：应用目录错误、strip 层级不对、子模块未对齐官方提交。对齐基线后再 apply。

## 典型改动清单（rusda 品牌交付线，便于口述）

路径相对于 **`subprojects/frida-core`** 或 **`subprojects/frida-gum`**，除非另行注明。

### frida-core 源码（示例）

| 区域 | 典型改动 | 目的 |
|------|----------|------|
| `src/agent-container.vala` | `frida_agent_main` → `main` | 弱化符号扫描 |
| `src/*-host-session.vala`（linux/darwin/windows/freebsd/qnx） | agent 入口与命名一致为 `main`、资源名 `rusda-agent-*` 等 | 跨平台一致、资源名特征 |
| `server/server.vala` | `re.frida.server` → `re.rusda.server` | 包名 / 标识 |
| `src/frida-glue.c` | `g_set_prgname("russell")`、`rusda-main-loop` 等 | 进程名 / 主线程名 |
| `src/droidy/droidy-client.vala` | `Unexpected command` → `break`（按线） | adb 协议路径上减少异常触发 |
| `lib/base/linux.vala` | memfd 名 **`jit-cache`**（非 `memfd:frida-agent-*`） | `/proc/*/fd` 特征 |

**注意**：17.6.x 线 memfd 逻辑在 `lib/base/linux.vala`，不要到老版本的 helper-backend 里找。

### frida-gum 源码（示例）

| 文件 | 典型改动 |
|------|----------|
| `gum/gum.c` | `g_set_prgname("russell")` 与 core glue 对齐 |
| `tests/core/mapper.c` | `frida_agent_main` → `main`（测试跟上游符号一致） |

### 构建与安装命名

| 位置 | 典型改动 |
|------|----------|
| `frida-core/meson.build` | `helper_name` / `agent_name` / `gadget_name` → `rusda-*`，`root_asset_dir` → `rusda` |
| `frida-core/server/meson.build` | `rusda-server`，post_process 侧标识如 `re.rusda.Server` |
| `frida-core/inject/meson.build` | `rusda-inject`，`re.rusda.Inject` |
| `frida-core/compat/build.py` | `*_FILE_*` / `SERVER_FILE_UNIX` 指向 **磁盘上的 rusda 路径**；`**_TARGET` 仍为 `frida-*`**（ninja 目标名不变）；模拟 agent 输出如 `rusda-agent-arm.so` |
| `releng/devkit.py` | `frida_prefixes` 增加品牌名如 `rusda`、`_rusda` |
| 仓库根 `tools/build-android-all.sh` | staging / 打包路径对齐 `rusda-*`、`lib/rusda/` |

### embed-agent（17.6.x）

- 使用 **`tools/embed-agent.py`**（非旧版 shell）。
- 在 Linux/Android 分支里 **`shutil.copy(agent, embedded_agent)` 之后** 调用 **`src/topatch.py`**，再交给 resource 编译；**仅非空 agent** 调 topatch。

### 分层策略（回答用户时可用）

1. **源码层**：字符串、包名、路径、memfd 等。
2. **构建层**：meson 输出名、`compat/build.py` 路径。
3. **二进制层**：链接后 **post-process → topatch.py**（lief + sed）。

**目标名 vs 输出名**：meson **target id**（如 `frida-helper`）保持给 ninja；**磁盘文件名**由 `helper_name` 等变量与 `*_FILE_*` 决定。

## topatch.py：链接后修补（概要）

由 **`subprojects/frida-core/tools/post-process.py`** 在制品上调用 **`subprojects/frida-core/src/topatch.py`**（具体参数以脚本为准）。

| 类别 | 原始 → 结果（示例线） | 手段 |
|------|------------------------|------|
| 符号 | `frida_agent_main` → `main`；符号里的 `frida` → `rusda` | lief |
| .rodata | `FridaScriptEngine` → `enignEtpircSadirF`；`GLib-GIO` → `OIG-biLG`；`GDBusProxy` → `yxorPsuBDG`；`GumScript` → `tpircSmuG` | 等长反转 |
| 全文替换 | `gum-js-loop` → `russellloop`；`gmain` → `rmain`；`gdbus` → `rubus` | sed |

若用户问「二进制里为什么看不到某 GObject 类型名」：可能是 **被反转成无意义字节串**，应用 `strings` / 验证脚本对照期望值。

## 故意保留、未改或高风险区（回答「为什么还有 frida 字样」）

- **协议互操作性**：标准 Frida **客户端**仍依赖的 D-Bus 路径 / 接口字面量（如 `re.frida.*`、`Frida.*` 接口名）、RPC 标识等，**不能随便批量改**；部分已在 Vala 里用运行时解码等方式处理，JS/worker 里仍可能有字面量。
- **只做 meson 改名的**：可执行文件 / `.so` 显示名为 `rusda-*`，但 **server 体内** 仍可能有 `FridaDeviceManager`、`FridaHostSession`、错误文案里的 `frida-server` 等 **类型名或英语信息**——扩展 topatch 需防破坏协议。
- **常见未改检测面**（魔改「程度」取决于你的 patch）：默认端口 **27042 / 27052**、`/data/local/tmp/frida-`、部分 **pool-frida** 线程池名、`libfrida-agent-raw` 等——是否在补丁里处理以 **实际 patch** 为准。

## 构建后验证

若仓库含 **`tools/verify-patch.py`**，构建完成后可：

```bash
python tools/verify-patch.py
# 或
python tools/verify-patch.py /path/to/dist-android
```

典型检查：**不应再出现** `FridaScriptEngine`、`GLib-GIO`、`GDBusProxy`、`GumScript`、`gum-js-loop`、`gmain`、`gdbus`；**应出现** 对应的反转串与 `russellloop`、`rmain`、`rubus`。支持顶层 `.xz`、未压缩 bin、staging 目录。

## 构建流程（通用）

1. `python tools/ensure-submodules.py` 或 `git submodule update --init --recursive`
2. `./configure --host=android-arm64 --enable-server --enable-gadget --enable-inject`
3. `make -j$(nproc)` 或 `ninja -C build`

选项见 `meson.options`。

## 编译与排障（Android 交付线）

- **`ANDROID_NDK_ROOT`**：必须设置；交付说明常用 **NDK r25**（以 `patches/deliver/README.txt` 为准）。
- **`pip install lief`**：post-process 调 topatch 时依赖。
- **多架构勿并行 configure**：并行解压/写 deps 易导致 SDK 不完整；`build-android-all.sh` 对 **x86 / x86_64 / arm / arm64 串行** `configure && make && install`。
- **产物**：常见为 **`dist-android/`** 下 `rusda-server` / `rusda-inject` / `rusda-gadget` 的 `.xz`（以脚本内版本号与路径为准）。
- **单架构调试**：只跑一轮单 host 的 configure + make。

## 特征速查（与补丁/工具叠加理解）

| 特征类型 | 示例 | 常见处理 |
|----------|------|----------|
| HTTP 头 | `User-Agent: Frida/`、`Server: Frida/` | 常见在 `socket.vala` 改为品牌前缀 |
| RPC | `frida:rpc` | 源码或 topatch 多层，以 patch 为准 |
| D-Bus 路径 | `re.frida.*`、`6769…6672696461`（hex 解码为 github.com/frida） | `session.vala` 等 + topatch |
| 线程名 | `frida-gadget`、`frida-gadget-tcp-`、证书线程等 | gadget / p2p 等源码 + topatch |
| 路径 / memfd | `/data/local/tmp/frida-`、`memfd:frida-agent` | injector / linux.vala / meson |
| 二进制名 | `frida-server`、`frida-inject`、`frida-gadget.so` | meson + compat |

更细的常量表与文件级索引见同目录 **[reference.md](reference.md)**。

## 魔改工作流（扩展时）

1. 定目标：品牌、端口、D-Bus、线程名等。
2. 改 frida-core Vala/C（`lib/base`、`server`、`inject`、`gadget` 等）。
3. 同步 meson、`compat/build.py`、`releng/devkit.py`。
4. 确认 **post-process** 对 **需统一的制品**（executable / shared-library）都跑 topatch。
5. 全量构建后用 `strings`、验证脚本或自写抽检确认。

## 维护注意事项

- **`frida-base.h`** 由 Vala 生成，勿手改。
- **submodules** 空则 `git submodule update --init`。
- **`releng/deps.toml`**：prebuild 加速。
- **版本**：`releng/frida_version.py`。
