---
name: captcha-solver
description: 验证码识别 — 自动化验证码破解与识别
description_zh: |
  验证码纯协议求解器。覆盖 11 家主流验证码服务商（腾讯TCaptcha/极验3&4/网易易盾/数美/顶象Verify5/阿里NVC/阿里Baxia/涂鸦智能/京东jcap/字节rmc-captcha/各站自研），
  内置 20+ 配方：滑块识别（OpenCV本地+云码API双策略）、点选识别（云码API）、算术识别（ddddocr）、
  轨迹生成（贝塞尔/五段式/差分编码）、加密提交（AES-CBC/ECB/CTR/GCM、DES-ECB、XOR、自定义Base64）。
  用途：给定目标验证码类型+图片/配置，输出验证码ticket/validate及加密参数，供Python主脚本直接请求。
  触发词：「验证码」「滑块」「点选」「captcha」「slider」「验证码破解」「滑块识别」「过验证」。
  当用户提供验证码图片、提到验证码服务商名称、或逆向流程中遇到验证码环节时使用。
  边界：当用户需要分析验证码的加密逻辑但尚未确认算法类型时，使用 web-reverse-master。
  验证码提交中的 AES/DES/XOR 加密是本 Skill 的一部分，不转发到 param-encryptor。
---

# Captcha Solver · 验证码纯协议求解器

> 基于 30+ 逆向实战项目的验证码经验提炼。覆盖国内主流 11 家验证码服务商。
> 核心理念：**识别（本地优先）→ 轨迹（拟人）→ 加密（协议还原）→ 提交（获取ticket）**
> 所有方案均为纯协议实现，不依赖浏览器自动化。

---

## 角色规则

**此 Skill 激活后，以验证码逆向专家身份工作。**

- 先判断验证码类型和服务商，再选择对应配方
- 本地识别优先（OpenCV/ddddocr），云码API兜底
- 轨迹必须模拟人类行为（过冲回拉、Y轴抖动、时间随机化）
- 加密参数必须通过动态调试实证确认，禁止猜测
- 所有产出必须为纯 Python 协议脚本，使用 requests 发送

## Phase 映射

本 Skill 在 CLAUDE.md Phase 0-4 工作流中的定位：

| Phase | 本 Skill 的角色 | 与其他 Skill 的协作 |
|-------|----------------|-------------------|
| Phase 0 情报收集 | 🟡 辅助：识别验证码服务商特征 | web-reverse-master 搜索目标站点的验证码方案 |
| Phase 1 流量分析 | ✅ 核心参与：捕获验证码初始化/提交接口 | web-reverse-master 通过 js-reverse-mcp 或 CDP 桥抓流量 |
| Phase 2 定位加密 | ✅ 核心参与：定位验证码提交的加密参数 | web-reverse-master 用 js-reverse-mcp 搜 encrypt/sign 关键词 |
| Phase 3 方案制定 | ✅ 核心参与：选择配方 + 确认轨迹+加密方案 | 配合 env-patcher（验证码 SDK 需补环境） |
| Phase 4 代码还原 | ✅ 核心参与：生成验证码求解脚本 | Python 主脚本集成验证码模块 |

**典型调用链：**
```
web-reverse-master Phase 1 发现验证码接口 c.dun.163.com
  → captcha-solver Step 1 匹配"网易易盾"
  → captcha-solver Step 2-4 下载图片+识别+生成轨迹
  → captcha-solver Step 5-7 加密提交+获取 ticket
  → Python 主脚本携带 ticket 调用业务接口
```

**MCP 工具使用：**
- 本 Skill 纯协议求解，不直接调用浏览器 MCP 工具
- 如需动态调试验证码加密逻辑，使用 `web-reverse-master` → `js-reverse-mcp`（路线B）
- 如需在指纹浏览器中抓验证码流量，使用 `web-reverse-master` → `adspower-browser`（路线A/C）
- 如需反混淆验证码 JS，使用 `ast-deobfuscation`

---

## 〇、执行工作流（验证码求解7步法）

> 每次验证码求解任务必须按以下7步执行。

### Step 1: 判断服务商
**输入**：目标网站域名 + 抓包流量
**输出**：验证码服务商名称 + 配方编号
**动作**：查"验证码服务商识别指南"表格匹配

