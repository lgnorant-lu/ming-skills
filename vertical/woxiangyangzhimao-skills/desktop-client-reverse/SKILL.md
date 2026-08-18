---
name: desktop-client-reverse
description_zh: "桌面客户端逆向（Windows）— 参数在 PC 客户端 exe/dll 里生成时，先分流 Electron/.NET/原生，x64dbg/Frida 定位加密函数"
description: 桌面客户端逆向（主要 Windows）— 当目标是 PC 桌面客户端（.exe/.dll），请求里的加密/签名参数在本地 native 代码生成、web 抓包/devtools 够不到时，用本技能定位「加密函数位置 + 输入→输出样本 + 密钥来源」。先分流客户端类型（CEF/Electron 套壳 / .NET / 原生 C/C++）再选路线。触发词：「桌面客户端逆向」「PC 客户端」「exe 逆向」「dll 逆向」「客户端加密参数」「客户端签名」「x64dbg」「Frida hook exe」「dnSpy」「IDA」「Ghidra」「radare2」「Electron 套壳」「asar 解包」「抓不到这个参数它在客户端生成」。当用户已确认目标是桌面应用、参数不在浏览器/JS 里时使用。边界：只负责「从客户端二进制到加密函数入口 + 样本」的定位纪律，找到入口后转交 param-encryptor（复现算法）/ reverse-parity-gate（交付前对齐）；若分流出是 CEF/Electron 套壳则下沉回 web-reverse-master / ast-deobfuscation 走 JS 路线。
---

# Desktop Client Reverse · 桌面客户端逆向（Windows 优先）

> 核心理念：**分流客户端类型 → 抓包确认参数在 native 生成 → 在 crypto 常量/API 上定位加密函数 → Hook 提取输入/输出/密钥 → 记录函数地址+样本 → 转交 param-encryptor 复现**
> 这是 web-reverse-master 的「下沉」分支：当 web 抓包发现某个 sign/token 其实由桌面客户端而非浏览器生成时，进入本技能。
> 目标产物和 web 路线一致：**加密函数位置 + 输入→输出样本 + 密钥来源**，交给 param-encryptor 出 signer，交付前用 reverse-parity-gate 逐字节对齐。

---

## 一、Scope 与授权（与 web-reverse-master 口径一致）

- 只在以下范围工作：**用户自己拥有/被明确授权测试的客户端、公开学习目标、防御性/调试研究**。
- 不协助：账号滥用、绕过访问控制、凭据窃取、大规模爬取、对第三方生产防滥用系统的隐蔽规避、商业软件的注册/授权破解（去许可证/补丁绕过）。遇到这类请求，重构为「防御性分析 / 仪表化 / 合规调试 / 自有应用的协议复现」。
- 每一个算法结论在拿到「函数地址 + Hook 输出 + 多组输入输出样本 + 本地可复现」之前都视为**待验证**，禁止凭 API 名或 crypto 常量猜测算法。
- 目标若是真实第三方客户端，**完成定位（拿到样本）后先给出 Plan 并请用户确认**，再进入 param-encryptor 的复现/集成阶段。
- 不做破坏性操作：不 patch 用户原始二进制（要改先复制副本）、不提权运行可疑样本、不在未确认意图前对样本做动态执行。

## 二、角色规则

**本技能激活后，以「Windows 桌面客户端逆向工程师」身份工作。**

- 环境默认 **Windows + PowerShell**；Python 一律写 `python3.11`（不是 `python`/`python3`，本机后两者是坏的 Store stub）。
- 工具优先级：**本机命令行 + 调试器 GUI + Frida 直连**。不依赖任何外部 MCP server；MCP（如 ida-pro-mcp）只是可选增强，**当前会话没有实际暴露对应工具就当它不存在**，绝不臆造工具名/JSON 调用/shell wrapper。
- 所有逆向工具都**需手动安装**，本技能只给安装入口（winget/pip/官网），不写自动安装脚本、不写联网 bootstrap、不改 `~/.claude/mcp.json` 或任何 harness 配置。
- 先侦察后深挖：先 `file`/`Detect It Easy`/`rabin2 -I` 确认类型与保护，再决定动态/静态深度。
- 优先最小足够路径：能 30 行 Frida 脚本 hook 出样本，就不要先啃 IDA 反编译几千行。
- 修改前谨慎：调试/patch 一律对**副本**操作，原始二进制保持只读。

