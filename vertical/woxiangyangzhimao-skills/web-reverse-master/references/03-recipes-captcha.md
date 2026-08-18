# 验证码对抗配方 + CDP桥

## 验证码5线拆分法

任何验证码/风控challenge，先拆成5条线：

```
1. 初始化线：获取challenge/token/图片URL
2. 图像识别线：缺口检测/OCR/目标检测
3. 参数builder线：collectData/轨迹/设备信息生成+加密
4. 环境指纹线：Canvas/WebGL/Audio/Crypto指纹
5. 最终verify线：提交验证结果 → 获取token
```

---

## 配方A：滑块验证码（标准型）

### 适用：背景图+滑块图分离的类型

> 完整 OpenCV 检测实现参见 captcha-solver 配方1(slider-opencv)，轨迹生成参见配方5/6/7

**Step 1：获取验证码**
```python
import requests

# 不同站点的获取方式不同
# 丰巢: POST /captcha/querySlideImage/{uuid}
# 返回: {shadeImageUrl, slideImageUrl, checkId, key, pointX, pointY}

resp = requests.post(f"https://acs.fcbox.com/captcha/querySlideImage/{uuid}", json={})
data = resp.json()["data"]
bg_url = data["shadeImageUrl"]
slider_url = data["slideImageUrl"]
check_id = data["checkId"]
```

**Step 2：OpenCV检测缺口**

使用 `cv2.matchTemplate` 做模板匹配，获取滑动距离（像素）。核心流程：下载背景图和滑块图 → 灰度化 → 模板匹配 → `minMaxLoc` 取最大匹配位置。

**Step 3：生成人类-like轨迹**

生成加速 → 减速 → 微调三阶段轨迹，模拟真人滑动行为。轨迹参数（步长、时间间隔、Y轴抖动）需根据目标站点的风控强度调整。

**Step 4：加密并提交**
```python
import hashlib

def submit_captcha(check_id, uuid, track, client_ip):
    """加密轨迹并提交验证"""
    # 丰巢: md5(clientIp + checkId + uuid + track_string)
    track_str = ",".join([f"({p['x']},{p['y']},{p['time']})" for p in track])
    sign = hashlib.md5(f"{client_ip}{check_id}{uuid}{track_str}".encode()).hexdigest()
    
    # AES加密整个请求体
    # ...（不同站点加密方式不同）
    
    resp = requests.post(
        f"https://acs.fcbox.com/captcha/checkCode/{uuid}",
        json={"data": encrypted_data, "int8": False}
    )
    return resp.json().get("data", {}).get("token")
```

---

## 配方B：涂鸦/第三方验证码（RSA+AES混合加密型）

### 适用：tuyacn.com、顶象、极验等第三方验证码

> 深度Hook方法参见 web-reverse-master scripts/hooks/，加密还原参见 param-encryptor 配方5(aes-cbc)、配方10(rsa-pkcs1)

**核心特征**：
- 大文件JS（yrule.js 742KB级别）
- RSA+AES混合加密
- collectData（行为采集数据，3000-4800字符Base64）

**Step 1：深度Hook捕获加密数据**

通过 `inject_before_load` 注入 XHR/Fetch Hook，拦截 collectData 发送请求。搜索关键词：`sendCollect` / `collectData` / `XMLHttpRequest.send`。

**Step 2：分析加密流程**

捕获的请求体包含 `collectData`（AES加密行为数据，3000-4800字符Base64）和 `key`（RSA加密的AES密钥，344字符Base64）。解码 key 字段后应为 256 字节（RSA-2048）。

**Step 3：反混淆定位加密函数**
```powershell
# 1. 保存 yrule.js 和主混淆文件
# 2. AST反混淆
node .qoder/skills/ast-deobfuscation/scripts/run-pipeline.js yrule.js output/
# 3. 搜索AES/RSA加密函数
# 搜索: AES.encrypt / RSA.encrypt / publicKey / encrypt
```

---

## 配方C：算术验证码

### 适用：若依框架等简单算术题

> 完整实现参见 captcha-solver 配方4(arithmetic-ddddocr)

**流程：**

1. **获取验证码** — `GET /captchaImage` 返回 `{code: 200, data: {img: "base64...", uuid: "xxx"}}`
2. **OCR识别** — 下载图片，用 ddddocr 或其他 OCR 工具识别算术表达式
3. **计算答案** — 解析表达式（如 `"3 + 5 = ?"`），`eval` 或手动计算得出结果
4. **提交验证** — 将答案与 uuid 一起提交到登录接口

---

## 配方D：CDP桥（签名太复杂时的终极方案）

### 适用场景
- 签名算法极复杂且频繁升级
- 本地纯算/补环境方案都已失效
- 有AdsPower且profile已登录目标站点

### 架构原理

```
Python脚本 ←─ CDP WebSocket ─→ AdsPower浏览器
    │                               │
    │ Runtime.evaluate              │ 内部axios自动签名
    │ 注入桥接函数                   │ Cookie/TLS/Headers全自动
    │                               │
    ▼                               ▼
JSON结果 ←──────────────── 浏览器自动生成
```

