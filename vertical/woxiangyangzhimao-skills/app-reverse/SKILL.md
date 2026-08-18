---
name: app-reverse
description_zh: "移动端逆向（Android/iOS）— 抓包参数 JS 里找不到、其实由 App 生成时，jadx/Frida hook 提密钥+样本，转 param-encryptor"
description: 移动端(Android/iOS)加密参数逆向 — 当 Web 抓包发现某 sign/token/加密参数其实由配套 App 生成、JS 端根本找不到时,下沉到 App 层定位加密函数。覆盖 jadx/apktool 反编译、smali 阅读、Frida hook 关键加密函数(Cipher/Mac/MessageDigest/自定义 native)提取密钥与输入输出样本、SSL Pinning 绕过、native .so 用 IDA/Ghidra 分析、JNI 桥追踪;iOS 砸壳/class-dump/objection 思路。目标=拿到「函数位置 + 一组输入→输出样本 + 密钥来源」,再转交 param-encryptor 纯算复现、reverse-parity-gate 对齐。触发词:「App 生成的签名」「抓包参数 JS 里找不到」「下沉到 App 层」「jadx」「frida」「smali」「so 逆向」「移动端加密」「SSL Pinning」「砸壳」。边界:只负责「从 App 定位到加密函数 + 拿样本」,算法复现转交 param-encryptor,交付前对齐转交 reverse-parity-gate。
---

# App Reverse · 移动端加密参数逆向

> 核心场景:Web 抓包定位到某个 `sign`/`token`/`X-Sign` 加密参数,但翻遍 JS 都找不到生成位置——因为它其实是配套 **App**(Android/iOS)算出来后塞进请求的。此时 Web 链路走不通,必须下沉到 App 层。
> 核心理念:**定位加密函数(位置) → Hook 拿一组输入→输出样本 → 摸清密钥来源 → 转交 param-encryptor 纯算复现 → reverse-parity-gate 逐字节对齐**。
> 不在 App 里硬扣算法、不重打包跑业务、不绕风控——只把「黑盒加密」变成「已知输入输出 + 已知密钥」的纯算问题。

---

## 一、Scope 与授权(与 web-reverse-master 同口径)

- 只对**你被授权测试的系统、你自有的应用、公开学习目标、或防御/调试研究**作业。
- 不协助:账号滥用、绕过访问控制、凭据窃取、大规模抓取、对第三方服务的隐蔽规避、击穿生产反滥用系统。遇到这类请求,改写为防御性分析、插桩、限速设计或合规调试。
- 每一个算法结论在拿到**源码位置 / Hook 输出 / 真实样本 / 可复现本地测试**之前,一律视为「待验证」。
- 目标是第三方真实 App 时:完成定位与取样后先给 Plan,征得用户确认再写 Phase 4 生产代码。
- 本技能聚焦**读与观测**:反编译阅读、动态 Hook 观测、密钥取样。重打包/patch smali/绕 root 等**修改设备或应用**的动作,仅在用户明确要求且授权范围内进行,且默认不触碰。

---

## 二、角色规则

**此 Skill 激活后,以移动端逆向工程师身份工作。**

- 加密方式、密钥、IV 必须通过**动态 Hook 实证确认**,禁止从函数名猜测。
- 优先静态读懂逻辑(jadx/smali),读不动再上动态 Hook;能 Java 层 Hook 就不碰 native。
- 核心逻辑沉到 `.so`/native 时,明确切到 IDA/Ghidra,不在 Java 层死磕。
- 不做自动安装、不联网 bootstrap、不依赖任何 MCP server;所有工具均为**本机命令行**直连(adb/frida/jadx/apktool/objection)。工具缺失时给手动安装指引,由用户自行安装。
- **本技能不负责算法复现**。定位到加密函数并拿到样本后,产出交接物转交 `param-encryptor`;交付前用 `reverse-parity-gate` 对齐。

---

## 三、环境与工具(均需手动安装,不自动装)

> Windows + PowerShell。Python 一律用 `python3.11`(本机 `python`/`python3`/`py` 是坏的 Store stub)。
> 默认 **No-MCP 路由**:不依赖 `ida-pro-mcp` / `frida-mcp` 等;全部用命令行直连。若当前会话恰好暴露了对应 MCP 工具,可作为可选加速,但主路径始终是命令行。