🔴 **CHECKPOINT**：无匹配 → 进入"通用自研验证码分析流程"（见下文），禁止跳过。

### Step 2: 获取验证码图片
**输入**：服务商初始化接口
**输出**：背景图+滑块图（或点选原图）
**动作**：调用prehandle/register/get接口，下载图片

### Step 3: 识别缺口/坐标
**输入**：图片二进制数据
**输出**：缺口x坐标 或 点选坐标列表
**动作**：先配方1(slider-opencv)，置信度<0.05 → 降级配方2(slider-yunma)

🔴 **CHECKPOINT · 识别门控**：识别结果必须在图片尺寸合理范围内（如x<图片宽度-滑块宽度），异常值直接丢弃重试。

### Step 4: 生成轨迹
**输入**：识别坐标 + 目标距离
**输出**：[[x, y, t], ...] 轨迹数组
**动作**：按服务商选择配方5/6/7

### Step 5: 加密参数
**输入**：轨迹 + 坐标 + session数据
**输出**：加密后的提交参数
**动作**：按服务商选择配方8/9/10

🔴 **CHECKPOINT · 加密门控**：加密参数长度必须与浏览器抓包一致（±10%），异常 → 检查Key/IV/Mode。

### Step 6: 提交验证
**输入**：加密参数 + verify接口URL
**输出**：ticket/validate 或 失败原因
**动作**：POST提交，解析响应

### Step 7: 校验结果
**输入**：ticket + 业务接口
**输出**：业务请求成功/失败
**动作**：携带ticket调用业务接口

🛑 **STOP**：ticket无效或过期 → 回到Step 2重试（最多3次）。3次均失败 → 检查时间同步和session有效期。

### 通用自研验证码分析流程（服务商识别无匹配时）

```
1. 抓取验证码初始化接口 → 提取图片URL格式和加密特征
2. 下载图片 → 用配方1(OpenCV)尝试识别
3. 分析提交接口的请求参数 → 搜索加密关键词定位加密函数
4. 对比已知加密模式（AES-CBC/DES-ECB/XOR）匹配最接近的
5. 用配方5(贝塞尔轨迹)生成默认轨迹
6. 提交验证 → 根据返回错误信息调整
```

---

## 验证码服务商识别指南

| 特征 | 服务商 | 典型接口域名 |
|------|--------|------------|
| `turing.captcha.qcloud.com` / `captcha.qq.com` | 腾讯TCaptcha | TDC指纹+POW |
| `geetest.com` / `geevisit.com` | 极验3/4 | w参数(AES+RSA) |
| `c.dun.163.com` / `ir-sdk.dun.163.com` | 网易易盾 | IR SDK+Core AES |
| `www.ishumei.com` / ``fverify``含DES加密 | 数美 | DES-ECB 12参数 |
| `verify5.com` / WebSocket通信 | 顶象Verify5 | AES-CTR+MurmurHash3 |
| `cf.aliyun.com/nvc` / `AWSC` | 阿里NVC | AWSC框架劫持 |
| `_____tmd_____/gridClick` / `baxia` | 阿里Baxia | WASM九宫格 |
| `captcha.tuyacn.com` | 涂鸦智能 | RSA+AES混合 |
| `jcap.m.jd.com` / `AwPF`前缀 | 京东jcap | WASM加密 |
| `verify.zijieapi.com` / `rmc-captcha` | 字节rmc | WASM AES-GCM |
| 其他自研 | 自研滑块 | 需单独分析 |

---

## 配方库

### 一、识别配方

#### 配方1: slider-opencv（滑块本地识别）

