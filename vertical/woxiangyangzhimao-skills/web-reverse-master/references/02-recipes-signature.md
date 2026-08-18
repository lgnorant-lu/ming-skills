# 签名与加密配方详解

## 配方1：MD5/SHA 签名

### 识别
- 输出：32位（MD5）/ 40位（SHA1）/ 64位（SHA256）hex字符串
- 参数中常见：`sign`、`token`、`hash`

### 步骤

**Step 1：浏览器Hook提取salt**
```javascript
// MCP: js-reverse-mcp → evaluate_script
// 在调用md5的位置打印所有参数

// 方法A：直接在控制台搜索md5调用
// 搜索: md5( → 找到所有md5调用点
// 在每个调用点添加: console.log('md5 input:', arguments)

// 方法B：Hook CryptoJS
const origMD5 = CryptoJS.MD5;
CryptoJS.MD5 = function(msg) {
    console.log('[Hook] MD5 input:', msg.toString());
    return origMD5.call(this, msg);
};
```

**Step 2：分析输入格式**
```
常见MD5输入模式：
- md5(timestamp + page + salt)           → spiderdemo
- md5(clientIp + checkId + uuid + track) → fcbox滑块
- md5(params + appSecret)                → 通用API签名
- md5(body + timestamp + token)          → 请求体签名
```

**Step 3：Python复现** — 使用 `hashlib.md5/sha1/sha256`，注意 salt 可能是字节串（`b"..."`）而非字符串。

### 常见错误
- salt是字节串不是字符串（需用 `b"..."`）
- 参数拼接顺序错误
- 忘记URL编码参数

---

## 配方2：AES 加密

### 识别
- 输出：Base64字符串（通常以 `=` 结尾）
- 代码中：`CryptoJS.AES.encrypt` / `forge.cipher.createCipher`
- 参数中：`data`、`encData`、`password`、`collectData`

> 完整 Python 实现参见 param-encryptor 配方5(aes-cbc)、配方6(aes-ctr)、配方7(aes-gcm)

### 常见错误

| 错误 | 原因 | 修正 |
|------|------|------|
| 解密后末尾有乱码 | padding模式不对 | PKCS7 vs ZeroPadding |
| 密文长度不对 | IV未参与或模式用错 | 确认CBC/ECB |
| 结果与浏览器不同 | 密钥编码方式不同 | 浏览器key是hex还是utf8？ |
| 只能解密第一块 | IV没有正确传入 | 确认IV值 |

---

## 配方3：RSA 加密

### 识别
- 输出：Base64，长度344（2048bit）或684（4096bit）
- 代码中：`RSAKey`、`jsrsasign`、`setPublicKey`、`encrypt`
- 参数中：`encSecKey`、`key`、`encryptedKey`

> 完整 Python 实现参见 param-encryptor 配方10(rsa-pkcs1)

### 常见模式

```
// 混合加密模式（最常见）：
1. 前端生成随机AES密钥
2. AES加密数据体 → collectData
3. RSA公钥加密AES密钥 → key
4. POST: {data: collectData, key: encryptedAESKey}
```

---

## 配方4：WASM 本地执行

### 识别
- 请求参数：`wasm_auth`、`sign`
- 代码：`WebAssembly.instantiate`、`wasm_bindgen`
- 文件：`.wasm` 扩展名

### 步骤

**Step 1：下载WASM文件**
```
从Network面板找到.wasm文件 → 下载到本地
同时下载配套的JS glue文件（wasm_bindgen生成的.js）
```

**Step 2：Node.js本地执行**
```javascript
// wasm_solver.mjs
import init, { encrypt_simple } from './wasm_anti.js';
import { readFileSync } from 'fs';

const wasmBuffer = readFileSync('./wasm_anti_bg.wasm');
await init(wasmBuffer);

// 调用WASM导出函数
const verifyString = "wasm_challenge_page_1";
const timestamp = Math.floor(Date.now() / 1000);
const auth = encrypt_simple(verifyString, timestamp);
console.log(JSON.stringify({ auth }));
```

**Step 3：Python调用**
```python
import subprocess, json

def get_wasm_auth(verify_string, timestamp=None):
    """调用Node.js生成WASM签名"""
    if timestamp is None:
        timestamp = int(__import__('time').time())
    result = subprocess.run(
        ['node', 'wasm_assets/wasm_solver.mjs'],
        capture_output=True, text=True, cwd='sites/spiderdemo/src'
    )
    return json.loads(result.stdout)['auth']
```

### 关键优势
- 完全脱离浏览器，无反调试风险
- Node.js 22.x 原生支持 WebAssembly

---

## 配方5：webpack模块签名

### 识别
- 代码结构：`webpackJsonp`、`__webpack_require__`
- JS文件名：`chunk_xxxx.js`

### 步骤

**Step 1：定位模块**
```javascript
// 在浏览器中找到目标模块ID
// MCP: js-reverse-mcp → evaluate_script
// 搜索 webpack 模块缓存
for (let key in window.__webpack_require__.c) {
    let mod = window.__webpack_require__.c[key];
    if (mod.exports && mod.exports.default) {
        let src = mod.exports.default.toString();
        if (src.includes('encrypt') || src.includes('anti_content')) {
            console.log('Found:', key, src.substring(0, 200));
        }
    }
}
```

**Step 2：Node.js扣代码**
```javascript
// env/browser.js - 最小环境stub
const vm = require('vm');
const context = {
    window: {},
    navigator: { userAgent: "...", platform: "Win32" },
    document: { cookie: "", createElement: () => ({}) },
    self: {},
    location: { href: "https://mobile.yangkeduo.com/" },
};
vm.createContext(context);
// ... 加载webpack chunk → 调用目标模块
```

**Step 3：Python通过stdin/stdout通信**
```python
import subprocess, json

proc = subprocess.Popen(
    ['node', 'runner.js'],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    text=True
)

# 发送请求 → 接收anti_content
proc.stdin.write(json.dumps({"action": "sign", "params": {...}}) + "\n")
proc.stdin.flush()
result = json.loads(proc.stdout.readline())
anti_content = result['anti_content']
```

---

## 配方6：curl_cffi TLS指纹

### 适用场景
- 登录态可复用
- 服务端校验TLS指纹（JA3/JA4）
- 不想补环境或逆算法

### 使用
```python
from curl_cffi import requests

session = requests.Session()
# 模拟Chrome的TLS指纹
resp = session.get("https://xxx.com/api/data", 
                   impersonate="chrome131",
                   headers={"Cookie": "wt2=...; zp_at=..."})
```

### 注意事项
- 必须配合正确的Cookie
- headers要完整（sec-ch-ua, sec-fetch-*等）
- 代理IP质量影响成功率
- 支持 `chrome131`/`chrome124`/`safari17_0` 等多种指纹
- `pip install curl_cffi`（不是 `pip install curl-cffi`）

---

## 配方7：自定义Base64编码

### 识别
- 输出看起来像Base64但解码失败
- 代码中有 `lookup` 数组且顺序非标准
- 标准Base64表：`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/`
- 自定义表：表字符相同但顺序不同

