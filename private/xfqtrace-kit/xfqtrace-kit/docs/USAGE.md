# xfQTrace 使用指南

## 这份文档解决什么问题

这份文档只负责两件事：

- 怎么把 `xfqtrace` 跑起来
- 当前 JSON 配置该怎么写

## 怎么读这份文档

如果你现在只是想把 trace 跑起来，先读第一章和第四章就够了：

1. 第一章：先跑通自动化或半自动化 trace
2. 第四章：遇到 `config error`、trace 卡住、日志不对时再回来看排查

只有当你需要自己写配置、扩 DSL、或者对照真实样本时，再继续看第二章和第三章。

## 第一章 快速使用

### 1.1 先装 xfq / skill

2.0 之后把 `xfq` 和 Codex/Claude skill 单独做成了一个 pip 包。第一次用可以先把这个包装上，再用 `xfq init` 导入 kit 的 zip 包，最后把 skill 刷到 Codex/Claude：

```bash
pipx install xfqtrace-skills
xfq init ./xfqtrace-kit-<version>.zip -p <password>
xfq skill install --target both
xfq doctor --serial <serial>
```

这里的 `<password>` 就是压缩包解压密码，这里也呼吁大家不要发出去吧，毕竟我为了这东西花了很多心血。
`xfq` 只是安装、检查、更新和装 skill 的辅助工具；下面真正跑 trace 还是直接用 kit 里的 `全自动化trace.py`。
> 这里我就没把 xfq 做成一个工具了，因为那样会让你更难理解，所以xfq只是个辅助工具，就跟skill一样，只是我想让ai帮你省一些时间而已;

### 1.2 自动化 trace（推荐）

```bash

# spawn 模式（自动启动 app，默认按 xfinject 链路跑）
python ./全自动化trace.py -p <package> --inject-backend xfinject

# attach 模式只适合 frida-server；xfinject 不支持 attach
python ./全自动化trace.py -p <package> --attach --inject-backend frida-server

# 最短写法：只清当前包日志然后退出
python ./全自动化trace.py -p <package> --clear-only

# 裸写 --clear-logs 等价于 --clear-logs target
python ./全自动化trace.py -p <package> --clear-logs

# 只清当前包日志（设备 /sdcard、包私有 trace_logs、本地 xfqtrace-kit/examples/<package>/logs）
python ./全自动化trace.py -p <package> --clear-logs target --clear-only

# 清所有示例包日志（会按 examples/* 推导设备侧 trace_logs，并清本地所有 logs）
python ./全自动化trace.py -p <package> --clear-logs all --clear-only

# 默认只在设备侧录 xfQTrace logcat，结束后 pull 到 logs/<N>/logcat.txt；如果想终端也看，再显式开
python ./全自动化trace.py -p <package> --log-viewer auto

# 终端只看 I+，落盘 logcat 保留 V+
python ./全自动化trace.py -p <package> --console-log-level I --log-file-level V
```

### 1.3 注入后端：xfinject / frida-server

默认后端是 `xfinject`，这是我fork的gozinject,不过为了适配这个要改的挺多。优点就是效果很好，并且我自己还写了个kpm模块用于隐藏maps的东西;
平时直接这样跑就行：

```bash
python ./全自动化trace.py -p <package> --serial <serial>
```

如果你想写得更明确，也可以显式指定：

```bash
python ./全自动化trace.py -p <package> --serial <serial> --inject-backend xfinject
```

只有需要走旧的 Frida 注入链路、或者要用 `--bypass` 脚本时，才显式切到 `frida-server`：

```bash
python ./全自动化trace.py -p <package> --serial <serial> --inject-backend frida-server
```

注意：

- 每次普通启动前脚本都会先 `am force-stop <package>`，避免旧进程/旧 trace 状态污染。
- 默认 `xfinject` 后端依赖 `kit/bin/xfinjectd`；如果 `xfq init`/`xfq doctor` 报缺这个文件，说明 kit 不完整，需要重新安装完整 kit。
- `xfinject` 路径会先把 JSON 配置暂存到 `/data/local/tmp`，再通过 xfinject 的通用 `-app-file <src>:xfqtrace_config.json` 放进目标 App 自己的 `files/` 目录；最终路径是 `/data/data/<package>/files/xfqtrace_config.json`。`libxfqtrace.so` 注入后通过 `xfqtrace_configure_file_and_start_async` 读取该配置并启动 native 引擎。
- `xfinject` 不使用 Frida bypass 脚本；如果还是崩溃，先按真实崩溃/检测链路分析，不要默认归因到 Frida。
- `frida-server` 不打包进 kit，因为我用的是小佳星球的；选择 `--inject-backend frida-server` 时，需要自己先启动设备侧 server。
- 不要用固定 timeout 判断 trace 成功。成功证据看 `xfqtrace armed`、`start trace`、`trace begin`、`trace completed successfully`、trace 文件增长/落盘和崩溃日志。
- trace 很久是正常现象；如果需要人工快速验证 arm 链路，可以临时加 `--xfinject-timeout <秒> --keep-running-on-timeout` 让自动化返回，但这只代表“停止等待”，不代表 trace 失败。

自动化脚本会：

1. push `kit/bin/xfinjectd` 和 `kit/bin/libxfqtrace.so` 到设备
2. spawn/attach 目标进程
3. 优先加载 `examples/<package>/recipe.json` 或 `--recipe` 指定文件；没有 recipe 时才回退到旧 `半自动化trace.js`
4. 先清空设备 `logcat` buffer，再尽早启动 `xfQTrace` 的 `logcat` 采集
5. 默认不把 `xfQTrace` 的 `logcat` 镜像到 Python 控制台，只在设备侧保存一份无 ANSI 的 `xfQTrace` 日志；需要现场看时显式加 `--log-viewer auto`
6. 等待 `trace_done` 信号；正常 `max_traces` 耗尽时只做 `cleanup_done`，不再调用 `xfqtrace_stop()` 干扰已完成 trace
7. 收到 `trace_done` 后额外保留一小段 drain 时间，并在 pull 后用 host `logcat -d` 刷新 `logcat.txt`，保证主进程 `trace end / trace completed successfully` 等尾部日志不会被设备侧 `logcat -f` 截断
8. trace 完自动把设备侧 `xfQTrace` 日志和 trace 文件一起 `pull` 到 `xfqtrace-kit/examples/<package>/logs/<N>/`
9. LZ4 解压（如果启用了压缩） 需要提前安装(win自带了exe)