```python
# 优先级：首选
# 适用：所有滑块验证码
# 依赖：opencv-python
import cv2
import numpy as np

def detect_gap_slider(bg_bytes: bytes, slider_bytes: bytes) -> int:
    """OpenCV Canny + matchTemplate 滑块缺口检测
    返回：缺口最左边缘 x 坐标（像素）
    """
    bg = cv2.imdecode(np.frombuffer(bg_bytes, np.uint8), cv2.IMREAD_COLOR)
    slider = cv2.imdecode(np.frombuffer(slider_bytes, np.uint8), cv2.IMREAD_COLOR)
    
    # 策略1：Canny边缘检测 + 模板匹配
    bg_gray = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY)
    slider_gray = cv2.cvtColor(slider, cv2.COLOR_BGR2GRAY)
    bg_edge = cv2.Canny(bg_gray, 100, 200)
    slider_edge = cv2.Canny(slider_gray, 100, 200)
    
    result = cv2.matchTemplate(bg_edge, slider_edge, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(result)
    
    if max_val >= 0.8:
        return max_loc[0]  # 高置信度直接返回
    
    # 策略2：膨胀腐蚀 + 匹配
    kernel = np.ones((3, 3), np.uint8)
    bg_dilated = cv2.dilate(bg_edge, kernel, iterations=1)
    result2 = cv2.matchTemplate(bg_dilated, slider_edge, cv2.TM_CCORR_NORMED)
    _, _, _, max_loc2 = cv2.minMaxLoc(result2)
    
    return max_loc2[0]

# 特殊变体：
# 网易易盾：alpha mask匹配，置信度0.94+
# 京东jcap：CCOEFF_NORMED + CCORR_NORMED双策略
# 极验4：answer = round(gap_x * 0.94) 坐标系转换
```

**失败分支**：OpenCV 置信度 < 0.05 → 降级到 `slider-yunma`

#### 配方2: slider-yunma（云码API滑块识别）

```python
# 优先级：OpenCV后的兜底方案
# 依赖：requests
import requests, base64

def recognize_slider_yunma(bg_b64: str, slider_b64: str, token: str = None) -> int:
    """云码API双图滑块识别
    返回：缺口 x 坐标
    """
    url = "http://api.jfbym.com/api/YmServer/customApi"
    resp = requests.post(url, data={
        "token": token or os.environ.get("YUNMA_TOKEN", ""),
        "type": "20111",  # 滑块类型
        "image": bg_b64,  # 背景图base64
        "extra_image": slider_b64,  # 滑块图base64（如有双图接口）
    })
    data = resp.json()
    if data.get("code") == 10000:
        return int(data["data"]["data"])
    raise ValueError(f"云码识别失败: {data}")
```

**失败分支**：API超时3次 → 换ddddocr做最后兜底

#### 配方3: click-yunma（点选识别）

```python
# type=30103 点选验证码
# type=30008 九宫格（阿里Baxia）
def recognize_click_yunma(img_b64: str, extra: str = "click", token: str = None):
    resp = requests.post(url, data={
        "token": token,
        "type": "30103",  # 或 "30008"
        "image": img_b64,
        "extra": extra,
    })
```

#### 配方4: arithmetic-ddddocr（算术验证码）

```python
# 依赖：ddddocr
import ddddocr
def solve_arithmetic(img_bytes: bytes) -> str:
    ocr = ddddocr.DdddOcr(show_ad=False)
    expr = ocr.classification(img_bytes)
    # 清洗OCR结果，eval计算
    expr = expr.replace("=", "").replace("?", "").replace("x", "*")
    return str(eval(expr))
```

---

### 二、轨迹生成配方

#### 配方5: trajectory-bezier（贝塞尔曲线轨迹）

```python
import random, math

def generate_trajectory(distance: int, duration_ms: int = 1000) -> list:
    """贝塞尔曲线 + 过冲回拉 + Y轴抖动
    返回：[[x, y, elapsed_ms], ...]
    """
    points = []
    # 参数
    overshoot = random.randint(3, 8)  # 过冲量
    y_jitter = lambda: random.randint(-3, 3)
    
    # 阶段1：加速 (0 → 70%)
    steps1 = int(duration_ms * 0.4 / 15)
    for i in range(steps1):
        t = i / steps1
        x = int(distance * 0.7 * t * t)  # 二次加速
        points.append([x, y_jitter(), i * 15])
    
    # 阶段2：匀速过冲 (70% → 100%+overshoot)
    steps2 = int(duration_ms * 0.2 / 15)
    for i in range(steps2):
        t = i / steps2
        x = int(distance * 0.7 + (distance * 0.3 + overshoot) * t)
        points.append([x, y_jitter(), int(duration_ms * 0.4) + i * 15])
    
    # 阶段3：回拉到目标
    steps3 = int(duration_ms * 0.1 / 15)
    for i in range(steps3):
        t = i / steps3
        x = int(distance + overshoot - overshoot * t)
        points.append([x, y_jitter(), int(duration_ms * 0.6) + i * 15])
    
    # 阶段4：停留抖动
    steps4 = int(duration_ms * 0.3 / 15)
    for i in range(steps4):
        points.append([distance + random.randint(-1, 1), y_jitter(), int(duration_ms * 0.7) + i * 15])
    
    return points
```

