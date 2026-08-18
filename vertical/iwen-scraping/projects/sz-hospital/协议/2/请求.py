"""
深圳大学总医院 - 新闻列表爬取
Target: https://sugh.szu.edu.cn/Html/News/Columns/540/Index.html
Anti-bot: 瑞数(TLS指纹检测 → Python requests/curl_cffi均412)
Solution: CDP获取真实Chrome渲染的HTML → 正则解析新闻列表
"""

import websocket, json, time, os, re, urllib.request


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")


def get_page_id(port=9222):
    resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/json")
    for t in json.loads(resp.read()):
        if "sugh" in t.get("url", "") and t["type"] == "page":
            return t["id"]
    return None


def get_html(page_id, page=1):
    """通过CDP获取页面HTML（利用Chrome真实TLS绕过瑞数）"""
    ws = websocket.create_connection(
        f"ws://127.0.0.1:9222/devtools/page/{page_id}", timeout=30
    )
    mid = [0]

    def send(m, p=None):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": m, "params": p or {}}))

    def recv():
        while True:
            d = json.loads(ws.recv())
            if "result" in d:
                return d["result"]

    try:
        send("Runtime.enable")
        recv()
        send("Page.enable")
        recv()

        if page == 1:
            url = "https://sugh.szu.edu.cn/Html/News/Columns/540/Index.html"
        else:
            url = f"https://sugh.szu.edu.cn/Html/News/Columns/540/Index.html?page={page}"

        # Navigate and wait
        send("Page.navigate", {"url": url})
        # Consume the Page.navigate result
        nav_result = recv()
        time.sleep(3)

        # Get HTML
        send("Runtime.evaluate", {
            "expression": "document.documentElement.outerHTML",
            "returnByValue": True,
        })
        eval_result = recv()
        html = eval_result["result"]["value"]
        return html
    finally:
        ws.close()


def parse_news(html):
    """从HTML中解析新闻列表：提取URL、标题、日期"""
    news = []
    # Match LI elements that contain both date and Article link
    li_pattern = re.compile(r"<li[^>]*>(.*?)</li>", re.DOTALL)
    date_pattern = re.compile(r"(\d{4}-\d{2}-\d{2})")
    link_pattern = re.compile(r'href="(/Html/News/Articles/\d+\.html)"')

    for li in li_pattern.finditer(html):
        content = li.group(1)
        date_m = date_pattern.search(content)
        link_m = link_pattern.search(content)
        if date_m and link_m:
            # Extract title
            title_m = re.search(r'title="([^"]+)"', content)
            if not title_m:
                title_m = re.search(r">([^<]{15,100})<", content)
            title = (title_m.group(1) if title_m else "").strip()
            news.append({
                "url": "https://sugh.szu.edu.cn" + link_m.group(1),
                "date": date_m.group(1),
                "title": title,
            })

    return news


def main():
    log("=" * 50)
    log("深圳大学总医院 - 新闻列表爬取")
    log("=" * 50)

    page_id = get_page_id()
    if not page_id:
        log("ERROR: Chrome未打开sugh页面!")
        log("请先在Chrome打开: https://sugh.szu.edu.cn/Html/News/Columns/540/Index.html")
        return

    all_news = []
    max_page = 20

    for page in range(1, max_page + 1):
        log(f"获取第 {page} 页")
        html = get_html(page_id, page)
        log(f"  HTML: {len(html)} bytes")

        news = parse_news(html)
        if not news:
            log(f"  无新闻，停止翻页")
            break

        all_news.extend(news)
        log(f"  +{len(news)} 条 (累计 {len(all_news)})")

        # Stop if less than a full page
        if len(news) < 15:
            log("  已到最后一页")
            break

        time.sleep(1)

    # Save
    output = os.path.join(os.path.dirname(__file__), "news.json")
    with open(output, "w", encoding="utf-8") as f:
        json.dump(all_news, f, ensure_ascii=False, indent=2)

    log(f"\n=== 完成: {len(all_news)} 条新闻 ===")
    log(f"保存至: {output}")
    for i, n in enumerate(all_news[:20], 1):
        log(f"  {i:2d}. [{n['date']}] {n['title'][:55]}")

    if len(all_news) > 20:
        log(f"  ... 共 {len(all_news)} 条")


if __name__ == "__main__":
    main()