终端/文件日志选项：

- `--log-viewer auto|pidcat|logcat|none`
  - `none`：默认值，只保留设备侧 `logcat.txt`，不镜像到 Python 控制台
  - `auto`：优先 `kit/bin/pidcat(.exe)`，其次 PATH 里的 `pidcat`，找不到则提示并降级到 `adb logcat`
  - `pidcat`：强制优先彩色 pidcat；找不到时仍降级到 `adb logcat`
  - `logcat`：使用原生 `adb logcat`
- `--console-log-level V|D|I|W|E|F`：终端实时日志阈值，默认 `I`
- `--log-file-level V|D|I|W|E|F`：保存到 `logcat.txt` 的 `xfQTrace` 阈值，默认 `V`
`pidcat/logcat` 是 Python 宿主侧显示器选择，不写进注入给 native 的 JSON。hook 脚本里的
`options.logging` 只保留 native 日志语义，例如：

```js
logging: {
  hook_result_level: "E",
  trace_event_level: "W"
}
```

清日志选项说明：

- `--clear-logs target`
  - 清 `/sdcard/xfqtrace_*`
  - 清 `/data/data/<package>/files/trace_logs`
  - 清本地 `xfqtrace-kit/examples/<package>/logs`
- `--clear-logs`
  - 等价于 `--clear-logs target`
- `--clear-logs all`
  - 在 `target` 基础上，按 `xfqtrace-kit/examples/*` 里的示例包目录继续清它们各自的设备 `trace_logs`
  - 同时清本地所有 `xfqtrace-kit/examples/<package>/logs`
- `--clear-only`
  - 只执行清理，不跑 trace
  - 如果没显式给 `--clear-logs`，默认按 `target` 处理

默认流程：

- 普通 spawn trace 默认只 `force-stop` 旧进程，不默认 `pm clear`。
- 默认启用 `--auto-click`，用于处理隐私协议/权限弹窗；如需完全手动 UI，可加 `--no-auto-click`。
- 只有明确需要首启/缓存重建流程时，才显式加 `--clear-app-data`。很多真实样本需要保留登录态或风控缓存，不能每次默认清数据。
- auto-click 会识别隐私/权限按钮，也会处理 dy 首启中可能出现的 `不再提醒`；不会点击系统 ANR/崩溃框里的 `Close app/关闭应用/Wait`，避免验证脚本替系统杀掉目标进程。
- 普通自动化 trace 中 auto-click 不再设置固定时间预算；它跟随本轮 trace 生命周期，直到 `trace_done`、进程退出或手动停止。
- 等待 `trace_done` 时也会监控本轮注入的原始 PID 和 Frida detach；如果 app 崩溃/被系统重启，会立即停止等待并拉 partial trace/logcat，不会被新 PID 误导继续傻等。

自动化脚本只是帮你完成 push、注入、等待和 pull；真正决定 trace 目标和行为的，还是后面的“半自动化trace”里那份 `半自动化trace.js` 配置。不看下一节的话，基本没法正确修改 trace 目标、`hook_format`、`out_format` 这些关键项。

### 1.4 半自动化 trace

下面这节默认你当前目录就在 `xfqtrace-kit/`。全自动入口是根目录 `./全自动化trace.py`，默认兜底 hook 是根目录 `./半自动化trace.js`；单包样本脚本放在 `./examples/<package>/半自动化trace.js`。

### 1.5 `recipe.json`：推荐的新配置入口

旧样本目录里一般有 `半自动化trace.js`，顶部是 `const CONFIG = {...}`，下面重复一大段 Frida 注入逻辑。现在推荐逐步改成：

```text
examples/<package>/
├── recipe.json              # 只写配置
└── 半自动化trace.js          # 旧脚本保留兼容，可不再改
```

`recipe.json` 结构和旧 `CONFIG` 基本一致：

```json
{
  "package": "com.target.app",
  "app_version": "1.2.3",
  "target": { "type": "func", "so_name": "libtarget.so", "offset": "0x1234" },
  "options": {
    "inline_hook_backend": 2,
    "out_format": "traceui",
    "lz4_compression": { "enable": true, "level": 0 },
    "stop_condition": { "max_traces": 1 },
    "hook_format": { "args": "env,obj,jstr", "ret": "jstr" }
  },
  "notes": "可选：记录触发路径、已知问题"
}
```

`app_version` 是给人看的备注字段，native 引擎不会读取。它只表示“这个 offset 是在哪个 App/APK 版本上确认的”；未知就写 `"unknown"`，后面补。

JSON 本身不支持注释，所以版本号就直接写在 `app_version`；需要补充安装包来源、触发步骤、历史偏移时写到 `notes`，不要为了备注版本号改变目录结构。

每个样本只保留一个 `examples/<package>/recipe.json`。如果要临时测试别的版本/偏移，直接复制或新建一个独立 JSON，然后用 `--recipe <path>` 指过去；不要在 kit 里再维护 `recipes/` 子目录。

自动化加载优先级：

1. 显式 `--script <js>`：完全按你指定的 JS 跑。
2. 显式 `--recipe <path-or-name>`：可以是绝对路径、相对路径，或包目录下的单个 JSON 文件。
3. `examples/<package>/recipe.json`：自动用 `helpers/default_trace_launcher.js` 生成标准 Frida launcher；`xfinject` 也直接消费同一份 JSON。
4. `examples/<package>/半自动化trace.js`：旧兼容路径。
5. 根目录 `半自动化trace.js`：兜底模板。

这样做的好处：

- 每个样本只维护 `target/options`，不再复制大段 JS。
- `frida-server` 和 `xfinject` 用同一份配置，不会出现 JS 配置和 native JSON 不一致。
- 后续批量测试、文档生成、样本反馈都能直接读 JSON。

注意：JSON 不支持裸 `0x1234` 数字字面量，所以 `recipe.json` 里的 `offset` 统一写成字符串：`"0x1234"`。不要写十进制，也不要把 maps 基址/运行时绝对地址当 RVA 填进去。

#### 只需要改的地方

通常只改脚本顶部的 `CONFIG`。先看这个速览版，详细字段说明在后面的“JSON 配置 Schema”。