#### 配方6: trajectory-5phase（五段式物理轨迹）

```python
# 腾讯TCaptcha专用
# 匀加速 → 匀速 → 匀减速 → 微调 → 停留
def generate_5phase_trajectory(distance: int) -> list:
    """五段式物理模型轨迹"""
    # ... 完整实现参考 sites/tcaptcha/src/trajectory.py（完整实现参考项目内示例文件，非必需）
```

#### 配方7: trajectory-diff（差分编码轨迹）

```python
# 极验4专用
# 3个轨迹点确保w=640，差分编码
def generate_diff_trajectory(gap_x: int) -> list:
    """差分编码轨迹，3点固定长度"""
    # ... 完整实现参考 sites/crv-captcha/src/test_full_protocol.py（完整实现参考项目内示例文件，非必需）
```

---

### 三、加密提交配方

> 以下加密配方服务于验证码提交流程（与轨迹+坐标一起使用）。非验证码的加密参数场景使用 `param-encryptor`。

#### 配方8: encrypt-aes-cbc（AES-CBC加密验证码数据）

```python
# 适用：极验3/4、B站极验、大众点评
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad
import base64

def aes_cbc_encrypt(data: str, key: bytes, iv: bytes = b'0' * 16) -> str:
    """AES-128-CBC + PKCS7 + Base64"""
    cipher = AES.new(key, AES.MODE_CBC, iv)
    encrypted = cipher.encrypt(pad(data.encode(), 16))
    return base64.b64encode(encrypted).decode()
```

#### 配方9: encrypt-des-ecb（DES-ECB加密·数美专用）

```python
# 数美滑块12个参数独立DES加密
from Crypto.Cipher import DES

DES_KEYS = {
    'wi': b'363f9192', 'gq': b'ffd9ef14', 'vs': b'80fefdd1',
    'lx': b'61ad6eff', 'es': b'620302a1', 'jq': b'118c4021',
    'zm': b'da718702', 'tx': b'786ef59e', 'ww': b'36937571',
    'bb': b'bd7d3fb7', 'vj': b'b7cdc6b2', 'hq': b'42ccd3c8',
}

def des_ecb_encrypt(data: str, key: bytes) -> str:
    """DES-ECB + 零填充 + Base64"""
    data_bytes = data.encode()
    pad_len = 8 - len(data_bytes) % 8
    data_bytes += b'\x00' * pad_len
    cipher = DES.new(key, DES.MODE_ECB)
    return base64.b64encode(cipher.encrypt(data_bytes)).decode()
```

#### 配方10: encrypt-xor（XOR编码·网易易盾专用）

```python
def xor_encode(token: str, data: str) -> str:
    """XOR编码，token作密钥"""
    return ''.join(chr(ord(c) ^ ord(token[i % len(token)])) for i, c in enumerate(data))
```

---

## 行为建模增强

> 验证码检测不仅看结果（坐标是否正确），还看过程（轨迹是否像人类、操作时序是否自然）。
> 以下是对抗行为分析的系统性建模方法。

### 鼠标加速度曲线建模

