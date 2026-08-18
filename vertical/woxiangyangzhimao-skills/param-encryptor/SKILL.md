---
name: param-encryptor
description: |
  参数加密器 — 请求参数的加密解密与签名。
  Web逆向加密参数生成器。内置 20+ 加密签名配方：哈希签名（MD5标准/自定义、SHA256、SM3国密、MurmurHash3）、
  对称加密（AES-CBC/ECB/CTR/GCM、DES-ECB、RC4）、非对称加密（RSA-512/1024/2048 PKCS1v1.5）、
  编码混淆（自定义Base64变体、XOR、RC4）、参数组装器（H5ST 10段、a_bogus、mtgsig JSON、x-s签名、MTOP签名）。
  用途：给定目标参数名+明文数据+算法要求，输出加密后的参数值，供Python主脚本直接组装请求。
  纯算优先，补环境仅用于SDK加载场景。
  触发词：「签名」「加密」「encrypt」「sign」「参数生成」「H5ST」「a_bogus」「mtgsig」「签名算法」「加密参数」。
  当逆向流程中需要生成动态签名/加密参数时使用。
  边界：当用户需要分析未知的加密参数（需 Hook+调试定位算法）时，使用 web-reverse-master。
  当加密参数服务于验证码提交流程时，使用 captcha-solver（其内置的 AES/DES/XOR 不转发到本 Skill）。
---

# Param Encryptor · 加密参数纯算生成器

> 基于 30+ 逆向实战项目的加密经验提炼。覆盖国内主流签名方案。
> 核心理念：**明文分析 → 算法识别 → 纯算还原 → 对照验证 → 集成到Python主脚本**
> 纯算优先，只有在SDK复杂度超过手工还原成本时才使用补环境。

---

## 角色规则

**此 Skill 激活后，以加密算法逆向专家身份工作。**

- 加密方式必须通过动态调试实证确认，禁止猜测
- 纯算还原优先（MD5/SHA/AES/RSA直接用Python库）
- 复杂SDK使用Node.js补环境（通过subprocess调用）
- 所有产出必须被Python主脚本调用
- 每个加密函数必须有浏览器输出对照验证

## Phase 映射

本 Skill 在 CLAUDE.md Phase 0-4 工作流中的定位：

| Phase | 本 Skill 的角色 | 与其他 Skill 的协作 |
|-------|----------------|-------------------|
| Phase 0 情报收集 | ❌ 不参与 | — |
| Phase 1 流量分析 | ❌ 不参与 | — |
| Phase 2 定位加密 | ✅ 核心参与：Hook 定位加密函数 + 导出样本 | web-reverse-master 通过 js-reverse-mcp 提供 `search_in_sources` / `break_on_xhr` / `trace_function` |
| Phase 3 方案制定 | ✅ 核心参与：匹配配方 + 确认算法 + 产出 Plan | 配合 env-patcher（如需补环境加载 SDK） |
| Phase 4 代码还原 | ✅ 核心参与：实现 signer.py / signer.js | Python 主脚本调用 |

**典型调用链：**
```
web-reverse-master Phase 2 用 js-reverse-mcp Hook 到 CryptoJS.AES.encrypt
  → param-encryptor Step 3 导出输入输出样本
  → param-encryptor Step 4 匹配配方5(aes-cbc) + 本地对照验证
  → param-encryptor Step 5 集成到 Python 主脚本 signer.py
```

**MCP 工具使用（仅限 Step 2 Hook 阶段）：**
- `js-reverse-mcp.search_in_sources` — 搜加密参数名 + 关键词
- `js-reverse-mcp.break_on_xhr` — 拦截含加密参数的请求
- `js-reverse-mcp.get_paused_info` — 抓调用栈
- `js-reverse-mcp.trace_function` — 追踪加密函数输入输出
- ⚠️ 调用前必须遵守 web-reverse-master 的 Tool Invocation Contract：仅调用当前会话中实际可用的工具

---

## 〇、执行工作流（加密参数分析5步法）

> 每次加密参数还原任务必须按以下5步执行，禁止跳步。

### Step 1: 抓包识别加密字段
**输入**：目标API请求（HAR/浏览器DevTools/Charles抓包）
**输出**：需逆向的加密字段清单
**动作**：
1. 对比请求中的明文参数 vs 加密参数，标记非明文字段
2. 区分静态参数（HTML源码内）vs 动态参数（XHR/Fetch异步生成）
3. 标注加密字段特征：固定长度？Base64格式？Hex格式？分段分隔符？