## 三、纪律化流程

> 每次任务按 Phase 0 → 4 推进，关键步带 🔴 CHECKPOINT，未达成不许进入下一步。

### Phase 0 — 分流客户端类型（最关键 CHECKPOINT）

**这是整个技能的分水岭。判错类型 = 用错重型工具白费几小时。** 先确认目标 exe/dll 的本质，再选路线。

```powershell
# 1. 看主目录结构和体积，判套壳特征
Get-ChildItem "C:\Program Files\目标App" -Recurse -File |
  Sort-Object Length -Descending | Select-Object -First 20 FullName, Length

# 2. 关键指纹文件（存在即强信号）
#   resources\app.asar            → Electron
#   *.pak / libcef.dll / cef.pak  → CEF 套壳
#   <App>.dll 同名 + .NET 运行时   → .NET（见下一步确认）
```

分流判据（按强信号优先）：

| 信号 | 类型 | 路线 |
|---|---|---|
| `resources\app.asar`、`*.asar`、含 `chrome_100_percent.pak` | **Electron** | → Route E |
| `libcef.dll` / `cef.pak` / `icudtl.dat`（无 asar，原生壳嵌 CEF） | **CEF 套壳** | → Route E（CEF/JS 部分）或 Route N（壳的 native 部分） |
| 主程序很小 + 大量托管 DLL；DIE/`rabin2` 报 `.NET assembly` / 含 `mscoree.dll` 导入 | **.NET** | → Route D |
| 纯 PE、导入表是 Win32/CRT、无托管运行时 | **原生 C/C++** | → Route N |

用工具确认（任一可用即可，都需手动装）：

```powershell
# Detect It Easy（推荐，一眼出壳/语言/保护）：手动装，官网 https://github.com/horsicq/Detect-It-Easy
diec.exe "C:\path\目标.exe"          # 命令行版输出 类型/编译器/打包器

# 或 radare2（见 radare2 技能）
rabin2 -I "C:\path\目标.exe"          # bintype/lang/arch；lang=cil → .NET
rabin2 -i "C:\path\目标.exe" | Select-String "cef|mscoree|node"
```

🔴 **CHECKPOINT 0**：明确写下「目标是 [Electron / CEF / .NET / 原生 C++]，依据是 ___」。判定不了（混合壳）时，按「壳 native + 内嵌 JS/托管」拆成两段分别走。**未确定类型，禁止进入 Phase 2。**

---

### Phase 1 — 抓包，确认参数确实在 native 生成

桌面客户端不走浏览器，需要强制把它的流量引到代理。

```powershell
# 路线 A：系统级代理 + HTTPS 解密（Fiddler / Charles / mitmproxy）
#   Fiddler Classic：手动装 https://www.telerik.com/fiddler，开 HTTPS Decrypt，装根证书
#   mitmproxy：python3.11 -m pip install mitmproxy ；mitmweb 起代理后导入证书
#   多数 .NET/Electron 客户端会读系统代理，直接抓到

# 路线 B：客户端不读系统代理 / 写死直连 → 用 Proxifier 强制改向
#   Proxifier 手动装 https://www.proxifier.com/ ，按进程名加规则强制走代理

# 路线 C：完全够不到应用层（自定义协议/证书锁定/TCP 裸协议）→ Wireshark 看链路层
#   Wireshark 手动装 https://www.wireshark.org/ ，确认目标 IP/端口/是否 TLS
```

记录：目标请求的 URL、方法、headers、body，标出**疑似加密/签名字段**（固定长度？Hex/Base64？分段分隔符？）。