```javascript
const CONFIG = {
    package: "com.target.app", // 目标包名
    target: {
        type: "func",          // 目前常用就是 func
        so_name: "libtarget.so", // 目标 SO 名
        offset: 0x1234,        // 函数 RVA，不是绝对地址
    },
    options: {
        inline_hook_backend: 2, // inline hook 后端，默认先试 Dobby
        out_format: "traceui", // 输出风格；traceui 更适合工具查看，xfqtrace 信息更多但文件更大
        lz4_compression: { enable: true, level: 0 }, // 是否压缩 trace
        sync_flush: false,      // 重调试开关；每条记录立即 write + logcat，最慢，但最后一条最稳
        logging: {              // 可按项关闭 hook/JNI 调试噪音
            insn_debug: false,
            hook_diff: true,
            progress_insn_step: 20000000, // 每推进 2000 万条指令打一条 progress
            heartbeat_sec: 10,            // 每 10 秒强制打一条 progress
            logcat_after_flush_count: 0, // 达到指定 flush 次数后，由后台 flush 线程把刷盘文本镜像到 xfQTrace.sync
            flush_on_progress: false, // 每次 progress 时尝试把当前 active buffer 切给后台异步刷盘
        },
        stop_condition: { max_traces: 1 }, // 命中几次后自动停
        hook_format: {          // hook 入口/返回值怎么打印；详细例子见后文
            args: "env,obj,int,jobj",
            ret: "jobj",
        },
    },
};
```

- `package`：目标包名
- `target.so_name`：目标 SO 名称
- `target.offset`：函数 RVA，不是绝对地址
- `options`：trace 行为配置；更细的字段解释见后文

#### 脚本实际流程

半自动脚本本身做了这几件事：

1. 把引擎路径固定为 `/data/data/<package>/files/libxfqtrace.so`
2. 用 `dlopen` 加载 `libxfqtrace.so`
3. 用 `dlsym` 解析 `xfqtrace_configure`、`xfqtrace_start`、`xfqtrace_stop`、`xfqtrace_get_last_error`、`xfqtrace_set_done_callback`
4. 等待 `target.so_name` 加载；如果目标 SO 已经在内存里，会立即 arm
5. 把 `CONFIG` 组装成 `{"target": ..., "options": ...}`，并额外自动补上 `target.base`
6. 调用 `xfqtrace_configure(json)` 完成配置
7. 调用 `xfqtrace_start()` 开始 trace
8. native trace 结束时，通过 done callback `send({type: "trace_done"})`

这里的 `target.base` 不需要手填。脚本在 `Process.findModuleByName(CONFIG.target.so_name)` 成功后，自动把模块基址转成字符串写回 JSON，再传给 native。

#### 手动注入方式

```bash

# spawn 后注入
frida -U -f <package> -l ./<package>/半自动化trace.js 

# attach 到已运行进程
frida -U -n <package> -l ./<package>/半自动化trace.js

# 前台 app 快速附加
frida -UF -l ./半自动化trace.js
```

#### 停止 trace

脚本导出了 `rpc.exports.stop()`，用于安全收尾：

1. 调用 `xfqtrace_stop()`
2. 清空 done callback
3. 如果还没 arm，会顺手解除 `android_dlopen_ext` 监听

自动化脚本就是靠这个导出函数来停止 trace 并继续 `adb pull`。

### 1.6 调试要点

1. 调试时要同时看两边：
   Frida 控制台：看脚本层状态，比如 `[*] waiting for <so> ...`、`[*] config: ...`、`[+] trace armed! ...`
   `logcat`：看 native 引擎、hook 后端、trace 生命周期、参数/返回值、真正的报错原因
2. so工作时内部日志：  `logcat` 里的tag为 `xfQTrace`
3. 如果报 `config error` 或 `start error`，排查 Frida 问题，先保证 frida 正常，且能正常 hook 到函数
4. 如果 trace 崩溃、卡住、或者你想尽量保住卡住前最后一段日志，先试 `logging.flush_on_progress: true`，它仍然走异步双缓冲，只是在 progress 点尝试提前切一块 active buffer 去后台刷盘
5. 如果你还想同时盯 `logcat`，再配 `logging.logcat_after_flush_count`；它现在是后台 flush 后镜像到 `xfQTrace.sync`，不会把前台 trace 线程切成真正的同步写
6. 只有在上面两招还不够时，再开 `sync_flush: true`；它最稳，但会显著拖慢 trace
6. `trace_done` 只是一条 Frida `send()` 消息；手动跑 `半自动化trace.js` 时收到它不代表文件已经被拉回本地，拉文件需要你自己再执行 `adb pull`
7. 大 trace 时还要看 `flush #...` 这类日志，比如 `flush #86: raw=127MB compressed=8.4MB total_raw=11008.0MB total_disk=1004.7MB ...`。它表示后台 flush / 压缩线程还在正常工作，不是异常日志
8. trace 刚启动时还会打印一条 `trace debug config: ...`，把当前 `sync_flush`、flush 块大小、progress 步长、heartbeat 秒数一次性说明白

日志等级简单分类：

- `E`：真正错误，以及最需要第一眼看到的 hook 结果；默认 `hook arg` / `hook return` 仍走 `E`
- `W`：trace 生命周期关键节点；默认 `start trace` / `trace begin` / `trace end` / `trace completed successfully` 走 `W`
- `I`：主流程状态和进度，比如 `xfqtrace target`、`xfqtrace armed`、`trace progress`、`flush #...`、`max_traces reached`
- `D`：更细的内部调试信息，主要用于诊断实现细节。比如逐条指令 `trace:0x...`、filter skip、hook reinstall、`trace run end` 寄存器现场、done_callback 触发

## 第二章 实战示例

### examples 样本使用备注

下面只记录 大概测了哪些样本，然后哪些样本你们能学到一些东西;