### 实现代码

```python
# cdp_bridge.py - CDP桥核心
# 依赖: pip install websocket-client

import json
import http.client
import websocket

class CDPBridge:
    """通过CDP WebSocket在AdsPower浏览器中执行JavaScript
    
    使用方式：
    1. MCP: adspower-browser → open-browser → get-opened-browser 获取CDP端口
    2. bridge = CDPBridge(61559); bridge.connect()
    3. result = bridge.evaluate("document.title")
    
    ⚠️ 依赖 pip install websocket-client（非标准库），不可用裸socket手写WebSocket帧
    """
    
    def __init__(self, cdp_port):
        self.cdp_port = cdp_port
        self._msg_id = 0
        self.ws = None
    
    def _get_ws_url(self):
        """从CDP HTTP端点获取WebSocket URL"""
        conn = http.client.HTTPConnection("127.0.0.1", self.cdp_port)
        conn.request("GET", "/json")
        resp = json.loads(conn.getresponse().read())
        for tab in resp:
            if tab.get("type") == "page":
                return tab["webSocketDebuggerUrl"]
        raise Exception("未找到可调试的页面标签")
    
    def connect(self):
        """建立WebSocket连接"""
        ws_url = self._get_ws_url()
        self.ws = websocket.create_connection(ws_url)
    
    def evaluate(self, expression):
        """在浏览器中执行JavaScript并返回结果"""
        self._msg_id += 1
        msg = json.dumps({
            "id": self._msg_id,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": True,
            }
        })
        self.ws.send(msg)
        response = json.loads(self.ws.recv())
        
        if "result" in response:
            return response["result"]["result"]["value"]
        raise Exception(f"CDP error: {response}")

# 使用示例
bridge = CDPBridge(61559)

# 注入桥接函数（在浏览器webpack中注册API调用）
bridge.evaluate("""
    // 扫描webpack模块，找到axios实例
    const modules = window.__webpack_require__.c;
    for (let id in modules) {
        // 找到axios或业务API模块
        // 注册全局桥接函数
    }
    window.__bridge = {
        homefeed: async (params) => {
            const axios = window.__webpack_require__(12345);
            const res = await axios.post('/api/homefeed', params);
            return res.data;
        }
    };
""")

# 调用业务API
result = bridge.evaluate("""
    window.__bridge.homefeed({
        cursor_score: "", num: 8, refresh_type: 1,
        category: "homefeed_recommend"
    })
""")
```

### 关键约束
- AdsPower profile必须已登录目标站点
- 当前浏览器tab必须在目标站点域名下
- 业务调用链必须符合浏览器原生顺序
- 每轮调用前可能需要预热（homefeed → detail → report）

> 完整实现参考：`sites/rednote/src/cdp_bridge.py`

---

## 配方E：字体反爬

### 适用：WOFF2/WOFF字体混淆数字

> 📌 SKILL.md [配方7](../SKILL.md#配方7字体反爬) 提供简洁版（仅 numberOfContours+width+height），本配方为完整版（含 xMin/xMax/yMin/yMax 几何边界指纹）。

```python
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont
import requests

# Step 1: 下载字体
font_url = "https://xxx.com/fonts/xxx.woff2"
font_bytes = requests.get(font_url).content
with open("temp.woff2", "wb") as f:
    f.write(font_bytes)

# Step 2: 解析字体
font = TTFont("temp.woff2")
cmap = font.getBestCmap()  # unicode → glyph name 映射

# Step 3: 提取glyph指纹
fingerprints = {}
for uni, glyph_name in cmap.items():
    glyph = font['glyf'][glyph_name]
    # 几何指纹: 轮廓数、最小x、最大x、宽度、高度
    if hasattr(glyph, 'numberOfContours'):
        fp = (
            glyph.numberOfContours,
            glyph.xMin, glyph.xMax,
            glyph.yMin, glyph.yMax,
            glyph.width, glyph.height
        )
        fingerprints[glyph_name] = fp

# Step 4: 第一页推导映射
# init API返回真实数字 → 比对glyph指纹 → 建立映射表
# 后续页面直接用指纹匹配解码
```

---

## 验证码方案选择速查

| 验证码类型 | 首选方案 | 备选方案 |
|-----------|----------|----------|
| 滑块拼图（简单）| OpenCV模板匹配 + 轨迹生成 | 云码API打码 |
| 滑块拼图（加密）| OpenCV + 反混淆加密函数 | CDP桥自动化 |
| 涂鸦/第三方验证码 | 深度Hook + AST反混淆 + 纯算 | 浏览器自动化 |
| 算术题 | Python eval | OCR识别 |
| 点选验证码 | 目标检测模型 | 云码API |
| 旋转验证码 | 角度回归模型 | 云码API |
| 腾讯验证码 | collect参数还原 | CDP桥 |
| 极验4 | w参数还原 | 浏览器自动化 |