### Step 2: Hook定位加密函数
**输入**：Step 1 的加密字段名
**输出**：加密函数名 + 所在文件+行号
**动作**：
1. `js-reverse-mcp.search_in_sources` 搜参数名 + 关键词（encrypt/sign/md5/aes/rsa）
2. `js-reverse-mcp.break_on_xhr` 拦截含加密参数的请求
3. `js-reverse-mcp.get_paused_info` 抓调用栈，定位加密入口

🔴 **CHECKPOINT**：定位到加密函数后，必须记录函数名+文件+行号+输入输出样本，再继续。

### Step 3: 导出输入输出样本
**输入**：Step 2 定位的加密函数
**输出**：≥3组明文→密文对照样本
**动作**：
1. `js-reverse-mcp.trace_function` 追踪函数输入输出
2. 或 `js-reverse-mcp.evaluate_script` 手动调用并记录结果
3. 样本必须覆盖：典型输入、空输入、边界输入

### Step 4: 选择配方对照复现
**输入**：Step 3 的样本 + 加密函数特征
**输出**：匹配的配方 + 本地复现结果
**动作**：
1. 根据算法特征（输出长度、格式、密钥模式）在配方库中匹配
2. 本地实现加密函数，用样本对照验证
3. 逐一确认：Key正确？IV正确？Mode正确？Padding正确？

🔴 **CHECKPOINT · 关键门控**：本地输出与浏览器输出**完全一致** → 继续。**不一致** → 进入失败模式表排查，🛑 STOP 禁止直接提交。

### Step 5: 集成到Python主脚本
**输入**：Step 4 验证通过的加密函数
**输出**：signer.py 或 signer.js（被main.py调用）
**动作**：
1. 纯算实现 → 直接写入 signer.py
2. 需补环境 → 写入 signer.js，通过 subprocess 调用
3. 集成到主脚本的请求构造逻辑中
4. 端到端测试：运行主脚本发送真实请求

---

## 一、哈希签名配方

> 对抗服务端多维参数校验（TLS 指纹 / 时间漂移 / 请求间隔 / Header 排序 / 指纹老化 / 请求依赖序）的六层防御参数栈见 references/anti-detection.md，加密算法复现完成后按需取用。

### 配方1: hash-md5（标准MD5）

```python
import hashlib

def md5_sign(data: str) -> str:
    """标准MD5签名"""
    return hashlib.md5(data.encode()).hexdigest()

# 典型用法：
# 工信部 authKey = MD5("testtest" + str(timestamp_ms))
# 饿了么 MTOP sign = MD5(token + "&" + t + "&" + appKey + "&" + data)
# Spider Demo sign = MD5(f"{timestamp}{page}" + salt)
```

### 配方2: hash-md5-custom（京东自定义MD5）

```python
# 京东H5ST SDK魔改MD5
# 特征：SDK MD5("hello") != 标准 MD5("hello")
# 处理：直接加载原始SDK的CryptoJS模块
# 参考：sites/jd_search/assets/js/js_security_v3_0.1.6.js（参考实现）
```

**🔴 重要**：遇到标准MD5输入但输出与`hashlib.md5()`不一致时 → 100%是自定义MD5，必须加载原始SDK。

### 配方3: hash-sm3（国密SM3）

```python
# 抖音A-Bogus专用
try:
    from gmssl import sm3  # pip install gmssl
    def sm3_hash(data: str) -> list:
        return sm3.sm3_hash(bytes(data, 'utf-8'))
except ImportError:
    # 纯Python SM3实现（参考 sites/douyin_abogus/abogus_local.py，参考实现）
    pass
```

### 配方4: hash-murmur3（MurmurHash3 x64 128）

```python
# 顶象Verify5设备指纹哈希
# 纯Python实现，与fingerprintjs v2对齐
def murmur_hash_128(key: str, seed: int = 0) -> str:
    """MurmurHash3 x64_128"""
    # 完整实现参考 sites/verify5/src/core/crypto.py（参考实现）
```

---

## 二、对称加密配方

### 配方5: aes-cbc（AES-128-CBC）

```python
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
import base64

def aes_cbc_encrypt(data: str, key: bytes, iv: bytes = b'0000000000000000') -> str:
    """AES-128-CBC + PKCS7 + Base64
    默认IV: 16个ASCII '0'（极验标准）
    """
    cipher = AES.new(key, AES.MODE_CBC, iv)
    encrypted = cipher.encrypt(pad(data.encode(), 16))
    return base64.b64encode(encrypted).decode()

# 变体：
# 极验3/4：IV=b'0'*16，随机key 16字节
# 工信部点选：固定key="abcdefgabcdefg12"，AES/ECB/PKCS7
# 大众点评：key/IV来自设备指纹b[0]
```

### 配方6: aes-ctr（AES-256-CTR）

