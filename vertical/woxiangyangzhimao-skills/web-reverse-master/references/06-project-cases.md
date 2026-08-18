# 9个项目完整案例库

## 案例1：spiderdemo — MD5签名 + WASM + 字体反爬 + CSS偏移

**路径**: `sites/spiderdemo/` | **难度**: ⭐-⭐⭐ | **类型**: 反爬练习平台

### 已完成的4个挑战

**OB Challenge1（MD5签名）**：
```python
# sites/spiderdemo/src/signer.py
salt = b"\xa3\xac\xa1\xa3fdjf,jkgfkl"  # 从浏览器Hook提取
sign = hashlib.md5(f"{timestamp}{page}".encode() + salt).hexdigest()
```
关键：Hook捕获salt → Python纯算复现

**WASM Challenge（WASM本地执行）**：
```javascript
// sites/spiderdemo/src/wasm_assets/wasm_solver.mjs
import init, { encrypt_simple } from './wasm_anti.js';
await init(fs.readFileSync('./wasm_anti_bg.wasm'));
const auth = encrypt_simple(verifyString, timestamp);
```
关键：脱离浏览器，Node.js 22.x原生执行WASM

**字体反爬（WOFF2解析）**：
```python
# sites/spiderdemo/src/font_anti_solver.py
font = TTFont("font.woff2")
for glyph_name in font.getGlyphOrder():
    glyph = font['glyf'][glyph_name]
    fp = (glyph.numberOfContours, glyph.width, glyph.height)
```
关键：第1页推导映射 → 后续页面指纹匹配

**CSS1 Challenge（CSS偏移还原）**：
关键：必须浏览器渲染 → `getBoundingClientRect()` 获取真实位置

---

## 案例2：yangkeduo — 拼多多 anti_content 协议采集

**路径**: `sites/yangkeduo/` | **难度**: ⭐⭐ | **类型**: webpack模块 + 补环境

### 架构
```
Python main.py → Node runner.js (stdin/stdout JSON)
              → 生成 anti_content
              → Python requests 发请求
```

### 关键发现
- `anti_content` 由 webpack 模块 `53636` (RiskControlCrawler) 生成
- 依赖 `chunk_3636.js`（需随PDD发版更新hash）
- 补环境仅补最小边界（navigator/document基础属性）

### 核心文件
- `src/main.py` — Python主脚本
- `src/runner.js` — Node.js长驻服务
- `src/env/browser.js` — 最小环境stub

---

## 案例3：zhipin — Boss直聘登录态请求

**路径**: `sites/zhipin/` | **难度**: ⭐⭐⭐ | **类型**: Cookie + TLS指纹

### 核心发现
**登录态 + headers > 纯算法逆向**：
- 有Cookie(wt2+zp_at) → curl_cffi直接请求 → code=0
- 无Cookie → 补环境生成__zp_stoken__ → code=38（仍然失败）
- 结论：算法不是主路径

### 架构
```
signer.py
├─ 登录态优先：raw_cookie + curl_cffi chrome131 + 完整headers
└─ code=37兜底：下载security JS → Node.js补环境 → 重新生成token
```

### 核心文件
- `src/signer.py` — 主脚本
- `src/cookie_config.json` — Cookie配置
- `src/env/env.js` — 补环境兜底

---

## 案例4：fcbox — 丰巢滑块验证码

**路径**: `sites/fcbox/` | **难度**: ⭐⭐ | **类型**: 滑块+轨迹加密

### 流程
1. 获取滑块 → `POST /captcha/querySlideImage/{uuid}`
2. OpenCV检测缺口 → `cv2.matchTemplate`
3. 生成轨迹 → 人类-like [{x, y, time}]
4. MD5签名 → `md5(clientIp + checkId + uuid + track)`
5. AES加密 → 提交

### 核心文件
- `src/slider_solver.py` — 滑块识别
- `src/slider_encrypt.js` — 轨迹加密
- `src/browser_captcha.py` — 浏览器备选

---

## 案例5：ocyuan — 涂鸦验证码深度逆向

**路径**: `sites/ocyuan/` | **难度**: ⭐⭐⭐ | **类型**: RSA+AES+collectData

### 加密机制
```
生成随机AES密钥 → AES加密行为数据(collectData)
→ RSA-2048加密AES密钥(key) → POST collectData接口
```

### 主混淆文件
- `xxxxbbbb.js` (983KB) — OB变种混淆，包含jsrsasign RSA库
- `yrule.js` (742KB) — 涂鸦验证码核心库

### 核心文件
- `src/hook_collect_data.js` — collectData Hook脚本
- `src/analyze_captured_collectdata.py` — 数据分析
- `src/captcha_solver.py` — 验证码求解器

---

## 案例6：ouc_exam — 若依框架考试平台

**路径**: `sites/ouc_exam/` | **难度**: ⭐ | **类型**: 若依框架+AES固定密钥

### 加密方式（三次误判后才确认）
```python
# 实际加密流程：
loginForm → JSON.stringify → AES/CBC/ZeroPadding(固定密钥"XXXXXXXXXXXXXXXX", IV=Key) → Base64

# 同时：RSA公钥加密AES密钥 → secretKey字段
# 请求体：{"secretKey": "RSA密文", "data": "AES密文"}
```

### 教训
| 误判 | 实际 |
|------|------|
| 密码HmacMD5加密 | 密码明文 |
| AES密钥随机生成 | 固定"XXXXXXXXXXXXXXXX" |
| ECB+PKCS7 | CBC+ZeroPadding |