| package | 目标 | 用途 / 注意点 |
| --- | --- | --- |
| `cn.damai` | `libsgmainso-6.7.250903.so!0x5b198` | 大麦指纹/cmd 分发函数；示例里用 `filter cmd=10401`，适合演示“高频函数只 trace 指定 cmd”。 |
| `cn.soulapp.android` | `libsmsdk.so!0x998c` | Soul 签名函数；trace 时间可能很长、文件也可能很大，看到持续 `trace progress/flush` 就不是卡死。 |
| `com.ecommerce.xmnair` | `libsmsdk.so!0xa10c` | SMSDK.w1 JNI 样本；需要精确 `hook_format`。。1.3版本的xfqtrace代码有不稳定的地方，所以会崩溃，2.0修好了;|
| `com.jd.jdhealth` | `libjdg.so!0x9223C` | 京东健康 `libjdg` 样本；适合看 JNI 参数格式和返回值。 |
| `com.jingdong.app.mall` | `libjdg.so!0x29CE4` | 京东主站 `jdgs` 示例；常规 JNI bridge，适合演示 `int cmd + Object` 参数。 |
| `com.mfw.roadbook` | `libmfw.so!0x642bc` | 马蜂窝 `xPreAuthencode(Context,String,String)->String`，很普通的样本。 |
| `com.rytong.ceair` | `libtiger_tally.so!0x28ccf4` | 东航样本；目标 SO 从 APK 内加载，xfinject 通过 linker hook + `dl_iterate_phdr` 可在 dlopen caller 恢复前 arm。但是没测出触发函数，疑似xfqtrace还有一些问题。 |
| `com.sfacg` | `libsfdata.so!0x2728c` | 已能进入并 arm success，但当前没稳定触发; 这个我没有详细测试，可能是给的偏移不对。|
| `com.shopee.vn` | `libshpssdk.so!0x27ae58` | 比较经典的样本了，签名、指纹采集、指纹加密;|
| `com.smile.gifmaker` | `libkwsgmain.so!0x41680` | 快手系样本；适合回归常规 inline hook 和 trace 输出。 |
| `com.ss.android.ugc.aweme` | `libmetasec_ml.so!0x77EC4` | 抖音样本；指纹函数，这个样本qbdi的trace问题很多，不过我的xfqtrace已经修好了，但是不保证完全一样; gumtrace需要自己改点代码就很好trace;|
| `com.starbucks.cn` | `libcfbe0b.so!0xFED4` | 星巴克梆梆壳样本；frida-server 路径通常需要 `--bypass bangbang`，首启会有隐私协议和 onboarding，需要 auto-click 或手动点到首页触发业务请求。 |
| `com.wandafilm.app` | `libjgdtc.so!0x6c6ec` | Wanda 样本； |
| `com.xiaofeng.qbdi` | `libxftest.so!0x20adc` | 本地 demo，这也是我用来对比不同trace工具速度的那个demo,开源在github了；适合回归基础 trace、hook-diff、JNI 参数解析，不依赖真实 app 首启流程。 |
| `com.xunmeng.pinduoduo` | `libpdd_secure.so!0xFA94` | 拼多多指纹函数；适合演示多参数 JNI 和超过 8 个参数时的栈参数读取。 |
| `com.zhiliaoapp.musically` | `libmetasec_ov.so!0x1012DC` | TikTok 四神参数样本；适合展示 `int/long/String/Object` 混合参数。 |
| `ru.moneyman` | `libsdk_bc_lib.so!0x9554C` | AppsFlyer 请求头签名样本；适合演示 `jmap.diff`，看函数前后往 Map 里写了什么。 |

### 大麦指纹函数：`options.filter` 按 `cmd` 过滤

`cn.damai` 的 `doCommandNative(int cmd, Object[] args)` 调用频率很高，通常只想盯 `cmd=10401`：

```json
{
    "target": { "type": "func", "so_name": "libsgmainso-6.7.250903.so", "offset": "0x5b198" },
    "options": {
        "out_format": "traceui",
        "lz4_compression": { "enable": true, "level": 0 },
        "stop_condition": { "max_traces": 10 },
        "filter": { "arg": 2, "type": "int", "op": "eq", "value": 10401 },
        "filter_display": "_,obj,int,jobjarr",
        "hook_format": { "args": "env,obj,int,jobj", "ret": "jobj" }
    }
}
```

这里 `env,obj` 是 JNI 桥接函数的前两个固定参数；真正业务参数里的 `cmd` 在第 3 个位置，所以 `arg` 填 `2`。`filter_display` 只影响 filter mismatch 时那条日志里参数怎么展示，不影响真正的过滤条件。

### appsflyer 的 af-sdk-signature 请求头：`jmap.diff` 看参数变化

`ru.moneyman` 这个例子适合演示 `jmap.diff`：

```json
{
    "target": { "type": "func", "so_name": "libsdk_bc_lib.so", "offset": "0x9554C" },
    "options": {
        "inline_hook_backend": 2,
        "out_format": "traceui",
        "lz4_compression": { "enable": true, "level": 0 },
        "stop_condition": { "max_traces": 3 },
        "hook_format": { "args": "env,obj,jmap.diff,jbarr,jmap.diff", "ret": "void" }
    }
}
```

trace 结束后，logcat 会直接输出 Map 的增删改差异，适合看签名函数往请求头里塞了什么。

### Demo hook-diff 全覆盖回归

`com.xiaofeng.qbdi` 里新增了一个专门的 hook-diff demo，当前稳定覆盖：

- `jbarr.diff`
- `jarr.diff`
- `jlist.diff`
- `jset.diff`
- `jmap.diff`
- `jobj.diff`
- `String` 默认只做 `jstr` 展示，不支持 `jstr.diff`

推荐验证命令：

```bash
python ./全自动化trace.py -p com.xiaofeng.qbdi --script xfqtrace-kit/examples/com.xiaofeng.qbdi/半自动化trace_hookdiff.js
```

对应脚本会自动解析 `Java_com_xiaofeng_qbdi_MainActivity_nativeHookDiffDemo` 的导出地址，并在 `MainActivity` 就绪后重试触发 `triggerHookDiffDemo()`，避免 app 刚启动时 `sCurrent` 还没建立导致假超时。

### 京东 `jdgs` 参数

```json
{
    "target": { "type": "func", "so_name": "libjdg.so", "offset": "0x29CE4" },
    "options": {
        "inline_hook_backend": 2,
        "out_format": "xfqtrace",
        "lz4_compression": { "enable": true, "level": 0 },
        "stop_condition": { "max_traces": 5 },
        "anon_trace": false,
        "hook_format": { "args": "env,_,int,jobj", "ret": "jobj" }
    }
}
```