证书锁定（SSL Pinning）导致代理抓不到时，不要卡在抓包：直接进 Phase 2 用 Frida hook 应用层的发送函数（见 Phase 3 的 hook 点），在加密**之后、TLS 之前**截获明文请求体。

🔴 **CHECKPOINT 1**：确认目标参数「明文不在请求里、不在 HTML/JS 资源里、是客户端运行时算出来的」。若分流是 Electron/CEF 且参数其实在 JS 里 → 立即下沉回 web 路线（见第五节路由），不要硬上 native。

---

### Phase 2 — 按类型选路线定位加密函数

#### Route E — Electron / CEF 套壳（本质还是 JS，优先）

Electron/CEF 的加密参数 99% 在打包的 JS 里，**重型 native 逆向是浪费**。先解包转回 JS 路线。

```powershell
# 1. 解 asar（Electron）
npm install -g @electron/asar          # 需 Node，手动装：winget install OpenJS.NodeJS
asar extract "C:\path\resources\app.asar" ".\app_unpacked"
#   解出后是普通 JS 工程，搜参数名 / require('crypto') / CryptoJS

# 2. 开 Electron DevTools 直接调试（很多 App 没关）
#   启动时加 --remote-debugging-port=9222，或设环境变量 ELECTRON_ENABLE_LOGGING=1
#   然后 Chrome 访问 http://localhost:9222 → 拿到 DevTools，等同 web 逆向
```

🔴 **CHECKPOINT E**：解包/DevTools 成功 → **转交 web-reverse-master**（按 Phase 2 定位）+ **ast-deobfuscation**（若 JS 被混淆）。本技能在此交棒，不继续 native。若 JS 只是壳、真正加密在随包的 `.node` 原生模块或 native dll → 回 Route N，把那个 `.node`/dll 当原生目标。

#### Route D — .NET（dnSpy/ILSpy 反编译，基本能直读）

.NET 是托管字节码（IL），反编译几乎能还原源码，**最省力**。

```powershell
# dnSpy：手动装 https://github.com/dnSpyEx/dnSpy/releases （dnSpyEx 是维护分支）
#   拖入主程序/托管 dll → 直接看 C# 源 → 搜参数名 / Encrypt / Sign / 类名
# ILSpy（命令行 ilspycmd 可批量反编译）：
dotnet tool install -g ilspycmd        # 需 .NET SDK，手动装：winget install Microsoft.DotNet.SDK.8
ilspycmd "C:\path\目标.dll" -o ".\decompiled" -p   # 反编译成 .cs 工程，再用 rg 搜
```

定位手法：
- `rg -i "encrypt|sign|aes|md5|sha|hmac|token|secret" .\decompiled` 搜可疑方法/常量。
- 在 dnSpy 里对加密方法**直接下断点调试**（dnSpy 自带调试器，可附加到运行中的进程），看入参/出参/密钥实参。
- 遇到混淆（ConfuserEx 等）：先用 de4dot 等去混淆（手动装），再反编译；本技能不展开去壳细节，方法论上等同「先反混淆再读源」。

🔴 **CHECKPOINT D**：在 dnSpy 断点处抓到「加密方法全名 + 入参明文 + 出参密文 + 密钥来源（常量/配置/派生）」≥3 组样本 → 进 Phase 4。

#### Route N — 原生 C/C++（重型逆向，静态+动态结合）

这是最硬的路线。**思路：用 crypto 指纹和 crypto API 把搜索面从整个二进制收窄到几个函数，再动态 hook 确认。**

**静态侦察（先 radare2 快侦察，需深读再上 IDA/Ghidra，全部手动装）：**

