# rusda

基于官方 [frida](https://github.com/frida/frida) 的反检测魔改版。

功能和官方 frida 完全一致，也兼容官方客户端（`frida`/`frida-tools` 直接连），区别只在于：把二进制里那些一查一个准的 frida 指纹——进程名、线程名、内存特征字符串、符号、memfd 名等——尽量抹掉，用来绕过目标 App 自带的反 frida 检测。

配套原理讲解和踩坑教程见微信公众号 **R逆向**。

<div align="center">
  <img src="https://blog-img-1393828675.cos.ap-shanghai.myqcloud.com/rreversewechat/wechatsearch.png" width="320" alt="微信公众号 R逆向"/>
  <br/>
  <sub>微信搜索 <b>R逆向</b> · 逆向 / 安全 / frida 魔改持续更新</sub>
</div>

## 下载

到 [Releases](https://github.com/taisuii/rusda/releases) 下载，每个版本都带 `server` / `inject` / `gadget` 的四个架构（`arm` / `arm64` / `x86` / `x86_64`）。

| 版本 | 适用 | 编译所需 NDK |
| --- | --- | --- |
| [17.15.0](https://github.com/taisuii/rusda/releases/tag/17.15.0) | 最新版，特性最全 | r29 |
| [17.14.1](https://github.com/taisuii/rusda/releases/tag/17.14.1) | 17.14 线 | r29 |
| [17.6.2](https://github.com/taisuii/rusda/releases/tag/17.6.2) | 稳定版 | r25 |
| [16.7.19](https://github.com/taisuii/rusda/releases/tag/16.7.19) | 16.7 线 | r25 |
| [16.2.1](https://github.com/taisuii/rusda/releases/tag/16.2.1) | 老机型 / 低版本 Android | r25 |

产物沿用官方命名：`rusda-{server,inject,gadget}-<版本>-android-<架构>(.so).xz`。下载后 `xz -d` 解压，用法和官方 frida 一模一样，把 `frida-server` 换成 `rusda-server` 推到 `/data/local/tmp` 跑起来即可。

## 它改了什么，为什么这么改

frida 容易被抓，是因为它在进程里留了一堆固定指纹。常见的检测点：

- 进程名 / 文件名：`frida-server`、`frida-agent`、`frida-gadget`
- 线程名（`/proc/<pid>/task/*/comm`）：`gum-js-loop`、`gmain`、`gdbus`、`frida-*`
- 内存特征字符串（`.rodata`）：`FridaScriptEngine`、`GumScript`、`GDBusProxy`、`GLib-GIO`
- RPC 标识：`frida:rpc`
- memfd / maps：`memfd:frida-agent`
- 入口符号：`frida_agent_main`

rusda 分三层把这些尽量抹掉，同时不动 frida 的功能、也不破坏和官方客户端的协议兼容。

### 一、源码层（编译前打补丁）

直接改 frida-core / frida-gum 的 Vala / C 源码，补丁在 `<版本>/patches/deliver/` 下。

| 改动 | 文件 | 为什么 |
| --- | --- | --- |
| 所有产物名 `frida-*` → `rusda-*`、资源目录 `lib/frida/` → `lib/rusda/` | `meson.build`、`compat/build.py` | 文件名 / 进程名 / 路径是最基础的检测面 |
| `re.frida.server` → `re.rusda.server` | `server/server.vala` | Android 工作目录标识 |
| `frida:rpc` 改成运行时拼接 | `lib/base/rpc.vala` | RPC 标识留明文等于自报家门，改成运行时再拼 |
| 各种 `frida-*` 线程名改成运行时 XOR 解码 | `agent.vala`、`p2p.vala`、`gadget.vala` | 线程名能被 `comm` 直接枚举 |
| memfd 名 → `jit-cache` | `lib/base/linux.vala`（17.6.2）、`frida-helper-backend.vala`（16.x / 16.7） | 避免 `maps` 里露出 `memfd:frida-agent` |
| `frida_agent_main` → `main` | 各 `*-host-session.vala`、`agent-container.vala` | 符号 / 入口检测 |
| `g_set_prgname("frida")` → `"russell"` | `gum/gum.c`、`src/frida-glue.c` | 进程名 |

能在源码解决的就在源码解决；像线程名、rpc 这种改成运行时拼，二进制里压根不出现明文。

### 二、构建层

改 meson 输出名、`compat/build.py` 的磁盘路径、`releng/devkit.py` 的符号前缀，保证改名之后整条链一致、能正常链接。`tools/build-android-all.sh` 负责串行编四个架构（并行会因为同时解压 / 写 deps 把 SDK 弄坏），并按位宽精确挑 gadget、用 `readelf` 校验产物架构对不对。

### 三、二进制层（链接后 topatch）

有些字符串源码层够不着：要么在静态链进来的 GLib / GObject 里（`GLib-GIO`、`GDBusProxy`、`gmain`、`gdbus`），要么是 Vala 自动生成的 GObject 类型名（`FridaScriptEngine`、`GumScript`）。这些只能等链接完了直接对二进制动手。

`tools/post-process.py` 会在每个产物（server / inject / gadget / 内嵌 agent）链接后调 `topatch.py`：

- 用 [lief](https://github.com/lief-project/LIEF) 把 `.rodata` 里的 GObject 类型名**等长反转**：`FridaScriptEngine` → `enignEtpircSadirF`、`GumScript` → `tpircSmuG` ……
- 符号表 `frida` → `rusda`，`frida_agent_main` → `main`
- 线程名等长字节替换：`gum-js-loop` → `russellloop`、`gmain` → `rmain`、`gdbus` → `rubus`
- SONAME `libfrida-*-raw` → `librusda-*-raw`

两个关键点：

- **为什么是「等长反转 / 替换」而不是删掉或乱改**：ELF 里这些字符串的偏移、重定位都是定死的，只要保证长度不变就不会动布局，二进制照常能跑。反转既等长，又让 `strings` 和内存扫描匹配不到原串。
- **为什么放二进制层而不是全堆源码里**：库内部和 Vala 生成的类型名在源码里改工程量大、容易漏，还可能破坏 GObject 类型注册。链接后统一 patch 最稳、覆盖也最全。

## 自己编译

环境：Linux（或 WSL）、Node 22、对应版本的 NDK、`pip install lief`。以 17.6.2 为例：

```bash
# 假设本仓库在 ~/rusda
RUSDA=~/rusda/17.6.2

# 1. 拉官方源码（注意 tag 和子模块）
git clone --recurse-submodules -b 17.6.2 https://github.com/frida/frida frida17.6.2
cd frida17.6.2

# 2. 打补丁
git apply --exclude=releng "$RUSDA/patches/deliver/superrepo.patch"
( cd subprojects/frida-core && git apply "$RUSDA/patches/deliver/frida-core.patch" )
( cd subprojects/frida-gum  && git apply "$RUSDA/patches/deliver/frida-gum.patch" )

# 3. 编译四架构
export ANDROID_NDK_ROOT=<你的 NDK 路径>      # 版本对应见上面的表
./tools/build-android-all.sh

# 4. 自检
python "$RUSDA/tools/verify-patch.py" dist-android
```

产物在 `dist-android/`。不同 frida 版本要不同 NDK（见下载表那一列），装错 NDK 在 `configure` 阶段就会报版本不符。

## 自检

`verify-patch.py` 会把 `dist-android` 里所有产物抽一遍，确认 patch 都生效、没有半生不熟的：

- 每个产物的 ELF 架构和文件名一致（防止 64 位构建误打成 32 位）；
- 7 个关键特征串（`FridaScriptEngine` / `GumScript` / `GLib-GIO` / `GDBusProxy` / `gum-js-loop` / `gmain` / `gdbus`）已清零；
- 反转后的串都在。

加 `--paranoid` 会把剩余的 frida/gum 残留也算失败，用来评估魔改深度。

## 已知边界

魔改不是银弹。当前补丁清的是最常被查的那批指纹，但二进制里还留着更深的痕迹：server / inject 里大量 `Frida*` 类型名、编译期源码路径、内嵌 JS 里的 `frida:rpc`、默认端口 `27042/27052`（运行时行为，不是字符串）等。对付一般检测够用，对付重度加固 App 的深度内存扫描不一定够。要更彻底得继续往里抠，建议配真机验证再改，免得把 gadget 改崩。

## 真机测试

17.15.0 在 Pixel 6 Pro（arm64，已 root）上实测：spawn / attach 注入、Interceptor hook、读目标内存均正常，`frida -U` 直接可用。

拿一套反检测检测器（Sentry v1.3，native 层做端口 / 内存 / CRC 校验）跑了一遍：

- **线程名、内存特征、maps detection、ptrace、调试器、Xposed 这些默认就过** —— 靠的是上面那套魔改，不用额外操作。
- 只有 **Frida Ports / SO Code Integrity** 两项跟 frida 的**默认端口 27042** 有关（它在默认端口上做 D-Bus 指纹探测）。`rusda-server` 换个自定义端口跑，两项一并通过，全部 PASS：

```bash
# 起服务时指定一个非默认端口（只监听本地）
adb shell su -c '/data/local/tmp/rusda-server -l 127.0.0.1:8765'
# 客户端走 USB，不依赖监听端口
frida -U -f 包名
```

> `SO Code Integrity` 的 CRC/GOT 部分是真·反 hook 检测——server 空跑时没注入目标、没改它的代码，所以判「干净」；真去 hook 目标里它校验的函数，这项可能翻回 FAIL，那是 hook 实现层面的对抗，跟换端口是两码事。
>
> Enforcing 的设备上，frida-server 自带的 SELinux 适配在部分内核打不上，agent 通信会被挡，需要 `setenforce 0`（官方 frida 同样，非 rusda 问题）。

## 目录结构

```
rusda/
├── 16.2.1/ 16.7.19/ 17.6.2/ 17.14.1/ 17.15.0/   # 按版本分目录
│   ├── patches/deliver/                    # superrepo / frida-core / frida-gum 补丁 + README
│   └── tools/                              # build-android-all.sh、verify-patch.py
└── README.md
```

## 免责声明

本项目仅供安全研究、逆向学习与自有应用测试使用，请在合法授权范围内使用，由此产生的一切后果由使用者自行承担。