这个例子适合看 JNI 桥接函数里某个 `int cmd` 配合 `Object[]` 的调用路径。

### TikTok 四神参数

```json
{
    "target": { "type": "func", "so_name": "libmetasec_ov.so", "offset": "0x1012DC" },
    "options": {
        "inline_hook_backend": 2,
        "out_format": "xfqtrace",
        "lz4_compression": { "enable": true, "level": 0 },
        "stop_condition": { "max_traces": 10 },
        "anon_trace": false,
        "hook_format": { "args": "env,obj,int,int,long,jstr,jobj", "ret": "jobj" }
    }
}
```

适合展示多参数 JNI 函数，尤其是 `int / long / String / Object` 混合入参时怎么快速把参数先看清楚。

### 拼多多指纹函数

```json
{
    "target": { "type": "func", "so_name": "libpdd_secure.so", "offset": "0xFA94" },
    "options": {
        "inline_hook_backend": 2,
        "out_format": "traceui",
        "lz4_compression": { "enable": true, "level": 0 },
        "stop_condition": { "max_traces": 1 },
        "anon_trace": false,
        "hook_format": { "args": "env,obj,obj,jstr,jstr,jstr,jstr,jstr,long,jstr", "ret": "jstr" }
    }
}
```

这个例子适合说明参数超过 8 个时也能正常取参，后面的参数会从栈上补取。

### 星巴克：`bypass` + 匿名段 trace

这个例子只关心 `String` 和 `byte[]` 内容，所以前两个 JNI 固定参数直接用 `_` 跳过：

```json
{
    "target": { "type": "func", "so_name": "libcfbe0b.so", "offset": "0xFED4" },
    "options": {
        "inline_hook_backend": 2,
        "out_format": "traceui",
        "lz4_compression": { "enable": false, "level": 0 },
        "stop_condition": { "max_traces": 1 },
        "anon_trace": true,
        "hook_format": { "args": "_,_,jstr,jbarr" }
    }
}
```

配合 `bypass_bangbang.js` 绕过梆梆检测后注入；打开 `anon_trace` 后，会额外覆盖匿名可执行段。

### Soul：返回值是字符串，命名跟着第 1 个业务参数走

```json
{
    "target": { "type": "func", "so_name": "libsmsdk.so", "offset": "0x998c" },
    "options": {
        "inline_hook_backend": 2,
        "out_format": "traceui",
        "lz4_compression": { "enable": true, "level": 0 },
        "stop_condition": { "max_traces": 1 },
        "hook_format": {
            "args": "env,obj,jobj,jstr,jstr,jstr,jstr,jstr",
            "ret": "jstr",
            "naming_source": 1,
            "naming_index": 0
        }
    }
}
```

这个例子适合展示 `naming_source / naming_index` 的实际用途：输出文件名或 trace 标识跟着某个业务参数走，后面批量看结果时更直观。

### Shopee：先把 trace 跑通，再慢慢细化 `hook_format`

```json
{
    "target": { "type": "func", "so_name": "libshpssdk.so", "offset": "0x43E514" },
    "options": {
        "inline_hook_backend": 2,
        "out_format": "traceui",
        "lz4_compression": { "enable": true, "level": 0 },
        "stop_condition": { "max_traces": 1 }
    }
}
```

这个例子故意没配 `hook_format`，意思是先确认 trace 链路没问题，再回头补参数类型；实际接入时经常先这么干。

Shopee 这类多版本样本直接在 `recipe.json` 里写 `app_version`。如果要临时跑另一个版本，把对应 JSON 单独放出来并用 `--recipe <path>` 指定即可，不在样本目录里维护多份候选配置。

Shopee 还有一类更适合回归的触发方式：不是单纯等用户手点业务，而是“被动 trace 监听 + 主动调用”一起做。注意现在默认发的是 lite 包，不内置 Shopee APK；跑这个示例前需要设备上已经装好 `com.shopee.vn`，或者显式用 `--reinstall <apk-path>` 安装。

1. 先被动监听 `android_dlopen_ext`，等 `libshpssdk.so` 出现后 arm trace。
2. arm 成功后延迟调用 Java 入口 `com.shopee.shpssdk.wvvvuwwu.vuwuuwvw(byte[], byte[])`。
3. 本轮 payload 里塞一个 `TRACE_MARKER`，再用 `filter_expr` 只抓包含这个 marker 的那次调用。
4. 这样就不用靠 UI/网络时机碰运气，适合做“只捕获我关心的 trace”的 smoke / 回归样本。

核心写法大概是这样：

```javascript
const TRACE_MARKER = "xfqtrace_manual_" + Date.now().toString(16);

const CONFIG = {
    package: "com.shopee.vn",
    target: { type: "func", so_name: "libshpssdk.so", offset: "0x2790c8" },
    options: {
        inline_hook_backend: 2,
        out_format: "traceui",
        lz4_compression: { enable: true, level: 0 },
        stop_condition: { max_traces: 1 },
        hook_format: { args: "env,obj,jbarr,jbarr", ret: "jstr" },
        filter_expr: `x3:jbarr contains hex('${asciiHex(TRACE_MARKER)}')`,
    },
    trigger: {
        delay_ms: 1000,
        class_name: "com.shopee.shpssdk.wvvvuwwu",
        method_name: "vuwuuwvw",
        url: "https://mall.shopee.vn/api/v4/native/homepage",
        payload: TRIGGER_PAYLOAD_JSON,
    },
};
```

如果只想验证主动调用本身，不加载 trace 引擎，可以先跑 `examples/com.shopee.vn/主动调用验证.js`，它会直接调用 Java/JNI 入口并打印返回值，方便和 trace 模式对照。

### 马蜂窝：直接对应到 Java 方法签名

对应 Java 方法：`xPreAuthencode(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;`

```json
{
    "target": { "type": "func", "so_name": "libmfw.so", "offset": "0x642bc" },
    "options": {
        "inline_hook_backend": 2,
        "out_format": "traceui",
        "lz4_compression": { "enable": true, "level": 0 },
        "stop_condition": { "max_traces": 1 },
        "hook_format": { "args": "env,obj,jobj,jstr,jstr", "ret": "jstr" }
    }
}
```