```powershell
# radare2 快速侦察（详见 radare2 技能）—— 手动装 https://github.com/radareorg/radare2/releases
rabin2 -I 目标.exe      # 架构/位数/入口
rabin2 -z 目标.exe      # 字符串：URL、错误信息、可疑常量
rabin2 -i 目标.exe      # 导入表：找 crypto / 网络 API（见下表）
r2 目标.exe             # 进交互；aaa → afl → axt <addr> 查引用 → pdf 反汇编

# IDA Pro / Ghidra 做反编译（看伪代码）——IDA 商业自备；Ghidra 免费 https://ghidra-sre.org/
#   Ghidra headless 批分析：
#   analyzeHeadless .\proj tmp -import 目标.exe -postScript script.py
```

**定位锚点 1 — crypto 常量指纹**（在反汇编/十六进制里搜这些魔数，命中即在加密函数附近）：

| 算法 | 指纹常量 |
|---|---|
| MD5 | 初始化 `0x67452301 0xEFCDAB89 0x98BADCFE 0x10325476` |
| SHA-1 | `0x67452301 0xEFCDAB89 ... 0xC3D2E1F0` |
| SHA-256 | 初值 `0x6A09E667 0xBB67AE85 ...`；常量表 `0x428A2F98 ...` |
| AES | S-box 头 `0x63 0x7C 0x77 0x7B 0xF2 0x6B 0x6F 0xC5`；Rcon |
| DES | 置换表 / S-box 数组 |
| Base64 | 字符表 `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/` |
| CRC32 | 多项式 `0xEDB88320` |

```powershell
# radare2 搜字节模式（?? 通配）定位 AES S-box 头
r2 -q -c "/x 637c777b" 目标.exe
# 或用 findcrypt 类插件（IDA: FindCrypt; Ghidra: findcrypt-ghidra），命中后直接跳到引用函数
```

**定位锚点 2 — crypto API 导入**（在导入表里找这些，谁调用它谁就是嫌疑函数）：

| 体系 | 关键 API |
|---|---|
| Windows CryptoAPI（老） | `CryptAcquireContext` `CryptCreateHash` `CryptHashData` `CryptEncrypt` `CryptDeriveKey` |
| Windows CNG（新） | `BCryptOpenAlgorithmProvider` `BCryptHashData` `BCryptEncrypt` `BCryptGenerateSymmetricKey` |
| OpenSSL | `EVP_EncryptInit_ex` `EVP_DigestUpdate` `MD5_Update` `SHA256_Update` `AES_set_encrypt_key` |
| 自带库 | 静态链接的 mbedTLS/libsodium/Crypto++ 符号（看字符串/导出） |

```powershell
rabin2 -i 目标.exe | Select-String "Crypt|BCrypt|EVP_|SHA|MD5|AES"
# 命中后 r2 里：axt sym.imp.BCryptEncrypt 查谁调用 → 那就是加密函数候选
```

🔴 **CHECKPOINT N**：把候选收窄到 1~3 个函数，记录其**地址/RVA**。未收窄到具体函数前，不要进 Phase 3 盲 hook。

---

### Phase 3 — Hook 提取 输入/输出/密钥（动态实证）

> 静态定位的函数是「嫌疑」，必须动态 hook 拿到真实样本才算坐实。Frida 是 Windows native hook 的主力。

```powershell
# 安装（手动）：
python3.11 -m pip install frida-tools
# 列进程确认目标：
frida-ps | Select-String "目标"
```

**手法 A — hook crypto API（不用先找业务函数，直接在 API 层截）：**

```javascript
// hook_crypto.js  ——  frida -n 目标.exe -l hook_crypto.js
// 例：截 Windows CNG 的对称加密，dump 明文/密文/句柄
Interceptor.attach(Module.getExportByName('bcrypt.dll', 'BCryptEncrypt'), {
  onEnter(args) {
    // args[1]=pbInput, args[2]=cbInput
    this.pIn = args[1]; this.cbIn = args[2].toInt32();
    console.log('[BCryptEncrypt] in =', hexdump(this.pIn, { length: this.cbIn }));
  },
  onLeave(retval) {
    console.log('[BCryptEncrypt] ret =', retval);
  }
});
// OpenSSL EVP 同理 hook EVP_EncryptInit_ex（拿 key/iv）+ EVP_EncryptUpdate（拿明文）
```