### 核心文件
- `src/encrypt.py` — AES加密模块
- `src/login.py` — 登录流程

---

## 案例7：rednote — CDP桥终极方案

**路径**: `sites/rednote/` | **难度**: ⭐⭐⭐ | **类型**: CDP桥

### 为什么选CDP桥
- 服务端升级签名体系（新增X-S-Common），本地纯算不可行
- CDP桥让浏览器自动签名：X-s/X-t/X-S-Common/Cookie/TLS全自动

### 架构
```
Python → CDP WebSocket → AdsPower浏览器
       Runtime.evaluate → 浏览器内axios执行业务API
       JSON结果 ← 浏览器自动生成签名
```

### 核心文件
- `src/cdp_bridge.py` — CDP桥核心（MiniWS + webpack注入）
- `src/user_report.py` — 交互式循环上报（最常用）

---

## 案例8：docin — 豆丁网文档下载

**路径**: `sites/docin/` | **难度**: ⭐ | **类型**: 文档下载

### 技术点
- 文档类型识别：扫描型(JPEG) vs 文本型(SVG)
- Base64 → zlib解压 → JSON解析 → 按类型处理
- 免费页数上限友好提示

### 核心文件
- `src/docin_downloader.py` — 自适应下载器

---

## 案例9：xiaohongshu — 小红书签名分析

**路径**: `sites/xiaohongshu/` | **难度**: ⭐⭐⭐⭐ | **状态**: 分析中

### 待逆向参数
- x-s (~300字符 Base64, XYS_前缀)
- x-s-common (~800字符 Base64)
- x-t (毫秒时间戳)
- x-rap-param (Base64二进制)

### 资料
- `逆向分析.md` — 完整分析文档
- `signv2.js` — 实验性签名生成
- 替代方案：使用rednote的CDP桥绕过签名问题

---

## 典型案例模式（无站点代码，来自经验记忆）

### 模式A：京东 h5st 多段签名

**难度**: ⭐⭐⭐ | **类型**: 多段拼接签名

h5st 是京东核心签名，格式：`p1;p2;p3;p4;p5;p6;p7;p8`

| 段 | 含义 | 生成方式 |
|----|------|---------|
| p1 | 时间戳格式化 | `YYYYMMDDHHmmssuuu` |
| p2 | 指纹(fp) | 16位随机hex |
| p3 | appId | 平台标识（如 `f06cc`） |
| p4 | tk | 从 `cactus.jd.com/request_algo` 获取 |
| p5 | 签名 | `md5(t + query_str + t)` |
| p6 | 版本号 | `4.1` / `5.0` |
| p7 | 时间戳毫秒 | `Date.now()` |
| p8 | expandParams | AES加密的环境信息 |

**完整流程**：
```
1. 生成指纹 fp = random 16位 hex
2. 请求 cactus.jd.com/request_algo → 获取 tk + algo
3. 构造请求体字段（appid/body/client/...）
4. body 做 SHA256 → algo 函数计算 t
5. 拼接 t + query_string + t → MD5 → p5
6. 组装环境参数 AES 加密 → p8
7. 拼接完整 h5st = p1;...;p8
```

**关键技术**：
- curl_cffi TLS指纹模拟（必要！否则请求被拦截）
- 环境参数 expandParams 包含浏览器指纹信息
- tk 有时效性，需在请求前实时获取

---

### 模式B：瑞数 RS5/RS6 Cookie 对抗

**难度**: ⭐⭐⭐⭐ | **类型**: Cookie生成

**特征**：
- Cookie名带动态后缀：`FSSBBIl1UgzbN7NXXT`、`goN9uW4i0iKzO`
- 首次访问返回 412 状态码 + JS 生成 Cookie
- RS5：后缀静态；RS6：后缀动态（每次不同）
- 出现站点：中国邮政、湖北专利、深圳大学等

**流程**：
```
GET 目标页面 → 412 + Cookie生成JS
→ 提取JS → Node.js补环境执行 → 获取Cookie值
→ 携带Cookie重新请求目标接口
```

**关键**：
- JS代码通常包含环境检测（navigator/document/location）
- 补环境质量决定成功率（可参考 05-env-patching.md）
- Cookie有固定有效期，不需要每次生成

---

### 模式C：自定义Base64（小红书 X-s 签名）

**难度**: ⭐⭐⭐ | **类型**: 编码变形

小红书 X-s 的编码使用了自定义 Base64 表：
```javascript
lookup = ["Z","m","s","e","r","b","B","o","H","Q","t","N","P","+","w","O",
          "c","z","a","/","L","p","n","g","G","8","y","J","q","4","2",
          "K","W","Y","j","0","D","S","f","d","i","k","x","3","V",
          "T","1","6","I","l","U","A","F","M","9","7","h","E","C","v","u","R","X","5"];
```

**复现方法**：见 02-recipes-signature.md 配方7

---

### 模式D：国密 SM2/SM4（政府/医保网站）

**难度**: ⭐⭐ | **类型**: 国密算法

**出现场景**：
- 信用中国：SM2 签名 + SM4 数据加密
- 医保服务：SM2 登录参数 + SM4 数据解密
- 标识：`encType: "SM4"`、`sign_type: "SM2"`

**Python库**：`pip install gmssl`
**具体实现**：见 02-recipes-signature.md 配方8