| 工具 | 用途 | 手动安装 | 验证 |
|------|------|---------|------|
| `adb` | 设备连接 / 进程 / 日志 / 拉文件 | winget `Google.PlatformTools` 或官网 Android Platform-Tools 解压 | `adb devices` |
| `jadx` | APK → Java 反编译阅读 | 官网 github.com/skylot/jadx Release 解压 | `jadx --version` |
| `apktool` | APK 解包/看 smali/看 Manifest | github.com/iBotPeaches/Apktool 下 jar + bat | `apktool --version` |
| `frida` / `frida-ps` | 动态 Hook(Java/native) | `python3.11 -m pip install frida-tools` | `frida-ps -U` |
| `objection` | Frida 增强 REPL(免写脚本绕 pinning) | `python3.11 -m pip install objection` | `objection version` |
| `ghidra` | `.so`/Mach-O 反编译(免费) | github.com/NationalSecurityAgency/ghidra Release | GUI 启动 |
| IDA | `.so`/Mach-O 深度分析(商业) | hex-rays.com 官网 | GUI 启动 |
| `unidbg` | 把 Android native `.so` 拉进 JVM **模拟执行**算 sign(无需真机) | github.com/zhkl0228/unidbg 源码 + `gradle build`(JDK 8+) | 跑通自带示例 |

> 设备端还需 `frida-server`(与本机 frida 版本一致的对应架构二进制,从 frida GitHub Release 取)推到设备 `/data/local/tmp/` 并以 root 运行。这一步需要用户自备 root 设备/模拟器,本技能不代为安装。

**PowerShell 常用命令:**

```powershell
# 设备 / 进程
adb devices
frida-ps -U                          # 列出 USB 设备上的进程
frida-ps -Uai                        # 仅列已安装应用

# 反编译阅读
jadx -d .\jadx_out app.apk           # Java 反编译落盘
jadx --deobf -d .\jadx_out app.apk   # 混淆名时加去混淆
apktool d app.apk -o .\apktool_out   # 解包看 smali + Manifest

# 动态 Hook
frida -U -f com.example.app -l hook.js --no-pause   # spawn 注入
frida -U -n com.example.app -l hook.js              # attach 到已运行进程
frida-trace -U -n com.example.app -j "javax.crypto.Cipher!*"   # 快速追 Cipher

# 拉 native 库出来分析
adb shell pm path com.example.app    # 找 base.apk 路径
adb pull /data/app/.../base.apk .    # 拉下来后解包取 lib/arm64-v8a/*.so
```

---

## 四、纪律化流程(从 Web 下沉到 App,六步)

> 每步带 CHECKPOINT 的必须达成后才能进入下一步。禁止跳步直接扣算法。

### Step 0 — 确认「确实在 App 层」(下沉判据)

由 Web 抓包侧(`reverse-traffic-triage` / `web-reverse-master`)转入。进入本技能前先确认:

- 目标参数在 **App 发出的请求**里出现,但同站 H5/Web 的 JS 调用栈里**写不出该参数**(initiator 追不到、断点打不上)。
- 或该参数只在 App 原生请求里有,H5 请求里压根没有。

🔴 **CHECKPOINT**:能说清「这个 `sign` 在 Web JS 里找不到、确属 App 生成」才下沉;否则退回 `reverse-traffic-triage` 继续在 Web 侧定位,别白拆 App。

### Step 1 — Triage:摸清 App 构成

不急着 Hook。先建立地图。

```powershell
jadx -d .\jadx_out app.apk
apktool d app.apk -o .\apktool_out
```

看四样:
- `AndroidManifest.xml`:主 `package`、`application` 类、入口 `activity`、网络相关 service。
- 主包结构:业务包名、第三方 SDK(okhttp/retrofit/网络库)。
- `lib/` 下是否有 `.so`(`arm64-v8a`/`armeabi-v7a`)——决定后面要不要切 native。
- 是否**加壳**(360/腾讯乐固/梆梆/爱加密):jadx 打开几乎全是空壳类 / `attachBaseContext` 里解密 dex → 已加固。加固需先脱壳(用户授权范围内),本技能不展开脱壳工具链,仅标注「需脱壳」。

🔴 **CHECKPOINT**:记录 `包名 + 入口类 + 有无 .so + 是否加固`。加固未脱壳 → 静态读不动,直接走 Step 3 动态 Hook。

### Step 2 — 静态定位候选加密函数

在 `jadx_out` 里搜目标参数名 + 加密关键词,缩小到几个候选函数。

常见关键词:`sign` `token` `encrypt` `cipher` `getInstance` `doFinal` `Mac` `digest` `MessageDigest` `secretKey` `IvParameterSpec` `base64` + 你的**参数名本身**(如 `X-Sign`、`mtgsig`)。