**手法 B — hook 业务加密函数（Phase 2 定到的地址）：**

```javascript
// 按 RVA hook 模块内部函数：base + 静态偏移（注意 ASLR，用 module.base）
const m = Process.getModuleByName('目标.dll');
const fn = m.base.add(0x12340);   // Phase 2 记录的 RVA
Interceptor.attach(fn, {
  onEnter(args) {
    this.a0 = args[0]; this.a1 = args[1];   // 按调用约定/反编译签名取参
    console.log('IN ptr =', args[0], 'len =', args[1]);
    console.log(hexdump(args[0], { length: 64 }));
  },
  onLeave(retval) { console.log('OUT =', retval, hexdump(retval, {length: 64})); }
});
```

**手法 C — 密钥来源溯源**：在 hook 里 dump 密钥指针的内存；若密钥是运行时派生（如 `CryptDeriveKey`/PBKDF2），向上 hook 派生函数和它的输入（口令/盐），记录派生链，而不是只记最终 key。密钥可能来自：硬编码常量、配置文件、登录返回、设备指纹、时间种子——必须查清，否则 param-encryptor 复现不出。

🔴 **CHECKPOINT 3 · 关键门控**：拿到 ≥3 组「输入明文 → 输出密文 + 密钥/IV/mode + 函数地址」对照样本 → 进 Phase 4。样本不全（缺密钥来源/缺 mode）→ 🛑 STOP，回 Phase 3 补，禁止猜测。

---

### Phase 4 — 整理交接物，路由到下游

把发现固化成一份**交接清单**（这是给 param-encryptor 的输入）：

```text
目标客户端：<App 名 / 版本 / 类型(Electron/.NET/native)>
加密字段：<参数名>
函数定位：模块=<目标.dll> RVA=<0x...> 函数名/签名=<...>   (.NET 写全限定方法名)
算法线索：<crypto 常量命中 / 调用的 crypto API / 反编译片段>
密钥来源：<硬编码常量值 / 配置路径 / 接口返回字段 / 派生链(算法+输入)>
IV / mode / padding / 编码：<已确认值 或 待验证>
输入→输出样本（≥3 组）：
  1) in=<...>  key=<...> iv=<...>  → out=<...>
  2) ...
Hook 脚本：hook_xxx.js（可复跑取更多样本）
```

🔴 **CHECKPOINT 4**：交接清单字段齐全（尤其密钥来源 + ≥3 组样本）→ 转交。缺字段不交。

---

## 四、失败模式表

| 症状 | 根因 | 一线修复 | 仍失败兜底 |
|---|---|---|---|
| 分流判错，IDA 啃 Electron 半天没结果 | 没做 Phase 0，把 JS 壳当 native | 回 Phase 0 看 asar/libcef 指纹，转 Route E | DIE/rabin2 重新确认 lang |
| 代理抓不到任何流量 | 客户端不读系统代理 / SSL Pinning | Proxifier 强制改向；或 Frida hook 发送函数截明文 | Wireshark 看是否自定义 TCP 协议 |
| Frida 附加即崩溃/检测到 | 客户端有反调试/反注入 | 改用 spawn 模式 `frida -f 目标.exe`；hook 反调试 API 返回假值 | 换静态路线，用 IDA 动态调试器或 x64dbg |
| hook 到 crypto API 但不是目标参数 | 客户端多处用加密 | 在 hook 里打印调用栈 `Thread.backtrace`，按栈过滤业务调用 | 回 Phase 2 用参数名/字符串引用定位业务函数 |
| .NET 反编译出来全是乱名 | 被 ConfuserEx 等混淆 | 先 de4dot 去混淆再反编译 | dnSpy 运行时断点，看实际行为而非静态名 |
| 找到函数但 Frida hook RVA 偏了 | 没加 module.base / ASLR | 用 `Process.getModuleByName().base.add(rva)` | 确认是 .exe 还是被加载的 .dll，模块名要对 |
| 本地复现对不上线上 | 漏了动态字段/密钥派生细节 | 回查密钥来源是否含时间/nonce | 交 reverse-parity-gate 系统排查动态字段 |
| 密钥每次不同 | 运行时派生或会话密钥 | hook 派生函数记录输入链 | 把派生过程也纳入 signer，而非硬编码 key |