### 常见场景
- 小红书 X-s 签名：自定义 lookup 表编码
- 小红书 X-s-common：同样使用自定义表
- 部分网站的加密参数二次编码

### 步骤

**识别自定义表**：搜索编码函数附近的 64 字符数组（包含 A-Z, a-z, 0-9, +, /），字符相同但顺序不同于标准 Base64 表。

> 完整字符表和实现参见 param-encryptor 配方11(base64-custom-douyin)、配方12(base64-custom-geetest)

---

---

## 配方8：国密 SM2/SM4

### 适用场景
- 中国政府网站、医保服务、信用中国等
- 代码中出现 `sm2`、`SM2`、`sm4`、`SM4`
- `encType: "SM4"` 或 `sign_type: "SM2"`

### SM2（非对称，类似ECC）

**识别**：
- 返回值通常包含两个大整数字符串（r, s）
- 签名而非加密
- 输出格式：C1C3C2 或 C1C2C3

**Python实现**：
```python
from gmssl import sm2, func

# SM2 签名
private_key = '00b9ab0b828ff68872f21a837fc303668428de...'
public_key = 'b9ab0b828ff68872f21a837fc303668428de11d9...'
sm2_crypt = sm2.CryptSM2(public_key=public_key, private_key=private_key)

# 签名
sign_data = sm2_crypt.sign(data_bytes, func.random_hex(sm2_crypt.para_len))
# 返回: (r, s) 两个大整数字符串

# 加密（SM2公钥加密）
enc_data = sm2_crypt.encrypt(data_bytes)
# 返回: C1C3C2 格式的 hex 字符串
```

### SM4（对称，类似AES）

**识别**：
- 128位分组，128位密钥
- 模式：ECB、CBC
- 填充：PKCS7
- 输出：hex 或 base64

**Python实现**：
```python
from gmssl.sm4 import CryptSM4, SM4_ENCRYPT, SM4_DECRYPT
import base64

# SM4 CBC 加密
key = bytes.fromhex("0123456789ABCDEFFEDCBA9876543210")
iv = bytes.fromhex("00000000000000000000000000000000")

crypt_sm4 = CryptSM4()
crypt_sm4.set_key(key, SM4_ENCRYPT)

# PKCS7 填充
pad_len = 16 - len(data_bytes) % 16
data_bytes += bytes([pad_len] * pad_len)

ciphertext = crypt_sm4.crypt_cbc(iv, data_bytes)
result = base64.b64encode(ciphertext).decode()
```

### 常见错误
- SM2和SM4库的hex格式要求（有无`0x`前缀、`04`公钥前缀）
- SM2的C1C2C3 vs C1C3C2输出顺序
- 注意 `pip install gmssl` 不是 `pip install gmssl-pyx`（后者已弃用）

---

## 配方9：瑞数/Akamai/加速乐 Cookie 对抗

### 瑞数 RS5/RS6

**特征**：
- Cookie名带动态后缀，如 `FSSBBIl1UgzbN7NXXT`、`goN9uW4i0iKzO`
- 首次访问返回 412 状态码 + JS 生成 Cookie
- RS5: 后缀静态；RS6: 后缀动态（每次不同）

**流程**：
```
1. GET 目标页面 → 412 + Cookie 生成 JS
2. 提取 JS 代码（通常在 <script> 或内联中）
3. 在 Node.js 中补环境执行该 JS
4. 获取生成的 Cookie 值（通常有固定有效期）
5. 携带 Cookie 重新请求目标接口
```

**Python实现框架**：
```python
import subprocess, json, requests

# 步骤1: 获取412响应中的JS
resp = requests.get("https://target.com/", headers=headers)
if resp.status_code == 412:
    js_code = extract_js_from_html(resp.text)
    with open("rs_cookie.js", "w") as f:
        f.write(js_code)

# 步骤2: Node.js补环境执行
result = subprocess.run(
    ["node", "env_runner.js", "--input", "rs_cookie.js"],
    capture_output=True, text=True
)
cookie_data = json.loads(result.stdout)
# {"cookie_name": "FSSBBIl1UgzbN7NXXT", "cookie_value": "..."}

# 步骤3: 携带Cookie重新请求
session = requests.Session()
session.cookies.set(cookie_data["cookie_name"], cookie_data["cookie_value"])
resp = session.get("https://target.com/api/data")
```

### Akamai

**特征**：
- Cookie名：`reese84`、`ak_bmsc`、`bm_sv`
- 类似瑞数，也是首次访问返回JS生成Cookie

**方案**：curl_cffi impersonate + Cookie 维持是最优解
```python
from curl_cffi import requests
resp = requests.get(url, impersonate="chrome131")
# 自动处理TLS + Cookie
```

### 加速乐/百度云防护

**特征**：
- Cookie名：`__jsluid_s`、`__jsl_clearance`
- 重定向 + JS计算 + Set-Cookie

**步骤**：
1. 首次请求 → 302重定向 + JS跳转码
2. 提取JS中的计算逻辑（通常简单的eval或数学运算）
3. 执行JS → 得到URL参数和Cookie
4. 携带Cookie访问最终页面

---

## 配方10：京东 h5st 多段签名（纯算）

### 适用场景
- 京东系全平台（search.jd.com、item.jd.com、api.m.jd.com 等）
- 接口需要 `h5st` 参数才能返回正常数据
- 签名格式：`timestamp;fp;appId;tk;md5_hash;version;ts;expandParams`

### h5st 8段结构

```
h5st = p1;p2;p3;p4;p5;p6;p7;p8

p1: 时间戳格式化  YYYYMMDDHHmmssuuu（17位，含微秒）
p2: 指纹(fp)      16位随机hex，首次生成后缓存
p3: appId         平台标识（如 search.jd.com → "76ef7"）
p4: tk            从 cactus.jd.com/request_algo 接口获取的 token
p5: 签名           MD5(t + query_string + t)，t 由 algo 函数计算
p6: 版本号         "4.7" / "5.2" 等
p7: 时间戳毫秒     Date.now()
p8: expandParams   AES-CBC加密的环境参数（浏览器指纹信息）
```

### 完整实现 — 参考开源项目