读到这些就是命中:
- `javax.crypto.Cipher.getInstance("AES/CBC/PKCS5Padding")` → 对称加密。
- `javax.crypto.Mac.getInstance("HmacSHA256")` → HMAC 签名。
- `java.security.MessageDigest.getInstance("MD5"/"SHA-256")` → 哈希。
- `System.loadLibrary("xxx")` + `native` 方法 → 核心在 `.so`,Java 只是 JNI 壳。

🔴 **CHECKPOINT**:列出 ≥1 个候选函数(类名+方法名+文件)。混淆严重读不出 → 不硬读,转 Step 3 用 Hook 反向定位。

### Step 3 — 动态 Hook 拿密钥 + 输入输出样本(本技能核心产出)

无论静态是否读懂,都用 Frida hook **标准加密 API**,直接截获算法、密钥、明文、密文。这是把黑盒变白盒的关键一步。

把下面脚本存为 `hook_crypto.js`,`frida -U -f <包名> -l hook_crypto.js --no-pause` 注入,然后在 App 里触发那个请求:

```javascript
// hook_crypto.js — 截获 Java 层标准加密 API 的算法/密钥/输入/输出
function hex(bytes) {
  if (bytes === null) return "null";
  return Java.array('byte', bytes).map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
function utf8(bytes) {
  try { return Java.use('java.lang.String').$new(bytes); } catch (e) { return '<bin>'; }
}

Java.perform(function () {
  // ── 对称加密 Cipher：拿算法 + 密钥 + IV ──
  var Cipher = Java.use('javax.crypto.Cipher');
  Cipher.getInstance.overload('java.lang.String').implementation = function (algo) {
    console.log('[Cipher.getInstance] ' + algo);
    return this.getInstance(algo);
  };
  var SecretKeySpec = Java.use('javax.crypto.spec.SecretKeySpec');
  SecretKeySpec.$init.overload('[B', 'java.lang.String').implementation = function (k, a) {
    console.log('[Key] algo=' + a + ' key(hex)=' + hex(k) + ' key(utf8)=' + utf8(k));
    return this.$init(k, a);
  };
  var IvSpec = Java.use('javax.crypto.spec.IvParameterSpec');
  IvSpec.$init.overload('[B').implementation = function (iv) {
    console.log('[IV] ' + hex(iv));
    return this.$init(iv);
  };
  Cipher.doFinal.overload('[B').implementation = function (input) {
    var out = this.doFinal(input);
    console.log('[Cipher.doFinal] in(hex)=' + hex(input) + '\n            in(utf8)=' + utf8(input) + '\n            out(hex)=' + hex(out));
    return out;
  };

  // ── HMAC / Mac：拿密钥 + 输入 + 输出 ──
  var Mac = Java.use('javax.crypto.Mac');
  Mac.getInstance.overload('java.lang.String').implementation = function (a) {
    console.log('[Mac.getInstance] ' + a); return this.getInstance(a);
  };
  Mac.doFinal.overload('[B').implementation = function (input) {
    var out = this.doFinal(input);
    console.log('[Mac.doFinal] in=' + utf8(input) + '\n           out(hex)=' + hex(out));
    return out;
  };

  // ── MessageDigest：哈希签名常见 ──
  var MD = Java.use('java.security.MessageDigest');
  MD.digest.overload('[B').implementation = function (input) {
    var out = this.digest(input);
    console.log('[MD.digest] algo=' + this.getAlgorithm() + '\n         in=' + utf8(input) + '\n         out(hex)=' + hex(out));
    return out;
  };
});
```

如果 Step 2 发现核心是**自定义 native 方法**(Java 只是 `native` 声明),改 hook 它的 JNI 导出:

```javascript
// hook 自定义 native 函数(先用 frida-trace 或读 .so 导出表确定名字/模块)
Interceptor.attach(Module.findExportByName('libsign.so', 'Java_com_example_Sign_sign'), {
  onEnter: function (args) {
    // args[0]=JNIEnv, args[1]=jclass/this；后续是入参,需按签名读
    this.start = Date.now();
    console.log('[native sign] called');
  },
  onLeave: function (retval) {
    console.log('[native sign] returned in ' + (Date.now() - this.start) + 'ms');
  }
});
```

> 取样要求(交给 param-encryptor 前必须够用):
> - **≥3 组** 输入→输出样本,覆盖典型输入、空输入、边界输入。
> - 明确记录:算法字符串(如 `AES/CBC/PKCS5Padding`)、key(hex+utf8)、IV、输入编码、输出格式(hex/base64)。
> - **密钥来源**:是硬编码常量、接口下发、还是设备指纹派生?这决定能否纯算复现。