```python
# 顶象Verify5专用
from Crypto.Cipher import AES
from Crypto.Util import Counter

def aes_ctr_encrypt(data: bytes, key: bytes, nonce: bytes) -> bytes:
    ctr = Counter.new(128, initial_value=int.from_bytes(nonce, 'big'))
    cipher = AES.new(key, AES.MODE_CTR, counter=ctr)
    return cipher.encrypt(data)
```

### 配方7: aes-gcm（AES-GCM）

```python
# 京东jcap / 字节rmc-captcha专用
# 通常在WASM内部完成，需通过Node.js桥接
```

### 配方8: des-ecb（DES-ECB·数美专用）

> ⚠️ **数美验证码场景**：`captcha-solver` 配方9 提供了相同的 DES-ECB 实现及12个固定密钥字典，可直接用于验证码提交流程。本配方覆盖非验证码的 DES-ECB 场景。

```python
# 12个参数各自独立DES-ECB加密
# 密钥固定8字节ASCII，数美密钥字典见 captcha-solver 配方9
# 零填充（非PKCS7）
from Crypto.Cipher import DES

def des_ecb_encrypt(data: str, key: bytes) -> str:
    data_bytes = data.encode()
    pad_len = 8 - len(data_bytes) % 8
    data_bytes += b'\x00' * pad_len
    cipher = DES.new(key, DES.MODE_ECB)
    return base64.b64encode(cipher.encrypt(data_bytes)).decode()
```

### 配方9: rc4（RC4·抖音专用）

```python
def rc4_encrypt(plaintext: str, key: str = "y") -> str:
    """RC4加密，抖音A-Bogus固定key='y'"""
    S = list(range(256))
    j = 0
    for i in range(256):
        j = (j + S[i] + ord(key[i % len(key)])) % 256
        S[i], S[j] = S[j], S[i]
    result = []
    i = j = 0
    for k in range(len(plaintext)):
        i = (i + 1) % 256
        j = (j + S[i]) % 256
        S[i], S[j] = S[j], S[i]
        result.append(chr(S[(S[i] + S[j]) % 256] ^ ord(plaintext[k])))
    return ''.join(result)
```

---

## 三、非对称加密配方

### 配方10: rsa-pkcs1（RSA PKCS1v1.5）

```python
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_v1_5
import base64

def rsa_encrypt(data: str, public_key_b64: str) -> str:
    """RSA PKCS1v1.5 加密 + Base64
    典型用途：密码加密（B站/京东/丰巢）、AES密钥传输（极验）
    """
    der_key = base64.b64decode(public_key_b64)
    key = RSA.import_key(der_key)
    cipher = PKCS1_v1_5.new(key)
    encrypted = cipher.encrypt(data.encode())
    return base64.b64encode(encrypted).decode()

# 变体：
# B站密码：plaintext = hash_salt + raw_password
# 极验w后缀：RSA(AES密钥).hex()（注意输出hex非base64）
# 极验固定公钥N和E=65537
```

---

## 四、自定义编码配方

### 配方11: base64-custom-douyin（抖音自定义Base64）

```python
# 5套字符表 s0-s4
S1 = "Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe="
S2 = "Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe="
S4 = "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe"
```

### 配方12: base64-custom-geetest（极验自定义Base64）

```python
# 字符集替换：+→(, /→)
# 位掩码：[7274496, 9483264, 19220, 235]
# 完整实现参考 sites/bilibili_login/src/geetest_crypto.js（参考实现）
```

### 配方13: xor-encode（XOR编码）

```python
# 网易易盾专用：token作密钥XOR编码
def xor_encode(token: str, data: str) -> str:
    return ''.join(chr(ord(c) ^ ord(token[i % len(token)])) for i, c in enumerate(data))
```

---

## 五、参数组装器配方

### 配方14: h5st-assembler（京东H5ST 10段组装器）

```
格式：datetime;fp;appId;token;signHash;version;timestamp;expandParams;bodyHash;eidHash

生成流程：
1. _$cps: 参数排序为key-value数组
2. _$pam: 校验token/fingerprint
3. _$clt: 生成随机fp + 指纹数据
4. _$gdk: 密钥派生（token→自定义哈希链）
5. _$gs: 生成signHash（自定义MD5）
6. _$gsd: 生成bodyHash（自定义MD5）
7. _$gsp: 组装h5st字符串

⚠️ 关键：H5ST使用自定义CryptoJS，标准MD5/SHA256输出不一致
   → 必须加载原始SDK js_security_v3_0.1.6.js

实现参考：sites/jd_search/src/signer.js（参考实现）, sites/h5st533商详/h5st5_3_3.js（参考实现）
```

### 配方15: abogus-assembler（抖音A-Bogus生成器）

