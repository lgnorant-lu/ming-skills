"""
京东商品搜索 - H5ST签名 (Node.js补环境)
方案: env.js补环境 + sign_server.js生成H5ST + requests调API

使用步骤:
  1. Chrome打开 search.jd.com 搜索任意关键词
  2. F12 → Application → Cookies → 复制以下cookie到下面COOKIES字典
  3. 修改 SEARCH_KW 为要搜索的关键词
  4. python main.py
"""

import requests, subprocess, json, time, os, urllib.parse

# ========== 改这里 ==========
SEARCH_KW = "白酒"           # 搜索关键词
MAX_PAGES = 3                # 最大页数

# 从浏览器F12复制最新的cookie (必需!)
COOKIES = {
    "__jdu": "17805909957251389212626",    # 改!
    "__jda": "76161171.17805909957251389212626.1780590996.1780590996.1780590996.1",
    "__jdc": "76161171",
    "areaId": "6",
    "ipLoc-djd": "6-379-0-0",
    # 添加更多cookie以提高成功率
}
# ============================

DIR = os.path.dirname(__file__)
_proc = None


def start_server():
    global _proc
    if _proc: return
    _proc = subprocess.Popen(
        ["node", "sign_server.js"], cwd=DIR,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True,
    )
    print("[+] Waiting for sign server init (5s)...")
    time.sleep(5)


def get_h5st(page=1):
    _proc.stdin.write(f"{page}\n")
    _proc.stdin.flush()
    line = _proc.stdout.readline()
    return json.loads(line)


def search():
    start_server()
    for p in range(1, MAX_PAGES + 1):
        d = get_h5st(p)
        if "error" in d:
            print(f"[-] Sign failed: {d['error']}")
            break

        h5st = d["h5st"]
        kw = urllib.parse.quote(SEARCH_KW)
        body_enc = urllib.parse.quote(
            json.dumps(d.get("rawData", {}))
        )

        url = (
            f"https://api.m.jd.com/api"
            f"?appid=search-pc-java"
            f"&t={d['t']}"
            f"&client=pc"
            f"&clientVersion=1.0.0"
            f"&functionId=pc_search_searchWare"
            f"&keyword={kw}"
            f"&body={body_enc}"
            f"&h5st={urllib.parse.quote(h5st)}"
            f"&x-api-eid-token=jdd035BZRDIN46OPPTUS7RBYR47Y5HEYB7HQJFONHHJFLF4XZL7SSYT3RL27BDQ7TYE3FBFWQFB6F2CZOM7D3BDORZ7QC44AAAAM6SOQHEKIAAAAACZKY3CRSSYGFEIX"
        )

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": f"https://search.jd.com/Search?keyword={kw}",
        }

        r = requests.get(url, headers=headers, cookies=COOKIES, timeout=15)
        print(f"[page {p}] Status: {r.status_code}")

        if r.status_code == 200:
            try:
                data = r.json()
                items = data.get("data", [])
                print(f"  Items: {len(items)}")
                for item in items[:5]:
                    name = (
                        item.get("wareInfo", {}).get("wname", "")
                        or item.get("wname", "")
                    )
                    print(f"  - {name[:50]}")
            except Exception as e:
                print(f"  Parse error: {e}")
                print(f"  Raw: {r.text[:300]}")
        else:
            print(f"  Error: {r.text[:200]}")
            break
        time.sleep(1)

    _proc.stdin.write("EXIT\n")
    _proc.stdin.flush()
    _proc.terminate()


if __name__ == "__main__":
    search()