> GitHub: [dengbaikun/jdh5st](https://github.com/dengbaikun/jdh5st)、[ShilongLee/Crawler](https://github.com/ShilongLee/Crawler)

> 完整组装器实现参见 param-encryptor 配方14(h5st-assembler)

### 关键注意事项

1. **tk 有时效性**：cactus 返回的 tk 通常 30-60 分钟过期，需在请求前实时获取
2. **algo 函数频繁更新**：京东定期更新 algo 逻辑，纯算方案需要跟进维护
3. **指纹 fp 一致性**：同一会话内 fp 必须保持一致，否则被风控
4. **expandParams 加密密钥**：需要从 JS 源码中提取，不同 appId 可能不同
5. **curl_cffi 配合**：京东有 TLS 指纹检测，强烈建议使用 curl_cffi:
```python
from curl_cffi import requests as cffi_requests
resp = cffi_requests.get(url, headers=headers, impersonate="chrome131")
```

### 备选方案

- **Docker 镜像方案**：GitHub 上有完整 h5st 算法的 Docker 镜像，`docker pull xxx/jd-h5st`
- **CDP 桥方案**（推荐生产环境）：浏览器内执行 JS 自动签名，免除算法维护
- **ShilongLee/Crawler**：完整的多平台爬虫服务，包含京东 h5st

---

## 配方11：抖音 a_bogus / X-Bogus JSVMP 纯算

### 适用场景
- 抖音全系（douyin.com、直播、巨量百应、抖音小店等）
- 接口需要 `a_bogus` 或 `X-Bogus` 参数
- JSVMP 虚拟机保护的签名参数

### 参数关系

```
a_bogus:  URL参数签名（GET请求的query string签名）
X-Bogus:  Header签名（POST请求的body签名 + Header参数）
_signature: 部分接口的额外签名

三者关系：a_bogus ≈ X-Bogus（算法核心相同，应用位置不同）
          _signature 是另一个独立的签名字段
```

### 算法核心（JSVMP 插桩还原法）

> 参考：GitHub [jackluson/a_bogus_douyin](https://github.com/jackluson/a_bogus_douyin)、[G-catmint/douyin](https://github.com/G-catmint/douyin)、[ShilongLee/Crawler](https://github.com/ShilongLee/Crawler)

> 完整 RC4 和 SM3 实现参见 param-encryptor 配方9(rc4)、配方3(hash-sm3)、配方15(abogus-assembler)

### JSVMP 插桩还原核心步骤

```
1. 定位 VM 入口
   → Function.prototype.apply 条件断点（返回值长度 ~200 字符）

2. 插桩收集字节码
   → 在 VM 解释器循环中打印每条指令的 opcode + operands
   → 记录执行轨迹

3. 分析字节码 → 还原算法
   → 识别 RC4 特征：256 字节 S盒 + swap 操作
   → 识别 SM3 特征：8个32位初始向量（IV）
   → 识别编码层：魔改 Base64 或 hex 编码

4. Python 复现
   → 翻译字节码为 Python 代码
   → 逐函数验证中间值一致性
```

### 完整开源参考

| 项目 | 地址 | 说明 |
|------|------|------|
| jackluson/a_bogus_douyin | https://github.com/jackluson/a_bogus_douyin | 在线签名服务 + Workers 部署 |
| G-catmint/douyin | https://github.com/G-catmint/douyin | JSVMP 纯算法还原，含 captchaBody/滑块 |
| ShilongLee/Crawler | https://github.com/ShilongLee/Crawler | 多平台爬虫（含抖音），Docker 一键部署 |
| TRHX/X-Bogus 分析 | https://www.itbob.cn/article/056 | 详细逆向分析文章 |

### 关键注意事项

1. **签名算法频繁更新**：抖音每个月可能更新 JSVMP 字节码，纯算方案需要持续维护
2. **msToken 依赖**：部分接口需要 `msToken`（从 cookie 或单独接口获取）
3. **IP 风控**：抖音有严格的 IP 频率限制，建议配合代理池
4. **补环境备选**：如果纯算成本太高，可以考虑补环境方案（Node.js vm + 签名 JS）
5. **CDP 桥终极方案**：在 AdsPower 浏览器中执行 JS 自动签名，免除算法维护

---

## 配方12：HMAC-SHA256 及 ECDSA 签名

### HMAC-SHA256 签名

#### 识别
- 输出：64位 hex 字符串
- 代码中：`CryptoJS.HmacSHA256`、`forge.hmac`、`hmacSha256`
- 参数中：`signature`、`hmac`、`auth`

#### Python 实现

```python
import hmac
import hashlib
import base64

# === 模式1: HMAC-SHA256 → hex ===
def hmac_sha256_hex(key: str, message: str) -> str:
    """HMAC-SHA256 签名，输出hex"""
    return hmac.new(
        key.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

# === 模式2: HMAC-SHA256 → Base64 ===
def hmac_sha256_b64(key: str, message: str) -> str:
    """HMAC-SHA256 签名，输出Base64"""
    digest = hmac.new(
        key.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).digest()
    return base64.b64encode(digest).decode()

# === 模式3: HMAC-SHA256 → 字节串（常见于拼多多 anti_content） ===
def hmac_sha256_bytes(key: bytes, message: bytes) -> bytes:
    """HMAC-SHA256 签名，输出原始字节"""
    return hmac.new(key, message, hashlib.sha256).digest()

# === 验证浏览器输出 ===
# browser_output = "a1b2c3d4..."  # 从Hook捕获
# local = hmac_sha256_hex("my_secret_key", "timestamp=123&data=hello")
# assert local == browser_output
```

#### 常见拼接模式

```python
# 模式A: 简单拼接
message = f"timestamp={ts}&body={json.dumps(data)}"
sign = hmac_sha256_hex(secret_key, message)

# 模式B: 有序拼接 + URL编码
from urllib.parse import urlencode
params = {"timestamp": ts, "body": json.dumps(data), "app_id": "10001"}
message = urlencode(sorted(params.items()))
sign = hmac_sha256_b64(secret_key, message)

# 模式C: 多层哈希
step1 = hashlib.md5(json.dumps(data).encode()).hexdigest()
message = f"{ts}{step1}{nonce}"
sign = hmac_sha256_hex(secret_key, message)
```

---

### ECDSA 椭圆曲线签名

#### 适用场景
- 微信支付 APIv3 签名
- 部分区块链/Web3 应用的签名
- Apple 登录、Google 登录的 JWT 验证
- 某些现代 Web 应用的请求签名

#### 识别特征
- 代码中：`ECDSA`、`secp256k1`、`secp256r1`、`ecdsa.sign`
- 密钥格式：`-----BEGIN EC PRIVATE KEY-----`
- 签名输出：`r` 和 `s` 两个大整数（各32字节），组成64字节签名

#### Python 实现

```python
# pip install ecdsa cryptography

# ===== 方案A: 使用 ecdsa 库 =====
from ecdsa import SigningKey, VerifyingKey, NIST256p, SECP256k1
import hashlib
import base64

def ecdsa_sign_p256(private_key_hex: str, message: str) -> str:
    """使用 P-256 (secp256r1) 曲线签名
    
    Args:
        private_key_hex: 私钥的hex字符串（64个hex字符 = 32字节）
        message: 待签名消息
    Returns:
        Base64编码的签名（64字节 → 88字符Base64）
    """
    sk = SigningKey.from_string(
        bytes.fromhex(private_key_hex),
        curve=NIST256p
    )
    # 先对消息做 SHA256 哈希
    msg_hash = hashlib.sha256(message.encode()).digest()
    signature = sk.sign(msg_hash)
    return base64.b64encode(signature).decode()

def ecdsa_sign_secp256k1(private_key_hex: str, message: str) -> str:
    """使用 secp256k1 曲线签名（比特币/以太坊用）"""
    sk = SigningKey.from_string(
        bytes.fromhex(private_key_hex),
        curve=SECP256k1
    )
    msg_hash = hashlib.sha256(message.encode()).digest()
    signature = sk.sign(msg_hash)
    return signature.hex()  # 返回 hex


def ecdsa_verify(public_key_hex: str, message: str, signature_b64: str) -> bool:
    """验证 ECDSA 签名"""
    vk = VerifyingKey.from_string(
        bytes.fromhex(public_key_hex),
        curve=NIST256p
    )
    signature = base64.b64decode(signature_b64)
    msg_hash = hashlib.sha256(message.encode()).digest()
    try:
        return vk.verify(signature, msg_hash)
    except:
        return False


# ===== 方案B: 使用 cryptography 库（推荐） =====
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.backends import default_backend

def ecdsa_sign_cryptography(private_key_pem: str, message: str) -> bytes:
    """使用 cryptography 库的 ECDSA 签名
    
    Args:
        private_key_pem: PEM格式私钥
        message: 待签名消息
    Returns:
        DER编码的签名（二进制）
    """
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode(),
        password=None,
        backend=default_backend()
    )
    signature = private_key.sign(
        message.encode(),
        ec.ECDSA(hashes.SHA256())
    )
    return signature


def ecdsa_sign_browser_style(private_key_hex: str, data: str) -> dict:
    """模拟浏览器中 Web Crypto API 的 ECDSA 签名
    
    浏览器端：
      crypto.subtle.sign({name: "ECDSA", hash: "SHA-256"}, key, data)
    
    Python 复现：
    """
    from ecdsa import SigningKey, NIST256p
    import hashlib
    
    # 加载私钥
    sk = SigningKey.from_string(
        bytes.fromhex(private_key_hex),
        curve=NIST256p
    )
    
    # Web Crypto API 直接对原始数据签名（不预先哈希）
    signature = sk.sign(data.encode(), hashfunc=hashlib.sha256)
    
    # 返回 r 和 s 分量
    r = int.from_bytes(signature[:32], 'big')
    s = int.from_bytes(signature[32:], 'big')
    
    return {
        "r": hex(r)[2:],
        "s": hex(s)[2:],
        "signature": signature.hex()
    }


# === 使用示例 ===
if __name__ == "__main__":
    # 示例私钥（测试用，不要用于生产）
    test_pk = "c9a1f8e2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0"
    
    message = "timestamp=1700000000&method=POST&path=/api/data"
    
    # P-256 签名
    sig = ecdsa_sign_p256(test_pk, message)
    print(f"ECDSA P-256 Signature (Base64): {sig}")
    
    # Secp256k1 签名
    sig_hex = ecdsa_sign_secp256k1(test_pk, message)
    print(f"ECDSA Secp256k1 Signature (hex): {sig_hex}")
    
    # 浏览器风格
    result = ecdsa_sign_browser_style(test_pk, message)
    print(f"r: {result['r']}")
    print(f"s: {result['s']}")
```

#### 常见曲线选择

| 曲线 | 用途 | Python 库 |
|------|------|----------|
| P-256 (secp256r1) | Web Crypto API 默认 | `ecdsa` NIST256p |
| P-384 (secp384r1) | 高安全性场景 | `ecdsa` NIST384p |
| secp256k1 | 比特币/以太坊 | `ecdsa` SECP256k1 |
| Curve25519 | 现代应用（TLS 1.3） | `nacl` / `cryptography` |

#### 验证对齐

```python
# 从浏览器 Hook 捕获的签名样本
browser_sig_b64 = "MEUCIQDx..."  # DER编码的Base64
browser_message = "test_data"
browser_pubkey_hex = "04a1b2c3..."  # 04前缀 = 未压缩公钥

# 本地验证
assert ecdsa_verify(browser_pubkey_hex, browser_message, browser_sig_b64), \
    "ECDSA 签名验证失败！"
print("[PASS] ECDSA 签名算法确认")
```

---

## 配方13：Protobuf/gRPC 请求体编解码

### 适用场景
- 请求体/响应体是二进制 Protobuf 格式
- Content-Type: `application/x-protobuf` 或 `application/grpc+proto`
- 常见于：抖音直播弹幕、B站 gRPC 接口、部分 App 的 WebSocket 通信

### 识别特征
- 请求 body 是二进制（非 JSON/Form）
- URL 路径包含 `/grpc/` 或 `.proto` 字样
- Response headers 中有 `grpc-status`、`grpc-message`
- 代码中出现 `protobuf`、`proto`、`serializeBinary`

### 步骤

**Step 1：下载 .proto 定义文件**

```
方法A：从网页源码/JS中搜索
  → 搜索 ".proto" 关键字
  → 搜索 "syntax = \"proto3\"" 字符串

方法B：从 Network 面板获取
  → 找到二进制请求 → 查看 Initiator → 追踪到加载的 JS
  → JS 中通常有 protobuf 的 message 定义或引用

方法C：GitHub 搜索
  → 搜索 "站点名 proto" 或 "站点名 protobuf"
```

**Step 2：编译 .proto 文件**

```bash
# 安装 protoc 编译器
pip install protobuf grpcio-tools

# 编译 proto 文件为 Python
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. douyin.proto
# 生成: douyin_pb2.py（消息类） 和 douyin_pb2_grpc.py（gRPC 服务类）
```

**Step 3：Python 编解码**

```python
# protobuf_codec.py — Protobuf 编解码工具
import base64
from google.protobuf.json_format import MessageToDict, ParseDict

def decode_protobuf(data: bytes, MessageClass):
    """将 Protobuf 二进制数据解码为 Python 对象"""
    msg = MessageClass()
    msg.ParseFromString(data)
    return msg

def protobuf_to_json(data: bytes, MessageClass) -> dict:
    """Protobuf 二进制 → JSON dict"""
    msg = MessageClass()
    msg.ParseFromString(data)
    return MessageToDict(msg, preserving_proto_field_name=True)

def encode_protobuf(data: dict, MessageClass) -> bytes:
    """将 dict 编码为 Protobuf 二进制"""
    msg = ParseDict(data, MessageClass())
    return msg.SerializeToString()


# === 处理 gRPC 帧格式 ===
# gRPC 帧: [1字节压缩标志][4字节大端长度][Protobuf数据]
import struct

def decode_grpc_frame(frame_data: bytes, MessageClass) -> dict:
    """解码 gRPC 帧（5字节头部 + Protobuf数据）"""
    if len(frame_data) < 5:
        raise ValueError(f"帧太短: {len(frame_data)} bytes")
    compressed = frame_data[0]
    msg_length = struct.unpack('>I', frame_data[1:5])[0]
    proto_data = frame_data[5:5+msg_length]
    if compressed:
        import zlib
        proto_data = zlib.decompress(proto_data)
    msg = MessageClass()
    msg.ParseFromString(proto_data)
    return MessageToDict(msg, preserving_proto_field_name=True)

def encode_grpc_frame(data: dict, MessageClass, compress=False) -> bytes:
    """编码为 gRPC 帧"""
    proto_data = encode_protobuf(data, MessageClass)
    if compress:
        import zlib
        proto_data = zlib.compress(proto_data)
        flag = 1
    else:
        flag = 0
    return struct.pack('>BI', flag, len(proto_data)) + proto_data


# === 通用：无 .proto 文件的逆推法 ===
def guess_protobuf_structure(binary_data: bytes) -> dict:
    """无 .proto 文件时，用 blackboxprotobuf 尝试解码
    pip install blackboxprotobuf
    """
    import blackboxprotobuf
    try:
        result, typedef = blackboxprotobuf.decode_message(binary_data)
        print("推断的类型定义:", typedef)
        return result
    except Exception as e:
        print(f"自动解析失败: {e}")
        return {"_raw_hex": binary_data.hex()}
```

### 关键工具

| 工具 | 安装 | 用途 |
|------|------|------|
| `protobuf` | `pip install protobuf` | Python Protobuf 库 |
| `grpcio-tools` | `pip install grpcio-tools` | .proto → Python 编译 |
| `blackboxprotobuf` | `pip install blackboxprotobuf` | 无 schema 解码 |
| `CyberChef` | Web 工具 | 可视化 Protobuf 分析 |

### 逆向技巧

1. **JS 中搜 `.proto` 字符串**：很多站点把 proto 定义内嵌在 JS 中
2. **搜 `serializeBinary`/`deserializeBinary`**：protobuf.js 的 API
3. **搜 `jspb.Message`**：Google 的 JS Protobuf 库特征
4. **在 `XMLHttpRequest.send` 设断点**：检查 `body instanceof ArrayBuffer`
5. **用 mitmproxy/reqable 抓二进制流量** → 保存为 `.bin` → 用 CyberChef 分析

---

## 配方14：Diffie-Hellman 密钥交换

### 适用场景
- 部分 WebSocket 协议的密钥协商（如 Boss 直聘 ws 加密）
- ECDH 版本用于 Web Crypto API（`crypto.subtle.deriveBits`）
- Chrome DevTools Protocol (CDP) 的 DevTools 验证
- 某些 Web 应用的临时会话密钥交换

### 识别特征
- 代码中：`generateKey`、`DH`、`ECDH`、`deriveBits`、`deriveKey`
- 参数中：`publicKey`、`privateKey`、`sharedKey`、`handshake`
- 网络请求中有两次公钥交换（先发 client pubkey → 收 server pubkey → 计算共享密钥）

### Python 实现

```python
# dh_exchange.py — Diffie-Hellman 密钥交换

# ===== 方案A: 经典 DH（模指数运算） =====
from cryptography.hazmat.primitives.asymmetric import dh
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend

# Step 1: 生成参数（或使用已知的 p, g）
def generate_dh_params():
    """生成 DH 参数（服务端可能是固定的 p, g）"""
    parameters = dh.generate_parameters(
        generator=2,
        key_size=2048,
        backend=default_backend()
    )
    return parameters

def generate_dh_key_pair(parameters):
    """生成 DH 公私钥对"""
    private_key = parameters.generate_private_key()
    public_key = private_key.public_key()
    return private_key, public_key

def derive_shared_key(private_key, peer_public_key):
    """计算共享密钥"""
    shared_key = private_key.exchange(peer_public_key)
    return shared_key

# Step 2: 从已知 p, g 生成（很多网站使用固定 DH 参数）
def create_dh_from_known_params(p_hex: str, g: int = 2):
    """从已知质数 p 和生成元 g 创建 DH 参数
    
    常见 p 值（从 JS 源码中提取）：
    - TLS 常用 2048-bit Oakley Group 14
    - 某些应用使用 1024-bit 自定义质数
    """
    from cryptography.hazmat.primitives.asymmetric.dh import DHParameterNumbers
    
    p = int(p_hex, 16)  # 16进制转整数
    params_numbers = DHParameterNumbers(p, g)
    parameters = params_numbers.parameters(default_backend())
    return parameters

# Step 3: 完整密钥交换流程
def dh_key_exchange(server_pubkey_hex: str, p_hex: str = None, g: int = 2):
    """与服务器完成 DH 密钥交换
    
    Args:
        server_pubkey_hex: 服务器公钥（hex）
        p_hex: DH 质数（hex），None 则自动生成
        g: 生成元，默认 2
    Returns:
        (client_public_key_hex, shared_secret_hex)
    """
    if p_hex:
        parameters = create_dh_from_known_params(p_hex, g)
    else:
        parameters = generate_dh_params()
    
    client_private, client_public = generate_dh_key_pair(parameters)
    
    # 序列化客户端公钥给服务器
    client_pub_bytes = client_public.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    client_pub_hex = client_pub_bytes.hex()
    
    # 反序列化服务器公钥 → 计算共享密钥
    from cryptography.hazmat.primitives.serialization import load_der_public_key
    server_pub_bytes = bytes.fromhex(server_pubkey_hex)
    server_public = load_der_public_key(server_pub_bytes, default_backend())
    shared = derive_shared_key(client_private, server_public)
    
    return client_pub_hex, shared.hex()


# ===== 方案B: ECDH（椭圆曲线 DH，Web Crypto API 使用） =====
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes

def ecdh_key_exchange_p256(server_pubkey_hex: str) -> tuple:
    """ECDH P-256 密钥交换
    
    对应浏览器 API：
      crypto.subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, ...)
      crypto.subtle.deriveBits({name: "ECDH", public: serverKey}, privateKey, 256)
    """
    # 生成客户端密钥对
    client_private = ec.generate_private_key(ec.SECP256R1(), default_backend())
    client_public = client_private.public_key()
    
    # 导出客户端公钥（未压缩格式: 04 + x + y）
    client_pub_bytes = client_public.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint
    )
    
    # 导入服务器公钥
    server_pub_bytes = bytes.fromhex(server_pubkey_hex)
    server_public = ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), server_pub_bytes
    )
    
    # 计算共享密钥
    shared = client_private.exchange(ec.ECDH(), server_public)
    
    return client_pub_bytes.hex(), shared.hex()


# ===== 方案C: Node.js 子进程（JS 中执行 DH） =====
def dh_via_nodejs(js_dh_code: str, server_pubkey: str) -> str:
    """如果 DH 逻辑太复杂，直接在 Node.js 中执行"""
    import subprocess, json
    
    js = f"""
    const crypto = require('crypto');
    {js_dh_code}
    const shared = computeSharedKey('{server_pubkey}');
    console.log(JSON.stringify({{shared: shared.toString('hex')}}));
    """
    result = subprocess.run(
        ['node', '-e', js],
        capture_output=True, text=True, timeout=10
    )
    return json.loads(result.stdout)['shared']


# === 使用示例 ===
if __name__ == "__main__":
    # 示例: 使用 ECDH P-256（最常见的 Web Crypto API 场景）
    server_pub = "04a1b2c3d4e5f6a7b8..."  # 从服务器获取
    client_pub, shared_secret = ecdh_key_exchange_p256(server_pub)
    print(f"Client Public Key: {client_pub}")
    print(f"Shared Secret:     {shared_secret}")
```

### 常见错误

| 错误 | 原因 | 修正 |
|------|------|------|
| 共享密钥长度不对 | 使用了错误的曲线或参数 | 确认服务器使用的 p/g 或曲线名称 |
| 公钥格式不匹配 | 服务器用 raw bytes，客户端用了 DER | 检查 `from_encoded_point` vs `load_der_public_key` |
| 计算结果不同 | JS 中做了额外的哈希 | 检查 JS 是否对共享密钥做了 SHA256/KDF |

### 验证对齐

```python
# 用浏览器捕获的中间值验证
browser_client_pub = "04xxxx..."  # Hook 捕获的客户端公钥
browser_shared = "a1b2c3..."       # Hook 捕获的共享密钥
browser_server_pub = "04yyyy..."   # 服务器的公钥

# 用服务器公钥 + 客户端私钥复现
from cryptography.hazmat.primitives.asymmetric import ec
server_pub = ec.EllipticCurvePublicKey.from_encoded_point(
    ec.SECP256R1(), bytes.fromhex(browser_server_pub)
)
# ...对比 shared 是否一致
```

---

## 配方15：xxhash / murmurhash 非加密哈希

### 适用场景
- 风控/反爬的请求签名（计算速度快，难以逆向）
- 资源完整性校验（替代 CRC32/MD5）
- WebSocket 帧校验、CDN 资源指纹
- 分布式一致性哈希、Bloom Filter

### 识别特征
- 代码中：`xxhash`、`xxh3`、`murmur`、`murmur3`、`hash32`
- 输出：8位 hex（32bit）或 16位 hex（64bit），极快
- 与 MD5/SHA 区别：非加密哈希，抗碰撞性弱但速度快 100x

### xxhash Python 实现

```python
# xxhash64.py — xxh3/xxh64 哈希复现
import struct

# xxhash 需要安装第三方库，也可以纯 Python 实现
# pip install xxhash

# ===== 方案A: 使用 xxhash 库 =====
def xxhash64(data: bytes, seed: int = 0) -> int:
    """使用 xxhash 库计算 64位哈希"""
    import xxhash
    return xxhash.xxh64(data, seed=seed).intdigest()

def xxhash64_hex(data: bytes, seed: int = 0) -> str:
    """返回 16位 hex 字符串"""
    return format(xxhash64(data, seed), '016x')

def xxh3_64(data: bytes, seed: int = 0) -> int:
    """xxh3 64位哈希（比 xxh64 更快）"""
    import xxhash
    return xxhash.xxh3_64(data, seed=seed).intdigest()

def xxh3_128(data: bytes, seed: int = 0) -> str:
    """xxh3 128位哈希"""
    import xxhash
    return xxhash.xxh3_128(data, seed=seed).hexdigest()


# ===== 方案B: 纯 Python 实现 murmurhash3（无需额外库） =====
def murmurhash3_32(data: bytes, seed: int = 0) -> int:
    """MurmurHash3 32-bit 纯 Python 实现
    
    这是反爬中最常见的非加密哈希，用于：
    - 请求参数签名（替代 MD5，更快且难以碰撞）
    - 一致性哈希、特征指纹
    """
    c1 = 0xcc9e2d51
    c2 = 0x1b873593
    r1 = 15
    r2 = 13
    m = 5
    n = 0xe6546b64
    
    h1 = seed
    
    # Process 4-byte blocks
    for i in range(0, len(data) - len(data) % 4, 4):
        k1 = struct.unpack('<I', data[i:i+4])[0]
        k1 = (k1 * c1) & 0xFFFFFFFF
        k1 = (k1 << r1 | k1 >> (32 - r1)) & 0xFFFFFFFF
        k1 = (k1 * c2) & 0xFFFFFFFF
        
        h1 ^= k1
        h1 = (h1 << r2 | h1 >> (32 - r2)) & 0xFFFFFFFF
        h1 = (h1 * m + n) & 0xFFFFFFFF
    
    # Process remaining bytes
    tail = data[len(data) - len(data) % 4:]
    k1 = 0
    if len(tail) >= 3:
        k1 ^= tail[2] << 16
    if len(tail) >= 2:
        k1 ^= tail[1] << 8
    if len(tail) >= 1:
        k1 ^= tail[0]
        k1 = (k1 * c1) & 0xFFFFFFFF
        k1 = (k1 << r1 | k1 >> (32 - r1)) & 0xFFFFFFFF
        k1 = (k1 * c2) & 0xFFFFFFFF
        h1 ^= k1
    
    # Finalization
    h1 ^= len(data)
    h1 ^= h1 >> 16
    h1 = (h1 * 0x85ebca6b) & 0xFFFFFFFF
    h1 ^= h1 >> 13
    h1 = (h1 * 0xc2b2ae35) & 0xFFFFFFFF
    h1 ^= h1 >> 16
    
    return h1

def murmurhash3_32_hex(data: bytes, seed: int = 0) -> str:
    """返回 8位 hex"""
    return format(murmurhash3_32(data, seed), '08x')


# === 使用示例 ===
if __name__ == "__main__":
    data = b"test_signature_12345"
    
    # xxhash64
    print(f"xxhash64: {xxhash64_hex(data)}")      # 16位hex
    
    # xxh3
    print(f"xxh3_128: {xxh3_128(data)}")          # 32位hex
    
    # murmurhash3
    print(f"murmur3: {murmurhash3_32_hex(data)}")  # 8位hex
```

### 常见使用模式

```python
# 模式A: 参数签名
params = f"timestamp={ts}&body={json.dumps(data)}"
sign = murmurhash3_32_hex(params.encode(), seed=0xABCDEF)

# 模式B: 一致性哈希（用于请求路由）
def route_to_server(user_id: str, server_count: int) -> int:
    h = murmurhash3_32(user_id.encode(), seed=42)
    return h % server_count

# 模式C: Bloom Filter
BLOOM_SIZE = 1000000
HASH_COUNT = 3

def bloom_add(bloom_filter: int, item: str):
    for seed in range(HASH_COUNT):
        idx = murmurhash3_32(item.encode(), seed=seed) % BLOOM_SIZE
        bloom_filter |= (1 << idx)
    return bloom_filter

def bloom_contains(bloom_filter: int, item: str) -> bool:
    for seed in range(HASH_COUNT):
        idx = murmurhash3_32(item.encode(), seed=seed) % BLOOM_SIZE
        if not (bloom_filter & (1 << idx)):
            return False
    return True
```

### 关键注意事项

1. **seed 必须一致**：JS 和 Python 使用相同的 seed 才能输出相同哈希
2. **输入编码**：确认 JS 输入是 UTF-8 还是 Latin-1
3. **输出格式**：hex vs base64 vs raw bytes，从 Hook 捕获确认
4. **字节序**：murmurhash 的 32-bit 输出通常是小端序

---

## 配方16：反反爬完整策略

### 适用场景
- 纯算/补环境方案已经完成，但请求仍然被拦截（code=403/412/35）
- 需要长期稳定采集，避免被风控标记

### 策略金字塔（从底到顶）

```
                    ┌─────────────────┐
                    │  CDP 浏览器兜底  │  ← 终极方案
                    │  (adsPower 集群) │
                    ├─────────────────┤
                    │  IP 池轮换      │  ← 核心防线
                    │  (代理池/住宅IP) │
                    ├─────────────────┤
                    │  TLS 指纹伪装    │  ← 网络层
                    │  (curl_cffi)     │
                    ├─────────────────┤
                    │  请求头完整性    │  ← 应用层
                    │  (sec-ch-ua等)   │
                    ├─────────────────┤
                    │  频率控制        │  ← 行为层
                    │  (间隔/抖动/重试) │
                    ├─────────────────┤
                    │  Session 管理    │  ← 状态层
                    │  (Cookie 持久化)  │
                    └─────────────────┘
```

### 1. IP 池轮换

```python
# ip_pool.py — IP 代理池管理
import random
import time
import requests
from typing import Optional, List

class IPPool:
    """IP 代理池（支持静态代理/API提取/免费池）"""
    
    def __init__(self, proxy_api_url: str = None, static_proxies: List[str] = None):
        self.proxy_api_url = proxy_api_url  # 付费代理 API（如快代理/芝麻代理）
        self.static_proxies = static_proxies or []
        self.proxies: List[dict] = []  # [{ip, port, expire, fail_count}]
        self.current_index = 0
    
    def fetch_from_api(self) -> List[dict]:
        """从代理 API 获取 IP 列表"""
        if not self.proxy_api_url:
            return []
        try:
            resp = requests.get(self.proxy_api_url, timeout=10)
            ips = resp.json().get('data', [])
            return [{'ip': ip['ip'], 'port': ip['port'], 'expire': time.time() + 300} for ip in ips]
        except Exception as e:
            print(f"[IPPool] 获取代理失败: {e}")
            return []
    
    def get_proxy(self) -> Optional[str]:
        """获取一个可用的代理"""
        # 清理过期代理
        now = time.time()
        self.proxies = [p for p in self.proxies if p['expire'] > now and p.get('fail_count', 0) < 3]
        
        # 如果池子空了，尝试补充
        if not self.proxies and self.proxy_api_url:
            self.proxies = self.fetch_from_api()
        
        # 回退到静态代理
        if not self.proxies and self.static_proxies:
            p = self.static_proxies[self.current_index % len(self.static_proxies)]
            self.current_index += 1
            return p
        
        if self.proxies:
            proxy = random.choice(self.proxies)
            return f"http://{proxy['ip']}:{proxy['port']}"
        
        return None  # 无代理可用，走直连
    
    def mark_fail(self, proxy_url: str):
        """标记代理失败"""
        for p in self.proxies:
            if f"http://{p['ip']}:{p['port']}" == proxy_url:
                p['fail_count'] = p.get('fail_count', 0) + 1
                break
    
    def rotate(self, session: requests.Session):
        """轮换代理"""
        proxy = self.get_proxy()
        if proxy:
            session.proxies = {'http': proxy, 'https': proxy}
        else:
            session.proxies = {}
        return proxy


# === 使用示例 ===
ip_pool = IPPool(
    static_proxies=['http://127.0.0.1:7890'],  # 本地代理（clash/v2ray）
    proxy_api_url='https://proxy-api.example.com/get?num=10'  # 付费API
)

session = requests.Session()
for page in range(100):
    ip_pool.rotate(session)  # 每次请求换IP
    try:
        resp = session.get(f'https://api.example.com/data?page={page}', timeout=10)
        if resp.status_code == 403:  # IP 被限
            ip_pool.mark_fail(session.proxies.get('http', ''))
    except Exception:
        ip_pool.mark_fail(session.proxies.get('http', ''))
```

### 2. 请求头完整性

```python
# headers_builder.py — 完整请求头构造器
import random

def build_headers(base_url: str, cookie: str = "", extra: dict = None) -> dict:
    """构建完整的浏览器请求头
    
    关键：现代浏览器（Chrome 80+）的 sec-* 系列头必须对齐
    """
    from urllib.parse import urlparse
    parsed = urlparse(base_url)
    
    headers = {
        # === 基础头 ===
        "Accept": "application/json, text/plain, */*",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        
        # === 来源头（很多风控必检） ===
        "Origin": f"{parsed.scheme}://{parsed.netloc}",
        "Referer": f"{parsed.scheme}://{parsed.netloc}/",
        
        # === User-Agent ===
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        ),
        
        # === Chrome 80+ 安全头（风控重点检测） ===
        "sec-ch-ua": (
            '"Google Chrome";v="131", "Chromium";v="131", '
            '"Not?A_Brand";v="24"'
        ),
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        
        # === 内容类型 ===
        "Content-Type": "application/json;charset=UTF-8",
        
        # === 连接 ===
        "Connection": "keep-alive",
    }
    
    # Cookie
    if cookie:
        headers["Cookie"] = cookie
    
    # 额外的自定义头
    if extra:
        headers.update(extra)
    
    return headers


def adjust_sec_fetch(headers: dict, request_type: str):
    """根据请求类型调整 sec-fetch 系列头
    
    - same-origin: 同域请求
    - same-site: 同站（子域名不同）
    - cross-site: 跨站请求
    """
    if request_type == 'api':
        headers['sec-fetch-dest'] = 'empty'
        headers['sec-fetch-mode'] = 'cors'
        headers['sec-fetch-site'] = 'same-site'
    elif request_type == 'navigation':
        headers['sec-fetch-dest'] = 'document'
        headers['sec-fetch-mode'] = 'navigate'
        headers['sec-fetch-site'] = 'none'
    elif request_type == 'image':
        headers['sec-fetch-dest'] = 'image'
        headers['sec-fetch-mode'] = 'no-cors'
```

### 3. 频率控制（人类行为模拟）

```python
# rate_limiter.py — 频率控制器
import time
import random

class RateLimiter:
    """智能频率控制：模拟人类浏览节奏
    
    人类浏览特征：
    - 连续请求之间有 1-5秒 的阅读时间
    - 翻页间隔比同页请求长
    - 偶尔有"停顿"（接电话、喝水等 10-60秒）
    - 请求间隔有随机抖动（非固定间隔）
    """
    
    def __init__(self, 
                 min_interval: float = 2.0,   # 最小间隔(秒)
                 max_interval: float = 5.0,   # 最大间隔(秒)
                 long_pause_prob: float = 0.05,  # 长停顿概率
                 long_pause_min: float = 30.0,
                 long_pause_max: float = 120.0):
        self.min_interval = min_interval
        self.max_interval = max_interval
        self.long_pause_prob = long_pause_prob
        self.long_pause_min = long_pause_min
        self.long_pause_max = long_pause_max
        self.last_request_time = 0
        self.request_count = 0
    
    def wait(self):
        """在请求前调用，自动等待"""
        now = time.time()
        
        # 计算基础等待时间
        base_wait = random.uniform(self.min_interval, self.max_interval)
        
        # 如果是第一页/重登录后，等更久
        if self.request_count == 0:
            base_wait = random.uniform(3.0, 8.0)
        
        # 每 20 次请求可能有一次长停顿
        if random.random() < self.long_pause_prob:
            pause = random.uniform(self.long_pause_min, self.long_pause_max)
            print(f"[RateLimiter] 模拟长停顿 {pause:.0f}s...")
            time.sleep(pause)
        
        # 确保距离上次请求至少间隔 base_wait
        elapsed = now - self.last_request_time
        if elapsed < base_wait:
            time.sleep(base_wait - elapsed)
        
        self.last_request_time = time.time()
        self.request_count += 1
    
    def wait_with_jitter(self, base_seconds: float, jitter: float = 0.3):
        """带抖动的等待（适合翻页）"""
        actual = base_seconds * (1 + random.uniform(-jitter, jitter))
        time.sleep(max(0.5, actual))


# === 使用示例 ===
limiter = RateLimiter(min_interval=2.0, max_interval=5.0)

for page in range(1, 101):
    limiter.wait()  # 自动控制频率
    # requests.get(...)
    
    if page % 10 == 0:
        # 每 10 页额外休息
        limiter.wait_with_jitter(5.0)
```

### 4. Session 管理与 Cookie 持久化

```python
# session_manager.py — Session 生命周期管理
import json
import os
import pickle
import requests
from datetime import datetime, timedelta

class SessionManager:
    """Session 管理器：Cookie 持久化 + 自动重登录"""
    
    def __init__(self, cookie_file: str = "cookies.json", 
                 login_func=None):
        self.cookie_file = cookie_file
        self.login_func = login_func  # 重登录函数（用户实现）
        self.session = requests.Session()
        self._load_cookies()
    
    def _load_cookies(self):
        """从文件加载 Cookie"""
        if os.path.exists(self.cookie_file):
            with open(self.cookie_file, 'r') as f:
                cookies = json.load(f)
            for c in cookies:
                self.session.cookies.set(c['name'], c['value'], domain=c.get('domain', ''))
            print(f"[Session] 加载了 {len(cookies)} 个 Cookie")
    
    def _save_cookies(self):
        """保存 Cookie 到文件"""
        cookies = []
        for cookie in self.session.cookies:
            cookies.append({
                'name': cookie.name,
                'value': cookie.value,
                'domain': cookie.domain,
                'path': cookie.path,
                'expires': cookie.expires,
            })
        with open(self.cookie_file, 'w') as f:
            json.dump(cookies, f, indent=2)
        print(f"[Session] 保存了 {len(cookies)} 个 Cookie")
    
    def request(self, method: str, url: str, **kwargs) -> requests.Response:
        """带自动重试和重登录的请求"""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                resp = self.session.request(method, url, timeout=30, **kwargs)
                
                # 检测登录失效
                if self._need_relogin(resp):
                    print(f"[Session] 检测到登录失效，尝试重登录...")
                    if self.login_func:
                        new_cookies = self.login_func()
                        for name, value in new_cookies.items():
                            self.session.cookies.set(name, value)
                        self._save_cookies()
                        continue  # 重试请求
                
                # 保存 Cookie（每次成功请求后）
                if resp.cookies:
                    self._save_cookies()
                
                return resp
                
            except requests.RequestException as e:
                print(f"[Session] 请求失败 (attempt {attempt+1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)  # 指数退避
        
        raise Exception(f"请求失败 {max_retries} 次: {url}")
    
    def _need_relogin(self, resp) -> bool:
        """判断是否需要重新登录"""
        # 通用检测规则
        if resp.status_code == 401:
            return True
        if resp.status_code == 302 and 'login' in resp.headers.get('Location', ''):
            return True
        # 站点特定检测
        try:
            data = resp.json()
            if data.get('code') in (-1, 401, 403, 1001, 10001):
                return True
            if 'login' in str(data).lower() and '请' in str(data):
                return True
        except:
            pass
        return False
```

### 5. 综合请求客户端（整合以上所有策略）

```python
# anti_crawl_client.py — 反反爬综合客户端
class AntiCrawlClient:
    """集成了 IP池 + 请求头 + 频率控制 + Session
    
    用法:
        client = AntiCrawlClient()
        resp = client.get('https://api.example.com/data', params={'page': 1})
    """
    
    def __init__(self, cookie_file='cookies.json', proxy_api=None, 
                 use_curl_cffi=False, impersonate='chrome131'):
        self.use_curl_cffi = use_curl_cffi
        self.impersonate = impersonate
        self.ip_pool = IPPool(proxy_api_url=proxy_api, 
                              static_proxies=['http://127.0.0.1:7890'])
        self.limiter = RateLimiter()
        
        if use_curl_cffi:
            from curl_cffi import requests as cffi_requests
            self.SessionClass = cffi_requests.Session
        else:
            self.SessionClass = requests.Session
        
        self.session = self.SessionClass()
    
    def _build_headers(self, url, **kwargs):
        headers = build_headers(url, **kwargs)
        return headers
    
    def get(self, url, **kwargs):
        self.limiter.wait()
        self.ip_pool.rotate(self.session)
        headers = self._build_headers(url)
        
        if self.use_curl_cffi:
            return self.session.get(url, headers=headers, 
                                    impersonate=self.impersonate, **kwargs)
        return self.session.get(url, headers=headers, **kwargs)
    
    def post(self, url, **kwargs):
        self.limiter.wait()
        self.ip_pool.rotate(self.session)
        headers = self._build_headers(url)
        
        if self.use_curl_cffi:
            return self.session.post(url, headers=headers, 
                                     impersonate=self.impersonate, **kwargs)
        return self.session.post(url, headers=headers, **kwargs)


# === 快速开始 ===
if __name__ == "__main__":
    # 基础模式（无 TLS 指纹伪装）
    client = AntiCrawlClient()
    resp = client.get('https://httpbin.org/headers')
    print(resp.json())
    
    # 高级模式（含 TLS 指纹伪装）
    # pip install curl_cffi
    # client = AntiCrawlClient(use_curl_cffi=True, impersonate='chrome131')
```

### 策略选择决策表

| 风控级别 | 症状 | 策略 |
|----------|------|------|
| 低 | 正常返回 | 基础请求头 + 固定IP |
| 中 | 偶尔 403/限流 | + 频率控制 + 本地代理轮换 |
| 高 | 频繁 403/412 | + curl_cffi TLS指纹 + 住宅IP代理池 |
| 极高 | IP秒封、纯算永久失效 | CDP 浏览器集群（adsPower）+ 住宅IP轮换 |

### 关键注意事项

1. **curl_cffi 安装**：`pip install curl_cffi`（不是 `curl-cffi`）
2. **住宅IP vs 机房IP**：住宅IP贵但存活率高，机房IP便宜但易被标记
3. **sec-ch-ua 对齐**：`sec-ch-ua` 必须与 User-Agent 中 Chrome 版本一致
4. **请求头顺序**：有些风控检查 headers 的顺序（Python requests 默认按字母序）
5. **不要过度优化**：先用最简单的方案，风控升级再堆策略，避免过早优化

```