🔴 **CHECKPOINT · 关键门控**:拿到 `算法 + 密钥 + 密钥来源 + ≥3 组 输入→输出样本` → 进入交接。任一缺失 → 不要宣称定位完成,继续 Hook 或回 Step 2/4。

### Step 4 — 排障:Hook 不到时

请求带加密参数发出了,但上面脚本没打印 → 多半是**没走标准 JCE API**,或被 SSL Pinning / root 检测挡在前面。对照「失败模式表」处理。常用绕过(仅授权范围内):

```powershell
# objection 一键绕 SSL Pinning + root 检测,便于先抓到明文请求确认参数确实在这个流程里生成
objection -g com.example.app explore
# 进入 REPL 后:
#   android sslpinning disable
#   android root disable

# 或 Frida 通用 pinning bypass 脚本
frida -U -f com.example.app -l ssl_pinning_bypass.js --no-pause
```

绕过 pinning 的目的只有一个:**让你能用代理(Burp/mitmproxy)看清楚 App 到底发了什么、加密参数长什么样**,从而回到 Step 2/3 精确定位。不是为了篡改业务。

### Step 5 — native 分流(核心在 `.so` 时)

Java 层只是 JNI 包装、`System.loadLibrary` 后逻辑消失、签名在 `.so` 里 → 切静态反汇编:

```powershell
# 从设备/APK 取出目标 .so
adb pull /data/app/.../lib/arm64-v8a/libsign.so .
```

- 用 **Ghidra**(免费)或 **IDA** 打开 `.so`,看导出表(`Java_*` JNI 函数)、字符串(密钥常量、算法名常常以明文字符串躺在 `.rodata`)。
- 目标不是读懂整个 `.so`,而是:**确认算法 + 找出密钥/盐/常量**,再回 Step 3 用 Frida hook 该 native 函数拿 运行时输入输出样本对账。
- 静态(看常量)+ 动态(Hook 取样)**双向印证**,比纯静态啃汇编快得多。
- **第三条路 — 模拟执行**:不想上真机 Hook、或想要可移植纯算时,用 **unidbg**(`zhkl0228/unidbg`,见上方工具表)把 `.so` 拉进 JVM 模拟跑,喂输入拿输出、按报错补齐缺失的 JNI/syscall,即可脱离设备复现 sign。适合"算法在 native、又要纯算落地"的场景。

🔴 **CHECKPOINT**:`.so` 里能定位到算法 + 关键常量,且 Frida 能 hook 到该函数拿样本 → 回 Step 3 的取样标准收口。

### Step 6 — iOS(简述思路,同样产出「函数位置 + 样本 + 密钥」)

iOS 流程与 Android 对称,工具不同:

- **砸壳**:App Store 下载的二进制是加密的,先解密。Hook/分析前必须砸壳。常用 `frida-ios-dump`(需越狱设备或可注入环境)拿到解密 IPA。
- **class-dump**:对解密后的二进制 `class-dump` 导出 ObjC 头文件,定位疑似签名/加密类与方法名(`-sign`、`-encrypt`、`-hmac`)。
- **Frida hook**:hook `CommonCrypto` 的 `CCCrypt`(对称加密)、`CCHmac`(HMAC),onEnter 时 `hexdump` 读 key/iv/明文,拿算法 + 密钥 + 输入输出。
- **objection**:`objection -g <bundleid> explore` → `ios sslpinning disable` / `ios jailbreak disable`,同样为了先抓到明文请求确认参数来源。
- Swift 符号用 `swift-demangle` 还原;`.dylib`/Mach-O 深度分析用 Ghidra/IDA/Hopper。

🔴 **CHECKPOINT**:iOS 侧同样要收口到 `算法 + 密钥 + 密钥来源 + ≥3 组样本`,标准与 Android 一致。

---

## 五、失败模式表