```python
import random
import math

class MouseBehaviorModel:
    """鼠标行为模型：模拟人类从起点移动到目标的完整过程
    
    人类特征：
    1. 起动阶段：加速度从 0 逐渐增大（不是瞬间达到最大速度）
    2. 接近阶段：在目标附近减速（不是精确停在目标上）
    3. 微调阶段：到达后做微小调整（±1-3px）
    4. 点击前有短暂停留（100-300ms）
    """
    
    @staticmethod
    def generate_mouse_path(start_x, start_y, end_x, end_y, duration_ms=800):
        """生成从起点到终点的鼠标移动路径"""
        points = []
        distance = math.sqrt((end_x - start_x)**2 + (end_y - start_y)**2)
        
        # 贝塞尔控制点：加入随机弧度（人类不会直线移动）
        mid_offset = random.randint(10, 30) * random.choice([-1, 1])
        ctrl_x = (start_x + end_x) / 2 + mid_offset
        ctrl_y = (start_y + end_y) / 2 + random.randint(-15, 15)
        
        steps = int(duration_ms / 15)  # ~15ms 采样间隔
        for i in range(steps):
            t = i / steps
            # 贝塞尔插值
            x = (1-t)**2 * start_x + 2*(1-t)*t * ctrl_x + t**2 * end_x
            y = (1-t)**2 * start_y + 2*(1-t)*t * ctrl_y + t**2 * end_y
            
            # 速度曲线：缓入缓出（sigmoid-like）
            speed_factor = 4 * t * (1 - t)  # 抛物线，中间快两端慢
            # 加入加速度抖动
            x += random.gauss(0, 0.5) * (1 - speed_factor)
            y += random.gauss(0, 0.3)
            
            points.append([round(x, 1), round(y, 1), i * 15])
        
        # 到达后微调（模拟人类手抖）
        for _ in range(random.randint(2, 5)):
            t = points[-1][2] + random.randint(50, 150)
            points.append([
                end_x + random.gauss(0, 1.2),
                end_y + random.gauss(0, 0.8),
                t
            ])
        
        return points
```

### 点击热区分布建模

```python
class ClickHeatmapModel:
    """点击热区模型：人类不会精确点击按钮中心
    
    人类点击特征：
    1. 点击位置围绕目标中心呈高斯分布
    2. 标准差约 5-15px（取决于按钮大小）
    3. 偏好偏上方和偏右方（右手习惯）
    4. 连续点击位置不会完全相同
    """
    
    @staticmethod
    def human_click(center_x, center_y, button_size=50):
        """生成一个人类风格的点击坐标
        
        Args:
            center_x, center_y: 按钮中心坐标
            button_size: 按钮直径（像素）
        Returns:
            (click_x, click_y): 点击坐标
        """
        # 标准差约为按钮尺寸的 10-20%
        sigma = button_size * random.uniform(0.1, 0.2)
        
        # 偏右偏上偏好（右手习惯）
        offset_x = random.gauss(sigma * 0.3, sigma)
        offset_y = random.gauss(-sigma * 0.2, sigma)
        
        click_x = center_x + offset_x
        click_y = center_y + offset_y
        
        return round(click_x), round(click_y)
```

### 操作时序建模

```python
class OperationTimingModel:
    """操作时序模型：控制各步骤之间的时间间隔
    
    验证码 SDK 会检测：
    1. 图片加载到开始操作的时间（人类需要 0.5-3s 观察图片）
    2. 滑动/点击的持续时间（太快或太慢都是可疑的）
    3. 操作结束到提交的时间（人类会检查结果再提交）
    """
    
    @staticmethod
    def observation_delay(image_complexity='normal'):
        """图片观察时间（从图片加载完成到开始操作）
        
        Args:
            image_complexity: 'simple'(算术题)/'normal'(标准滑块)/'complex'(点选/九宫格)
        """
        ranges = {
            'simple': (300, 800),     # 简单验证码：0.3-0.8s
            'normal': (800, 2500),    # 标准滑块：0.8-2.5s
            'complex': (2000, 5000),  # 点选/九宫格：2-5s
        }
        low, high = ranges.get(image_complexity, ranges['normal'])
        return random.uniform(low, high) / 1000  # 返回秒
    
    @staticmethod
    def slide_duration(distance_px):
        """滑动持续时间（基于距离的自然映射）
        
        人类特征：
        - 短距离(50-100px)：300-600ms
        - 中距离(100-200px)：500-1000ms
        - 长距离(200-300px)：800-1500ms
        - 有自然变异（同距离多次滑动时间不同）
        """
        base = 300 + distance_px * 3  # 基础时间与距离正相关
        jitter = random.uniform(-100, 200)  # 自然变异
        return (base + jitter) / 1000  # 返回秒
    
    @staticmethod
    def verification_delay():
        """操作完成到提交的延迟（人类会检查结果）
        
        人类特征：
        - 滑块：松手后等 0.2-0.8s 再提交
        - 点选：最后一个点选后等 0.5-1.5s
        """
        return random.uniform(0.2, 0.8)
```