这类例子最适合给刚接入的人看：先从 Java 签名数参数，再反推 JNI 桥接层的 `hook_format`。
![alt text](USAGE.assets/image-14.png)

### SF轻小说：`static native (Context, String, int) -> String`

对应 Java 方法：`getSFSecurity(Landroid/content/Context;Ljava/lang/String;I)Ljava/lang/String;`

```json
{
    "target": { "type": "func", "so_name": "libsfdata.so", "offset": "0x2728c" },
    "options": {
        "inline_hook_backend": 2,
        "out_format": "traceui",
        "lz4_compression": { "enable": true, "level": 0 },
        "stop_condition": { "max_traces": 1 },
        "hook_format": { "args": "_,_,jobj,jstr,int", "ret": "jstr" }
    }
}
```

这个例子对应 `static native` 场景，所以前两个参数直接跳过：

- `x0 = JNIEnv*`
- `x1 = jclass`
- `x2 = Context`
- `x3 = String`
- `x4 = int`

落地脚本见 `xfqtrace-kit/examples/com.sfacg/半自动化trace.js`。

## 第三章 JSON 配置详解

日常使用时你改的是 `半自动化trace.js` 顶部的 `CONFIG`。脚本会自动补 `target.base`，再把 `{ target, options }` 转成 JSON 传给 `xfqtrace_configure(json)`。

先记住三件事：

1. `target.offset` 写函数 RVA，不写 IDA 里的绝对运行地址。
2. Java native 函数一般 `x0=env`，`x1=obj/jclass`，业务参数从 `x2` 开始。
3. `stop_condition.max_traces` 表示命中几次目标调用后结束；不要用按时间截断的思路判断 trace 是否完整。

### 最小模板

```javascript
const CONFIG = {
    package: "com.target.app",
    target: {
        type: "func",
        so_name: "libtarget.so",
        offset: 0x1234,
    },
    options: {
        inline_hook_backend: 2,
        out_format: "traceui",
        lz4_compression: { enable: true, level: 0 },
        stop_condition: { max_traces: 1 },
        hook_format: {
            args: "env,obj,int,jstr",
            ret: "jstr",
        },
    },
};
```

这份配置含义：目标 app 是 `com.target.app`，等 `libtarget.so` 加载后 trace `base + 0x1234`，打印 `x2` 为 int、`x3` 为 Java String，返回值也按 Java String 打印，命中 1 次后自然收尾。

### 顶层字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `package` | 是 | 目标包名；自动化脚本安装、启动、清缓存、拉日志都靠它。 |
| `app_version` | 否 | 备注字段：这个 offset 对应的 App/APK 版本；native 不读取。 |
| `target` | 是 | 目标函数位置。 |
| `options` | 是 | trace 输出、过滤、参数打印等行为。 |

`package` 是 JS 自动化脚本用的，不会原样传给 native；native 只关心 `target` 和 `options`。

### target：目标函数

| 字段 | 写法 | 说明 |
| --- | --- | --- |
| `type` | `"func"` | 目前常用固定写 `func`。 |
| `so_name` | `"libxxx.so"` | 目标函数所在 SO 名。 |
| `offset` | `"0x1234"` | 函数 RVA。脚本会自动算 `base + offset`。 |
| `base` | 不手填 | 脚本等待 SO 加载后自动补。 |

常见错误：

- 把 IDA 运行地址直接填进 `offset`：应减去 SO 基址，只填 RVA。
- SO 还没加载就手动 start：用现有脚本即可，它会等 `so_name` 出现后再 arm。
- 一次配多个目标：当前按一次一个目标写；多函数就串行跑多次。

### options：常用行为

| 字段 | 推荐值 | 说明 |
| --- | --- | --- |
| `inline_hook_backend` | `2` | inline hook 后端，默认用 Dobby；失败时再换其它后端。 |
| `out_format` | `"traceui"` | 输出风格。`traceui`/`gumtrace` 更紧凑，适合工具查看；`xfqtrace` 信息更全但更大。 |
| `lz4_compression.enable` | `true` | 建议打开，trace 文件会小很多，pull 也更快。 |
| `lz4_compression.level` | `0` | 0 最快；一般不用改。 |
| `stop_condition.max_traces` | `1` | 命中几次目标调用后结束。需要采多次就改成 2、3、10。 |
| `sync_flush` | `false` | 只有定位最后几条日志丢失时才临时打开；会明显变慢。 |
| `memory_trace` | `false` | 需要看内存读写 hexdump 时再打开。 |
| `anon_trace` | `true` | 目标跳进匿名可执行段时继续跟踪；一般保持默认。 |
| `multi_thread_trace` | `false` | 多个线程命中同一目标时是否分别启动独立 QBDI VM/logger。默认关；确认需要抓并发命中时再开。 |
| `trace_modules` | 不写 | 覆盖默认第三方库排除；例如需要跟进 MMKV 时写 `["libmmkv2.so"]`。 |
| `exclude_modules` | 不写 | 额外模块排除；适合 App 自带但确认只是噪音的 SO。 |
| `exclude_ranges` | 不写 | 额外地址段排除；适合已确认的 dispatcher/JIT 噪音段。 |

`logging` 通常不用写。控制台颜色、`logcat/pidcat`、文件日志级别是自动化脚本/CLI 的事情，不建议塞进每个样本配置里。只有你在调试引擎输出节奏时，才临时加：

```javascript
logging: {
    insn_debug: false,
    hook_diff: true,
    progress_insn_step: 20000000,
    heartbeat_sec: 10,
}
```

### hook_format：参数和返回值怎么打印

`hook_format.args` 按目标函数参数顺序写，逗号分隔；`hook_format.ret` 写返回值类型。

Java native 常见写法：

```javascript
hook_format: {
    args: "env,obj,int,jstr,jbarr",
    ret: "jstr",
}
```

对应关系：

- `x0=env`：固定跳过/标记环境参数。
- `x1=obj`：实例方法是 `this`，静态方法可写 `jclass`。
- `x2` 开始才是业务参数，比如 `int`、`jstr`、`jbarr`。

常用 tag：

