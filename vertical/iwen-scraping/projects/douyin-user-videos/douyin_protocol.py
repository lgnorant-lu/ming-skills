"""
抖音用户主页视频爬取 - 协议版
原理: 从浏览器一次性获取cookie → Python requests直接调API
Cookie中的__ac_nonce/__ac_signature/passport_csrf_token替代了a_bogus验证
"""
import json, time, os, urllib.request, requests, websocket, re


class DouyinCookieManager:
    def __init__(self, port=9222):
        self.port = port

    def _find_page(self):
        resp = urllib.request.urlopen("http://127.0.0.1:%d/json" % self.port)
        for tab in json.loads(resp.read()):
            if "douyin.com" in tab.get("url", "") and tab["type"] == "page":
                return tab["id"], tab["url"]
        raise Exception("Chrome中未找到抖音页面")

    def get_credentials(self):
        page_id, page_url = self._find_page()
        ws_url = "ws://127.0.0.1:%d/devtools/page/%s" % (self.port, page_id)
        ws = websocket.create_connection(ws_url, timeout=15)
        mid = [0]

        def send(m, p=None):
            mid[0] += 1
            ws.send(json.dumps({"id": mid[0], "method": m, "params": p or {}}))

        def recv():
            while True:
                d = json.loads(ws.recv())
                if "result" in d: return d["result"]

        try:
            send("Network.enable"); recv()
            send("Network.getCookies", {"urls": ["https://www.douyin.com"]})
            cookies = recv()["cookies"]
            cookie_str = "; ".join(["%s=%s" % (c["name"], c["value"]) for c in cookies])

            m = re.search(r"/user/(MS4w\w+)", page_url)
            sec_uid = m.group(1) if m else ""

            webid = "_"
            vfp = ""
            for c in cookies:
                if c["name"] == "webid": webid = c["value"]
                if c["name"] == "s_v_web_id" and "verify_" in c["value"]: vfp = c["value"]

            send("Runtime.evaluate", {"expression": "navigator.userAgent", "returnByValue": True})
            ua = recv()["result"]["value"]
        finally:
            ws.close()

        return {"cookie": cookie_str, "ua": ua, "webid": webid, "verify_fp": vfp, "sec_user_id": sec_uid}


class DouyinUserScraper:
    def __init__(self, cm):
        self.cm = cm
        self.creds = None

    def refresh(self):
        print("[*] Getting credentials from browser...")
        self.creds = self.cm.get_credentials()
        print("[+] Got %d cookies" % len(self.creds["cookie"].split(";")))

    def get_videos(self, sec_user_id=None, max_pages=20):
        if not self.creds: self.refresh()

        sec_uid = sec_user_id or self.creds.get("sec_user_id", "")
        all_videos, seen_ids, seen_cursors = [], set(), set()
        cursor, retry = "0", 0

        for page in range(max_pages):
            params = {
                "device_platform": "webapp", "aid": "6383", "channel": "channel_pc_web",
                "sec_user_id": sec_uid, "max_cursor": cursor, "count": "18",
                "publish_video_strategy_type": "2", "update_version_code": "170400",
                "pc_client_type": "1", "version_code": "170400", "version_name": "17.4.0",
                "cookie_enabled": "true", "screen_width": "1280", "screen_height": "800",
                "browser_language": "zh-CN", "browser_platform": "Win32",
                "browser_name": "Chrome", "browser_version": "148.0.0.0",
                "browser_online": "true", "engine_name": "Blink", "engine_version": "148.0.0.0",
                "os_name": "Windows", "os_version": "10", "cpu_core_num": "12",
                "device_memory": "16", "platform": "PC", "downlink": "10",
                "effective_type": "4g", "round_trip_time": "50",
                "webid": self.creds.get("webid", ""),
                "verifyFp": self.creds.get("verify_fp", ""),
                "fp": self.creds.get("verify_fp", ""),
            }
            headers = {
                "User-Agent": self.creds["ua"],
                "Cookie": self.creds["cookie"],
                "Referer": "https://www.douyin.com/user/%s" % sec_uid,
                "Accept": "application/json, text/plain, */*",
            }

            print("[*] Page %d cursor=%s" % (page + 1, cursor))
            try:
                qs = "&".join(["%s=%s" % (k, v) for k, v in params.items()])
                resp = requests.get("https://www.douyin.com/aweme/v1/web/aweme/post/?" + qs,
                                    headers=headers, timeout=15)
                data = resp.json()
            except Exception as e:
                print("[-] Request error: %s" % e)
                if retry < 2: retry += 1; self.refresh(); continue
                break

            if data.get("status_code") != 0:
                print("[-] API error: %s" % data.get("status_msg", ""))
                if retry < 2: retry += 1; self.refresh(); continue
                break

            aweme_list = data.get("aweme_list", [])
            if not aweme_list: print("[*] No more videos"); break

            new = [v for v in aweme_list if v.get("aweme_id") not in seen_ids]
            for v in new: seen_ids.add(v.get("aweme_id"))
            all_videos.extend(new)
            print("[+] +%d new (total %d)" % (len(new), len(all_videos)))
            retry = 0

            if not data.get("has_more"): print("[*] All fetched"); break
            cursor = str(data.get("max_cursor", 0))
            if cursor in seen_cursors: print("[*] Cursor cycle"); break
            seen_cursors.add(cursor)
            time.sleep(0.5)

        return all_videos


def parse_video(aweme):
    s = aweme.get("statistics", {}) or {}
    v = aweme.get("video", {}) or {}
    a = aweme.get("author", {}) or {}
    m = aweme.get("music", {}) or {}
    return {
        "aweme_id": aweme.get("aweme_id"),
        "desc": aweme.get("desc", ""),
        "create_time": aweme.get("create_time"),
        "duration": v.get("duration", 0),
        "author": a.get("nickname", ""),
        "digg_count": s.get("digg_count", 0),
        "comment_count": s.get("comment_count", 0),
        "share_count": s.get("share_count", 0),
        "play_count": s.get("play_count", 0),
        "video_url": ((v.get("play_addr") or {}).get("url_list") or [""])[0],
        "cover_url": ((v.get("cover") or {}).get("url_list") or [""])[0],
        "music_title": m.get("title", ""),
    }


def main():
    print("=" * 50)
    print("Douyin User Videos (Protocol)")
    print("=" * 50)
    cm = DouyinCookieManager()
    scraper = DouyinUserScraper(cm)
    sec_uid = "MS4wLjABAAAAR6iHjUDDEP6gvIv4OMnD0ZyulltvQtsA1axnAu2p5-E"

    try:
        videos = scraper.get_videos(sec_uid, max_pages=20)
        print("\n[=] Total: %d videos" % len(videos))
        results = [parse_video(v) for v in videos]

        out = os.path.join(os.path.dirname(__file__), "videos_protocol.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print("[=] Saved: %s" % out)

        print("\n--- Top 10 ---")
        for i, r in enumerate(results[:10], 1):
            d = r["desc"].replace("\n", " ")[:50]
            print("%2d. [%s]" % (i, d))
            print("    likes=%s comments=%s shares=%s" % (r["digg_count"], r["comment_count"], r["share_count"]))
    except Exception as e:
        print("Error: %s" % e)
        print("Make sure Chrome is open with --remote-debugging-port=9222 and logged into douyin.com")


if __name__ == "__main__":
    main()
