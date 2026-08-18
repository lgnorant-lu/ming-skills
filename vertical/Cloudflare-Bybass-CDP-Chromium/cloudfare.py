import requests
import websocket
import json
import time
import random
import math

id_counter = 0
mouse_state = {"x": random.randint(200, 600), "y": random.randint(200, 600)}


# [CDP 核心通信函数保持不变...]
def send_cdp(ws,method,parmas=None):
    global id_counter
    ws.send(json.dumps({
        'id': id_counter,
        'method': method,
        'params': parmas if parmas is not None else {}
    }))
    print('发送包->',id_counter,method,parmas)
    while True:
        result=json.loads(ws.recv())
        if 'id' in result and result['id'] == id_counter:
            print('接受包->', result)
            id_counter+=1
            return result
        else:
            continue
    return None


def ruyi_navigator(ws, url): send_cdp(ws, 'Page.navigate', {'url': url})


def ruyi_getDocument(ws): return send_cdp(ws, 'DOM.getDocument', {'depth': -1})


def ruyi_querySelector(ws, root_id, selector): return send_cdp(ws, 'DOM.querySelector',
                                                               {'nodeId': root_id, 'selector': selector})


def cdp_box(ws, node_id): return send_cdp(ws, "DOM.getBoxModel", {"nodeId": node_id})


def ruyi_evaluate(ws, params): return send_cdp(ws, 'Runtime.evaluate', params)


def dispatch_mouse(ws, type_, x, y, button="none"):
    send_cdp(ws, "Input.dispatchMouseEvent", {"type": type_, "x": float(x), "y": float(y), "button": button,
                                              "clickCount": 1 if "Down" in type_ or "Up" in type_ else 0})


def human_move(ws, target_x, target_y):
    global mouse_state
    start_x, start_y = mouse_state["x"], mouse_state["y"]
    steps = 20
    for i in range(steps + 1):
        t = 1 - (1 - i / steps) ** 2
        x = start_x + (target_x - start_x) * t
        y = start_y + (target_y - start_y) * t
        dispatch_mouse(ws, "mouseMoved", x, y)
        time.sleep(0.01)
    mouse_state = {"x": target_x, "y": target_y}


# ===== 核心：超级搜索函数 =====
def find_cf_iframe_robust(ws):
    print("🔍 正在全量扫描节点特征...")
    # 获取最新的扁平化文档
    res = send_cdp(ws, "DOM.getFlattenedDocument", {"depth": -1, "pierce": True})
    nodes = res.get("result", {}).get("nodes", [])

    # 方案 1：寻找带有 cloudflare 标志的 iframe
    for node in nodes:
        if node.get("nodeName") == "IFRAME":
            attrs = dict(zip(node.get("attributes", [])[::2], node.get("attributes", [])[1::2]))
            src = attrs.get("src", "")
            title = attrs.get("title", "")
            if "challenges.cloudflare.com" in src or "Cloudflare" in title:
                print(f"🎯 发现目标 Iframe! NodeId: {node['nodeId']}")
                return node["nodeId"]

    # 方案 2：寻找 Turnstile 的容器 (即便 iframe 还没加载，我们也可以预判它的位置)
    for node in nodes:
        attrs = dict(zip(node.get("attributes", [])[::2], node.get("attributes", [])[1::2]))
        node_id = attrs.get("id", "")
        # 匹配 cf-chl-widget-xxxx 这种模式
        if "cf-chl-widget-" in node_id and node.get("nodeName") == "DIV":
            print(f"📍 发现验证码容器 DIV! NodeId: {node['nodeId']}")
            # 这里的思路是：如果还没看到 iframe，我们就点击这个容器的中心位置
            return node["nodeId"]

    return None


def click_cloudflare_turnstile_hardcore(ws, node_id):
    # 1. 获取精确盒模型
    res = send_cdp(ws, "DOM.getBoxModel", {"nodeId": node_id})
    if "result" not in res: return False

    # content 区域坐标 [x1, y1, x2, y2, x3, y3, x4, y4]
    box = res["result"]["model"]["content"]
    iframe_left = box[0]
    iframe_top = box[1]

    # 针对 300x65 规格的 Turnstile，复选框中心点通常在 (35, 32)
    target_x = iframe_left + 35 + random.uniform(-2, 2)
    target_y = iframe_top + 32 + random.uniform(-2, 2)

    # 2. 关键：强制让浏览器焦点落在该节点上
    send_cdp(ws, "DOM.focus", {"nodeId": node_id})
    time.sleep(0.2)

    # 3. 拟人化移动
    human_move(ws, target_x, target_y)
    time.sleep(0.3)

    common_params = {
        "x": target_x,
        "y": target_y,
        "screenX": target_x + 10,  # 模拟窗口在屏幕上的偏移
        "screenY": target_y + 100,
        "button": "left",
        "clickCount": 1,
        "pointerType": "mouse"
    }

    print(f"🚀 发送硬核点击事件到: ({target_x}, {target_y})")

    # 按下 (mousePressed)
    press_params = common_params.copy()
    press_params["type"] = "mousePressed"
    send_cdp(ws, "Input.dispatchMouseEvent", press_params)

    time.sleep(random.uniform(0.1, 0.2))  # 模拟人类按下的时长

    # 抬起 (mouseReleased)
    release_params = common_params.copy()
    release_params["type"] = "mouseReleased"
    send_cdp(ws, "Input.dispatchMouseEvent", release_params)

    return True
# ===== 主流程 =====
url = "http://127.0.0.1:9222/json"
pages = requests.get(url).json()
ws_url = next(
    (p['webSocketDebuggerUrl'] for p in pages if p.get('type') == 'page' and 'DevTools' not in p.get('title', '')),
    None)
ws = websocket.create_connection(ws_url)

send_cdp(ws, 'DOM.enable')      # 开启 DOM 代理，解决你现在的报错
print("✅ 所有 CDP 代理域已启用。")

print("-> 正在前往 SteamDB...")
ruyi_navigator(ws, "https://steamdb.info/")
time.sleep(5)
# 循环探测，最多等待 20 秒
iframe_id = None
for attempt in range(10):
    print(f"⏳ 第 {attempt + 1} 次尝试探测验证码...")
    iframe_id = find_cf_iframe_robust(ws)
    if iframe_id:
        break
    time.sleep(1)

if iframe_id:
    click_cloudflare_turnstile_hardcore(ws, iframe_id)
    print("✅ 已点击验证码，请观察浏览器。")
    time.sleep(10)
else:
    print("❌ 所有的探测方案都失败了，请确认页面是否真的出现了验证码。")

ws.close()