| tag | 含义 | 适用场景 |
| --- | --- | --- |
| `_` / `env` | 跳过，不输出 | `x0` 或不关心的参数。 |
| `obj` / `jobj` | Java 对象 | 只想看类名/对象摘要。 |
| `jclass` | Java Class | 静态 native 的 `x1`。 |
| `jstr` | Java String | 字符串参数/返回值。 |
| `jbarr` | Java byte[] | 加密、签名、压缩、协议 buffer。 |
| `jarr` / `jobjarr` | Java Object[] | 参数数组。 |
| `jlist` / `jset` / `jmap` | Java 集合 | Map/List/Set 参数。 |
| `int` / `long` / `bool` | 基础类型 | cmd、flag、长度、状态码。 |
| `ptr` / `hex` | 指针或十六进制值 | 地址、handle。 |
| `cstr` | C 字符串 | `char *`。 |
| `buf.N` | C buffer | 当前参数是 buffer，长度取第 N 个参数。 |
| `jmap.diff` / `jlist.diff` / `jarr.diff` / `jbarr.diff` / `jobj.diff` | entry/exit 前后对比 | 看函数是否修改了入参对象。 |

`buf.N` 示例：如果 `x2=buf`、`x3=len`，则 `args: "env,obj,buf.3,int"`。

`naming_source` / `naming_index` 用于用某个参数参与 trace 文件命名；不是必须字段，不确定就别写。

### module policy：模块纳入/排除

默认策略是：

1. 目标函数所在 SO 作为 anchor 一定会纳入。
2. 执行流跳到其他 App SO 或匿名可执行段时，按需 on-demand 纳入。
3. 系统、运行时、trace 工具自身模块硬排除。
4. 常见第三方基础库默认不 on-demand 纳入，避免 trace 无意义膨胀和干扰，例如 `libmmkv*`、`libprotobuf*`、`libfbjni*`、`libcurl*`、`libcrypto.so`、`libssl.so`、`libc++_shared.so` 等。

如果某个默认排除的第三方库就是你的目标逻辑，可以显式打开：

```json
"trace_modules": ["libmmkv2.so"]
```

如果某个 App 自带 SO 只是噪音，可以额外排除：

```json
"exclude_modules": ["libnoise.so", "libunused_plugin.so"]
```

这两个字段都支持字符串或字符串数组。规则优先级：

```text
硬排除和 exclude_modules > trace_modules 显式纳入 > 默认第三方排除 > on-demand 分类
```

`exclude_ranges` 仍然用于地址段级别排除：

```json
"exclude_ranges": [
  { "start": "0x7000000000", "end": "0x7000010000", "reason": "known dispatcher" }
]
```

### multi_thread_trace：多线程命中同一目标

默认 `multi_thread_trace=false`，保持旧行为：同一时间只跑一个顶层 trace，其他线程命中时自然走原函数，不排队、不等待。

开启后：

```json
"multi_thread_trace": true
```

- 目标 hook 会保持安装。
- 每个命中的线程各自创建 QBDI VM。
- 每个线程写独立 trace 文件，文件名带 `_t<tid>`。
- 不做队列化，不人为改变 App 真实调度顺序。

这个模式文件会明显变多、变大；像 XHS 这种长循环样本如果只想看主路径，就不要开。

### filter：只 trace 你关心的调用

函数调用很多时，用 `options.filter` 先过滤。命中才启动 trace，不命中自然返回。

最常用结构：

```javascript
filter: { arg: 2, type: "int", op: "eq", value: 10401 }
```

字段解释：

| 字段 | 说明 |
| --- | --- |
| `arg` / `idx` | 参数编号，对应 `x0..x15`；Java native 业务参数通常从 `2` 开始。 |
| `type` | 参数解析方式，如 `int`、`jstr`、`jbarr`、`jmap`、`buf.N`。 |
| `op` | 比较方式，如 `eq`、`contains`、`regex`、`in`。 |
| `value` | 期望值。 |

常用 `type/op`：

| 类型 | 常用 op | 说明 |
| --- | --- | --- |
| `int` / `long` / `ptr` / `bool` | `eq` `ne` `gt` `ge` `lt` `le` `in` | 数值比较。 |
| `jstr` / `cstr` / `jobj` / `jmap` / `jlist` / `jset` / `jarr` | `eq` `ne` `contains` `prefix` `suffix` `regex` `in` | 文本/对象摘要比较。 |
| `jbarr` | `eq` `ne` `contains` `prefix` `suffix` | byte[] 按 hex 比较。 |
| `buf.N` | `contains` `prefix` `suffix` | C buffer，长度来自第 N 个参数。 |

多个条件：

```javascript
filter: {
    all: [
        { arg: 2, type: "int", op: "eq", value: 10401 },
        { arg: 4, type: "jstr", op: "contains", value: "mini/rp" },
    ],
}
```

`all`/`and` 表示都满足，`any`/`or` 表示满足任意一个，`not` 表示取反。

byte[] 过滤：

```javascript
filter: {
    arg: 2,
    type: "jbarr",
    op: "contains",
    value: "504B0304",
    encoding: "hex",
}
```

`value` 可以写成 `504B0304`、`50 4B 03 04`、`0x50 0x4B 0x03 0x04`。

`filter_display` 只影响“不命中时日志里参数怎么显示”，不影响过滤结果：

```javascript
filter_display: "env,obj,int,jstr"
```

### 常见配置模板

#### 1. 普通 Java native：返回字符串

```javascript
options: {
    inline_hook_backend: 2,
    out_format: "traceui",
    lz4_compression: { enable: true, level: 0 },
    stop_condition: { max_traces: 1 },
    hook_format: { args: "env,obj,jstr,jstr", ret: "jstr" },
}
```

#### 2. cmd 分发函数：只 trace 某个 cmd

```javascript
options: {
    stop_condition: { max_traces: 1 },
    hook_format: { args: "env,obj,int,jobjarr", ret: "jobj" },
    filter: { arg: 2, type: "int", op: "eq", value: 10401 },
    filter_display: "env,obj,int,jobjarr",
}
```

#### 3. byte[] 包含特征

```javascript
options: {
    stop_condition: { max_traces: 1 },
    hook_format: { args: "env,obj,jbarr,jstr", ret: "jbarr" },
    filter: {
        arg: 2,
        type: "jbarr",
        op: "contains",
        value: "68747470733A2F2F",
        encoding: "hex",
    },
}
```

#### 4. 看 Map/List 是否被函数修改

```javascript
options: {
    stop_condition: { max_traces: 1 },
    hook_format: { args: "env,obj,jmap.diff,jlist.diff", ret: "jobj" },
}
```