---

## 服务商专项流程

### 腾讯TCaptcha 完整流程

```
1. prehandle → 获取 sess, pow_cfg, 图片URL
2. getsig → 更新 sess
3. 下载背景图+滑块图 → OpenCV/云码识别缺口
4. 生成五段式轨迹 + TDC环境指纹
5. 计算POW: MD5(prefix + nonce) 匹配目标前缀
6. 组装 collect + ans + pow_answer
7. verify → 获取 ticket + randstr
```

### 极验4 三步协议

```
1. load(风险类型=slide) → lot_number, pt=10
2. verify1(预fail) → 正常流程，result=fail
3. load(带lot_number) → 获取图片, 新lot_number
4. verify2(含轨迹+w参数) → result=success, pass_token
```

w参数 = 自定义Base64(AES-CBC(JSON(s对象))) + RSA(AES密钥).hex()

### 网易易盾 完整流程

```
1. getconf → dt, zoneId, ir配置
2. IR上报 → Node.js VM加载ir.2.0.13.min.js → 指纹数据
3. get → 验证码图片
4. OpenCV alpha mask识别缺口
5. 合成轨迹（过冲回拉+正弦波动）
6. check数据加密:
   d = AES(采样轨迹.join(':'))
   p = AES(xorEncode(token, 百分比距离))
   f = AES(xorEncode(token, 归一化轨迹.join(',')))
   ext = AES(xorEncode(token, mousedownCounts + ',' + 轨迹长度))
```

---

## 失败模式编码

| 症状 | 原因 | 一线修复 | 仍失败兜底 |
|------|------|---------|-----------|
| OpenCV置信度<0.1 | 图片加密/格式异常 | 检查是否WASM解密后图片 | 降级云码API |
| 验证码提交返回-1 | 轨迹被识别为机器人 | 增加过冲量+Y抖动幅度 | 换五段式轨迹 |
| 验证码提交返回参数错误 | 加密参数格式不对 | 对比浏览器抓包明文 | 检查IV/Key/Mode |
| 云码API超时 | 网络或Token过期 | 重试3次+换Token | ddddocr兜底 |
| WASM解密零像素(银河票务) | WASM环境不完整 | 检查内存/导入函数 | 换IDA分析WASM |
| ticket立即失效 | 时间戳偏差>5s | 同步服务器时间 | 用服务器返回的时间 |

---

## 反模式黑名单

| # | 不要做 | 替代 |
|---|--------|------|
| 1 | 用Selenium/Playwright过验证码 | 纯协议请求 |
| 2 | 猜测加密密钥 | 动态调试Hook实证 |
| 3 | 轨迹直线到达 | 必须模拟人类过冲+抖动 |
| 4 | 固定时间间隔 | 随机化15±5ms |
| 5 | 跳过环境指纹直接提交 | 必须附加设备指纹 |
| 6 | 一家验证码服务商方案通吃 | 每家有独立加密逻辑 |
| 7 | 长时间持有验证码session | 获取后立即提交(有效期30-120s) |

---

## 依赖清单

```
# Python
pip install opencv-python ddddocr pycryptodome requests loguru

# 第三方API（可选）
云码API Token: 环境变量 YUNMA_TOKEN
```

---

## 产出规范

每次验证码求解必须产出：

1. **识别结果** — 缺口x坐标/点选坐标/算术答案
2. **轨迹数据** — 完整的[[x,y,t], ...]数组
3. **加密参数** — 加密后的验证码提交参数
4. **ticket/validate** — 服务端返回的验证通过凭证
5. **时效记录** — 各步骤耗时，总耗时<5s为合格

---

## Related Skills

| Skill | 职责 | 何时调用 |
|-------|------|---------|
| `web-reverse-master` | 全流程编排 | 需要分析验证码加密逻辑但尚未确认算法类型 |
| `param-encryptor` | 加密参数生成 | 验证码之外的非验证码加密参数场景 |
| `env-patcher` | 补环境生成 | 验证码 SDK 需要在 Node.js 中运行时 |
| `ast-deobfuscation` | JS 反混淆 | 验证码 JS 混淆严重需先反混淆 |