```
格式：前缀(random) + Base64(RC4(SM3(params)))

生成流程：
1. URL参数 + "cus" → SM3哈希 → params_array
2. HTTP方法 + "cus" → SM3哈希 → method_array
3. 浏览器信息 → charCode数组
4. 时间戳相关参数
5. 组合 → RC4加密(key="y") → 自定义Base64编码(s1/s2/s4字符表)
6. 加上随机前缀

纯Python实现：<1ms
参考：sites/douyin_abogus/abogus_local.py（参考实现）
```

### 配方16: mtgsig-assembler（大众点评mtgsig）

```
格式：HTTP Header mtgsig: JSON{a1,a2,a3,a5,a6,a8,a9,a10,x0,d1}

生成流程：
1. aS VM加载字节码 → 计算a8/a5/a6
2. 纯算修复a9/d1
3. a1=签名版本, a2=时间戳, a3=随机UUID
4. x0=设备指纹数据
5. d1 = MD5(concat) XOR temp_array

⚠️ 当前状态：VM可产出签名，但服务器端验证403
参考：sites/dianping/src/hybrid_signer.js（参考实现） + aS_vm.js（参考实现）
```

### 配方17: mtop-signer（饿了么MTOP签名）

```python
def mtop_sign(token: str, t: str, app_key: str, data: str) -> str:
    """MTOP签名 = MD5(token + "&" + t + "&" + appKey + "&" + data)"""
    import hashlib
    raw = f"{token}&{t}&{app_key}&{data}"
    return hashlib.md5(raw.encode()).hexdigest()

# token: Cookie _m_h5_tk 的 "_" 前缀部分
# t: 13位毫秒时间戳
# appKey: 固定 "12574478"
# data: POST body中data字段的原始JSON字符串
```

---

## 六、方案选择决策树

```
加密参数分析：
├─ 标准算法？
│   ├─ MD5/SHA → Python hashlib 直接算
│   ├─ AES-CBC/ECB → pycryptodome
│   ├─ RSA → pycryptodome PKCS1_v1_5
│   └─ RC4/XOR → 手写实现
│
├─ 自定义变体？
│   ├─ 自定义Base64 → 识别字符表替换，手写编解码
│   ├─ 自定义MD5 → 加载原始SDK的CryptoJS模块
│   └─ 自定义哈希链 → 分析SDK密钥派生逻辑
│
└─ 复杂SDK/VM？
    ├─ JS SDK → Node.js subprocess 加载
    ├─ WASM → Node.js桥接 或 IdaPro分析
    └─ VM字节码 → vm-decoder skill 还原
```

---

## 失败模式编码

| 症状 | 原因 | 一线修复 | 仍失败兜底 |
|------|------|---------|-----------|
| 签名与服务端不匹配 | 自定义算法变体 | Hook加密函数对比输入输出 | 加载原始SDK |
| Python MD5 != 浏览器MD5 | 魔改CryptoJS | 导出SDK内部MD5对比 | 全套SDK补环境 |
| AES解密结果乱码 | Key/IV/Mode/Padding不匹配 | 逐项验证四个要素 | 抓包对比密文长度 |
| RSA加密后服务端拒绝 | 公钥/填充方式错误 | 检查PKCS1v1.5 vs OAEP | 检查是否需要分段加密 |
| 自定义Base64解码失败 | 字符表/位掩码不同 | 导出字符表逐字符对比 | 6种已知变体逐一尝试 |
| H5ST签名失效 | SDK版本更新 | 下载最新js_security_v3 | diff分析改动点 |

---

## 反模式黑名单

| # | 不要做 | 替代 |
|---|--------|------|
| 1 | 猜测加密密钥/IV | 必须Hook实证确认 |
| 2 | 假设是标准AES | 先对比浏览器输出再选算法 |
| 3 | 跳过对照验证 | 每个加密函数必须有浏览器vs本地对照 |
| 4 | 全部补环境 | 简单算法优先纯算，省维护成本 |
| 5 | 硬编码密钥到代码 | 从接口动态获取或配置文件管理 |
| 6 | 忽略时间戳精度 | 毫秒级vs秒级必须与服务端一致 |

---

## 依赖清单

```
# Python（纯算）
pip install pycryptodome gmssl requests loguru

# Node.js（补环境）
npm install jsdom  # DOM环境模拟
```

---

## Related Skills

| Skill | 职责 | 何时调用 |
|-------|------|---------|
| `web-reverse-master` | 全流程编排 | 需要分析未知加密参数（Hook+调试定位算法） |
| `captcha-solver` | 验证码求解 | 加密参数服务于验证码提交流程（captcha-solver 内置 AES/DES/XOR） |
| `env-patcher` | 补环境生成 | 需要让加密 SDK 在 Node.js 中运行 |
| `ast-deobfuscation` | JS 反混淆 | 加密函数被混淆需先还原 |