#### 5. C 函数：`char *` 和 buffer

```javascript
options: {
    stop_condition: { max_traces: 1 },
    hook_format: { args: "cstr,buf.2,int", ret: "int" },
}
```

这里表示 `x0` 按 C 字符串打印，`x1` 按 buffer 打印，buffer 长度取 `x2`。


## 第四章 常见问题

### Q: trace 文件在哪？

默认路径：`/data/user/0/<package>/files/trace_logs/xfqtrace_<lib>_<base>_<offset>.log`

如果开了 LZ4 压缩，扩展名为 `.log.lz4`，用系统 `lz4 -d` 解压；`全自动化trace.py` 会先找 `kit/bin/lz4(.exe)`，找不到再使用 `PATH` 里的 `lz4`。

### Q: hook 没触发？

1. 确认 `target.offset` 是函数入口的 RVA（不是绝对地址），大部分时候是地址写错了
2. 确认 SO 已加载（用 `android_dlopen_ext` hook 等待加载）
3. 检查 logcat `xfQTrace` tag 的错误信息

### Q: 崩溃了？

1. 换 `options.inline_hook_backend`：`0` -> `1` -> `2` 逐个试；注意shadowhook和bhook不要一起用，会冲突；
2. 开 `sync_flush: true` 看最后一条指令在哪
3. 检查是否目标函数参数个数超过 8 个（栈参数需在 `hook_format.args` 中声明 >8 个 tag）

如果一时间判断不出来，可以直接发我；

### Q: trace 卡住了 / 不知道是否还在跑？

引擎内置 heartbeat 线程，但对外统一输出为 `trace progress`：

- 每推进 `options.logging.progress_insn_step` 条指令打印一条 `trace progress: ...`
- heartbeat 线程也不再单独打另一种格式，而是每隔 `options.logging.heartbeat_sec` 秒强制补打一条同格式的 `trace progress: ...`
- 后台 flush / 压缩线程还会打印 `flush #N: raw=... compressed=... total_raw=... total_disk=...`，这也是正常进度日志，说明 trace 文件还在持续落盘
- 如果 `trace progress` 长时间停在同一个 `pc`，说明 QBDI 卡在某个地址（可能是未插桩的段或死循环）
- 如果你不只是想知道“还在不在跑”，而是想更大概率保住卡住前最后一段文件内容，优先开 `logging.flush_on_progress: true`
- 如果你还想一边跑一边从 `logcat` 看最近刷下来的文本，再配 `logging.logcat_after_flush_count`
- 只有在需要“每条都立刻落文件 + 立刻上 logcat”时，再开 `sync_flush: true`
- 只是想更快看出“卡住没有”，优先把 `logging.heartbeat_sec` 调到 `1~3`、把 `logging.progress_insn_step` 调小，比如 `1000000`

### Q: trace 太慢？

1. 关闭 `options.memory_trace`
2. 换设备，用更高频的大核设备（CPU 单核频率是最大瓶颈）
3. 用 `options.filter` / `filter_expr` 减少不必要的 trace 触发

## 第五章 样本反馈需要给什么

如果要反馈“某个样本跑不了 / 没触发 / 崩溃 / 参数不对”，尽量一次性给齐这些东西：

建议直接按这个模板发：

```text
apk: <package / version / source>
json: <recipe.json or CONFIG snippet>
target: libxxx.so!0xoffset
sig: <可选 JNI/RegisterNatives 名字和签名>
steps: <触发步骤 + 是否要清缓存/登录/首启>
backend: <frida-server | xfinject>
logs: <logcat/crash/trace dir>
```

如果要展开说明，再补这些：

1. APK / XAPK / AAB，或能稳定复现的安装包来源和版本号。
2. 当前使用的 `recipe.json` 或 `半自动化trace.js`，至少包含：
   - `package`
   - `target.so_name`
   - `target.offset`
   - `options.hook_format`
   - `options.stop_condition`
3. 必要时给目标函数信息：
   - Java native 方法名和签名，例如 `w1(Context,String,...,long,String,List): Object`
   - RegisterNatives 里注册的 name/signature/fnPtr
   - IDA/Ghidra 里的函数 RVA，最好写成 `libxxx.so!0x偏移`
4. 触发步骤：打开 app 后点哪里、是否需要登录、是否需要清缓存/首启、是否需要发起某个请求。
5. 运行命令和后端：`frida-server` 还是 `xfinject`，是否用了 `--bypass`，是否用了 `--clear-app-data` / `--no-auto-click`。
6. `logcat.txt` 和 trace 输出目录；如果崩溃，附 `Fatal signal` / `JNI DETECTED ERROR` 前后 100 行。

不要只发一句“没触发”。至少要能判断：SO 没加载、已 arm 但业务没走、地址错了、hook_format 错了、检测崩溃、还是 trace 正在跑但没结束。

## 后续更新方向

> 下面的更新会慢慢做了，因为要上班啦

目前大的方向主要是四条：

1. 引入更偏无痕的 hook 方案，尽量减少现有注入和 hook 链路带来的暴露面
3. 写一个检测trace的demo, 检测市面上的所有trace, 然后把我的kpm优化下做到过掉检测
3. 适配ios端，qbdi网上无方案（追佬实现了但未有成品发布），gumtrace目前支持ios；我需要先进行简单的ios逆向才可以
4. rom内置魔改frida与xfqtrace，实现更深层次的隐藏; 后者已经做了
5. 二进制日志采集的trace搭配我自制的ttdbg辅助实现高效分析

小的方向主要是这些：

1. 跟踪模式，range模式（类似unidbg） 与 任意地址模式（这个好像做不了，那我就去改gumtrace,不过这个我肯定要开源）
2. 更准确全面的trace对比：进行更多样本以及不同设备之间的测试，而且上次还漏了gumtvm，顺便自己再研究写一个unicorn的trace（类似facai那个，但是他那个稳定性极差）

除了以上部分，你如果有真实需求，可以来私信压力我，着急的话我会优先适配；
好用的话可以微信直接打赏我哦!
有任何没有想到的优化或者关于trace的奇思妙想也可以跟我说，如果你有自己的trace工具，需要向我请教思路或者原理非常欢迎，但是源码估计半年内不会公开。

---