---

## 五、交接物 / 下游路由

| 下游 Skill | 何时转交 | 交接物 |
|---|---|---|
| **param-encryptor** | Phase 4 拿到「函数地址 + 样本 + 密钥来源」后，复现算法出 signer | 第三节 Phase 4 的交接清单 |
| **reverse-parity-gate** | param-encryptor 出 signer 后、宣称交付前，逐字节对齐真实样本、排查动态字段 | signer 输出 + Phase 3 真实样本 |
| **web-reverse-master** | Phase 0/2 分流出是 Electron/CEF 且参数在 JS 里（Route E 下沉） | 解包后的 JS 工程 / DevTools 入口 |
| **ast-deobfuscation** | Route E 解出的 JS 被混淆（`_0x`/控制流平坦化/OB） | 混淆 JS 文件 |

**典型调度链：**
```
web-reverse-master 发现 sign 不在浏览器生成（抓包看到是桌面客户端发的）
  → desktop-client-reverse Phase 0 分流：原生 C++ 客户端
  → Phase 1 Proxifier 强制代理确认参数在 native 算
  → Phase 2 rabin2 导入表命中 BCryptEncrypt + AES S-box 常量，收窄到 sub_140012340
  → Phase 3 Frida hook 该地址，抓 3 组 in/out + key/iv
  → Phase 4 交接清单
  → param-encryptor 复现 AES-CBC signer.py
  → reverse-parity-gate 逐字节对齐 → 交付
```

**反向下沉链（Electron）：**
```
desktop-client-reverse Phase 0 → asar 指纹 → Route E asar extract
  → web-reverse-master Phase 2 定位 CryptoJS.AES.encrypt
  → param-encryptor 复现   （native 工具完全不用上）
```

---

## 六、工具清单（全部需手动安装，本技能不自动装、不联网 bootstrap）

| 工具 | 用途 | 安装入口 |
|---|---|---|
| Detect It Easy (DIE) | Phase 0 分流：查类型/壳/编译器 | https://github.com/horsicq/Detect-It-Easy |
| radare2 / rabin2 | 静态侦察、导入表、字节搜、轻量反汇编 | https://github.com/radareorg/radare2/releases |
| IDA Pro | 深度反编译（伪代码），商业 | 官方授权自备 |
| Ghidra | 免费反编译替代 IDA | https://ghidra-sre.org/ |
| Frida | Windows native 动态 hook（主力） | `python3.11 -m pip install frida-tools` |
| dnSpy (dnSpyEx) | .NET 反编译 + 调试 | https://github.com/dnSpyEx/dnSpy/releases |
| ILSpy / ilspycmd | .NET 命令行批量反编译 | `dotnet tool install -g ilspycmd` |
| @electron/asar | Electron asar 解包 | `npm install -g @electron/asar` |
| x64dbg | Windows 用户态调试器（反调试/手动跟） | https://x64dbg.com/ |
| Fiddler / mitmproxy | HTTPS 抓包解密 | Fiddler 官网 / `python3.11 -m pip install mitmproxy` |
| Proxifier | 强制不读代理的进程走代理 | https://www.proxifier.com/ |
| Wireshark | 链路层确认协议/端口/TLS | https://www.wireshark.org/ |

> 关于 MCP：ida-pro-mcp 等只是**可选增强**。本技能主路径用上述命令行 + GUI + Frida 直连即可完成全流程；当前会话未实际暴露对应 MCP 工具时，不调用、不臆造其工具名。
