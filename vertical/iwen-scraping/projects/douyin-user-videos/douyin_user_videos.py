"""
抖音用户主页视频爬取
方案：CDP协议方案 — 在浏览器环境内调用API，利用已有的cookie和签名环境
优点：不需要逆向a_bogus，浏览器自动生成签名
"""

import websocket
import json
import time
import os
import re

class DouyinUserVideos:
    """通过CDP在浏览器环境内调用抖音API获取用户视频"""

    def __init__(self, page_id=None):
        # 获取抖音页面ID
        if not page_id:
            page_id = self._find_douyin_page()
        self.ws_url = f"ws://127.0.0.1:9222/devtools/page/{page_id}"
        self.ws = None
        self.msg_id = 0

    def _find_douyin_page(self):
        """自动找到抖音标签页"""
        import urllib.request
        resp = urllib.request.urlopen("http://127.0.0.1:9222/json")
        tabs = json.loads(resp.read())
        for tab in tabs:
            if "douyin.com" in tab.get("url", ""):
                return tab["id"]
        raise Exception("未找到抖音页面，请先在Chrome中打开抖音")

    def connect(self):
        self.ws = websocket.create_connection(self.ws_url, timeout=30)
        self.msg_id = 0
        self._send("Runtime.enable")
        self._recv()

    def _send(self, method, params=None):
        self.msg_id += 1
        msg = {"id": self.msg_id, "method": method}
        if params:
            msg["params"] = params
        self.ws.send(json.dumps(msg))

    def _recv(self):
        while True:
            data = json.loads(self.ws.recv())
            if "result" in data:
                return data["result"]
            if "error" in data:
                raise Exception(f"CDP Error: {data['error']}")

    def close(self):
        if self.ws:
            self.ws.close()

    def get_videos(self, sec_user_id, max_cursor="0", count=18):
        """在浏览器环境内调用视频API"""
        script = f"""
        (async function() {{
            const params = new URLSearchParams({{
                device_platform: 'webapp',
                aid: '6383',
                channel: 'channel_pc_web',
                sec_user_id: '{sec_user_id}',
                max_cursor: '{max_cursor}',
                locate_query: 'false',
                show_live_replay_strategy: '1',
                need_time_list: '1',
                count: '{count}',
                publish_video_strategy_type: '2',
                update_version_code: '170400',
                pc_client_type: '1',
                version_code: '170400',
                version_name: '17.4.0',
                cookie_enabled: 'true',
                screen_width: '1280',
                screen_height: '800',
                browser_language: 'zh-CN',
                browser_platform: 'Win32',
                browser_name: 'Chrome',
                browser_version: '148.0.0.0',
                browser_online: 'true',
                engine_name: 'Blink',
                engine_version: '148.0.0.0',
                os_name: 'Windows',
                os_version: '10',
                cpu_core_num: '12',
                device_memory: '16',
                platform: 'PC',
                downlink: '10',
                effective_type: '4g',
                round_trip_time: '50',
                webid: '7647795773287204358',
                msToken: document.querySelector('meta[name="msToken"]')?.content || '',
                verifyFp: 'verify_mq0jt1co_e827udWo_g2Kt_4U3n_AFPx_LD6EetzTuHr6',
                fp: 'verify_mq0jt1co_e827udWo_g2Kt_4U3n_AFPx_LD6EetzTuHr6',
            }});

            const url = '/aweme/v1/web/aweme/post/?' + params.toString();
            const resp = await fetch(url, {{
                method: 'GET',
                credentials: 'include',
                headers: {{
                    'Accept': 'application/json, text/plain, */*',
                    'Referer': 'https://www.douyin.com/user/{sec_user_id}',
                }}
            }});

            const text = await resp.text();
            console.log('__DOUYIN_RESULT__' + text);
        }})()
        """
        self._send("Runtime.evaluate", {"expression": script, "returnByValue": True})
        self._recv()

        # 等异步结果
        start = time.time()
        while time.time() - start < 10:
            try:
                self.ws.settimeout(3)
                data = json.loads(self.ws.recv())
                if data.get("method") == "Runtime.consoleAPICalled":
                    for arg in data.get("params", {}).get("args", []):
                        val = str(arg.get("value", ""))
                        if "__DOUYIN_RESULT__" in val:
                            return json.loads(val.replace("__DOUYIN_RESULT__", ""))
            except:
                pass

        return None

    def get_all_videos(self, sec_user_id, max_pages=20):
        """获取用户全部视频"""
        all_videos = []
        seen_ids = set()
        seen_cursors = set()
        max_cursor = "0"
        page = 0

        while page < max_pages:
            print(f"Getting page {page+1}... cursor={max_cursor}")
            result = self.get_videos(sec_user_id, max_cursor)

            if not result or result.get("status_code") != 0:
                print(f"  Request failed: {result}")
                break

            aweme_list = result.get("aweme_list", [])
            if not aweme_list:
                print("  No more videos")
                break

            # Dedup
            new_videos = [v for v in aweme_list if v.get("aweme_id") not in seen_ids]
            for v in new_videos:
                seen_ids.add(v.get("aweme_id"))
            all_videos.extend(new_videos)
            print(f"  Got {len(new_videos)} new videos (total {len(all_videos)})")

            has_more = result.get("has_more", 0)
            max_cursor = result.get("max_cursor", 0)

            if not has_more or max_cursor == 0:
                print("  All videos fetched")
                break

            # Prevent infinite loop
            if str(max_cursor) in seen_cursors:
                print("  Cursor cycle detected, stopping")
                break
            seen_cursors.add(str(max_cursor))

            page += 1
            time.sleep(1)

        return all_videos


def parse_video_info(aweme):
    """从API返回中提取有用信息"""
    return {
        "aweme_id": aweme.get("aweme_id"),
        "desc": aweme.get("desc", ""),
        "create_time": aweme.get("create_time"),
        "duration": aweme.get("video", {}).get("duration", 0),
        "play_count": aweme.get("statistics", {}).get("play_count", 0),
        "digg_count": aweme.get("statistics", {}).get("digg_count", 0),
        "comment_count": aweme.get("statistics", {}).get("comment_count", 0),
        "share_count": aweme.get("statistics", {}).get("share_count", 0),
        "video_url": aweme.get("video", {}).get("play_addr", {}).get("url_list", [""])[0],
        "cover_url": aweme.get("video", {}).get("cover", {}).get("url_list", [""])[0],
    }


def main():
    # 贪玩歌姬小宁子的 sec_user_id
    sec_user_id = "MS4wLjABAAAAR6iHjUDDEP6gvIv4OMnD0ZyulltvQtsA1axnAu2p5-E"

    print("=" * 60)
    print("抖音用户主页视频爬取")
    print("=" * 60)

    crawler = DouyinUserVideos()
    crawler.connect()

    try:
        # 获取视频列表
        videos = crawler.get_all_videos(sec_user_id, max_pages=20)
        print(f"\n共获取到 {len(videos)} 个视频")

        # 解析信息
        results = [parse_video_info(v) for v in videos]

        # 保存为JSON
        output_path = os.path.join(os.path.dirname(__file__), "videos.json")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"已保存到 {output_path}")

        # 打印摘要
        print("\n" + "=" * 60)
        print("Top 10 Videos:")
        for i, v in enumerate(results[:10], 1):
            desc = v['desc'][:50].replace('\n',' ')
            print(f"  {i}. [{desc}]")
            print(f"     likes={v['digg_count']} plays={v['play_count']} comments={v['comment_count']}")

    finally:
        crawler.close()


if __name__ == "__main__":
    main()