| 症状 | 原因 | 一线修复 | 仍失败兜底 |
|------|------|---------|----------|
| 触发请求了,Cipher/Mac/MD hook 全无打印 | 没走标准 JCE,用了自研/native 加密 | 读 Step 2 候选找 `native` 方法 / `.so` | Step 5 反汇编 `.so` + hook JNI 导出 |
| frida 注入即闪退 / 进程消失 | App 有 frida-server / root 检测 | objection `android root disable`;改 attach 而非 spawn | 自定义 anti-frida bypass 脚本(端口/字符串检测) |
| `frida-ps -U` 列不出进程 | frida-server 没起/版本不符/无 root | 推对应架构 frida-server 到 `/data/local/tmp` 并 root 运行,版本对齐本机 frida | 换 root 模拟器 / frida-gadget 注入(需重签) |
| 抓不到明文请求,全是 TLS 密文 | SSL Pinning | objection `android sslpinning disable` | Frida 通用 pinning bypass / 系统证书 |
| jadx 打开几乎全是空类 | App 加固(壳) | 标注「需脱壳」,直接走动态 Hook | 用户授权下脱壳(本技能不含脱壳链) |
| native hook 偏移/参数读错 | JNI 签名理解错 / arm64 调参约定 | 先 `frida-trace -j` 确认函数被调,再按 JNI 签名读 args | Ghidra 看函数原型确定参数个数与类型 |
| 拿到样本但 param-encryptor 复现对不上 | 密钥来源是设备指纹/接口下发,非硬编码 | 回 Step 3 查 key 的真正来源 | 把 key 派生过程也作为待复现目标交接 |
| iOS hook CCCrypt 无输出 | 用了 CryptoKit/自研而非 CommonCrypto | class-dump 找自研加密类,hook ObjC 方法 | 反汇编 Mach-O 定位算法 |

---

## 六、交接物与下游路由

**本技能的唯一交付目标:把 App 里的黑盒加密,变成可纯算复现的已知问题。** 产出以下交接物:

```
定位结论
├─ 加密函数位置:  类名 + 方法名 + 文件/行号(Java);或 .so 模块 + 导出符号(native)
├─ 算法:          AES/CBC/PKCS5Padding | HmacSHA256 | MD5 ... (Hook 实证)
├─ 密钥来源:      硬编码常量 / 接口下发 / 设备指纹派生 (决定能否纯算)
├─ 密钥 + IV:     hex + utf8
└─ 样本:          ≥3 组 输入(明文/编码) → 输出(hex/base64)
```

**下游路由:**

| 交付 / 衔接 | 转交对象 | 时机 |
|------------|---------|------|
| 算法纯算复现(出 signer.py/signer.js) | `param-encryptor` | 已拿到 `算法 + 密钥 + 样本`,把它当作已知算法复现 |
| 交付前逐字节对齐 | `reverse-parity-gate` | signer 写完、宣称「对上了」之前,用真实样本逐字节对照、排查动态字段 |
| 密钥/签名被混淆需先还原(纯 JS 侧 SDK) | `ast-deobfuscation` | 仅当混淆发生在可读的 JS/H5 SDK 侧 |

**上游入口:**

| 上游 | 何时把任务转入本技能 |
|------|---------------------|
| `web-reverse-master` / `reverse-traffic-triage` | Web 抓包定位到加密参数,但 JS 调用栈追不到、确认参数实由配套 App(或桌面客户端)生成时,下沉到本技能 |

**典型调度链:**
```
web-reverse-master 抓包发现 X-Sign,JS 里 initiator 追不到
  → app-reverse Step 0 确认确属 App 生成
  → app-reverse Step 1-3 jadx 定位 + Frida hook 拿 算法/密钥/≥3组样本
  → param-encryptor 把已知算法纯算复现成 signer.py
  → reverse-parity-gate 用真实样本逐字节对齐,排查时间戳/随机 IV 等动态字段
  → web-reverse-master 集成进主脚本
```

---

## 七、反模式黑名单

| # | 不要做 | 替代 |
|---|--------|------|
| 1 | 没确认参数确属 App 生成就拆 App | 先 Step 0,Web 侧能定位就别下沉 |
| 2 | 从函数名/字符串猜算法和密钥 | 必须 Frida hook 实证 |
| 3 | Java 还能读懂就先扣 `.so` | 先 Java/smali,核心真在 native 才切反汇编 |
| 4 | 只拿 1 组样本就交接 | ≥3 组,覆盖典型/空/边界 |
| 5 | 忽略密钥来源(硬编码 vs 设备派生) | 来源决定能否纯算,必须查清并写进交接物 |
| 6 | 在本技能里硬写算法复现 | 复现是 param-encryptor 的活,本技能只定位+取样 |
| 7 | 默认重打包/patch smali/绕 root | 仅授权且用户明确要求;默认只读+观测 |
| 8 | 自动装工具 / 联网 bootstrap / 依赖 MCP | 工具缺失给手动安装指引,命令行直连 |
