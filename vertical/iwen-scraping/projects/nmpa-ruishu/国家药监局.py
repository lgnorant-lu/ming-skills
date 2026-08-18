"""
国家药监局(NMPA) - 药品数据搜索
URL: https://www.nmpa.gov.cn/
方案: DrissionPage + pajax(浏览器处理RS+TLS+签名)

用法:
  chrome --remote-debugging-port=9222
  python 国家药监局.py
"""

from DrissionPage import Chromium
import json, time, os


def search(keyword="阿莫西林", max_pages=5):
    browser = Chromium(9222)
    tab = browser.latest_tab

    tab.get("https://www.nmpa.gov.cn/datasearch/search-result.html")
    tab.wait(3)
    print(f"[1] {tab.title}")

    all_items = []

    for page in range(1, max_pages + 1):
        print(f"[2] 第{page}页...")

        # pajax返回Promise → 用callback存到window._r
        tab.run_js(f"""
            window._r = null;
            var ti = Date.now();
            var p = pajax.hasTokenGet(
                'https://www.nmpa.gov.cn/datasearch/data/nmpadata/search',
                {{itemId:'ff80808183cad75001840881f848179f',isSenior:'N',
                 searchValue:'{keyword}',pageNum:{page},pageSize:10,timestamp:ti}}
            );
            p.then(function(d) {{ window._r = d; }});
        """)

        # 轮询等待结果
        for _ in range(30):
            time.sleep(0.3)
            r = tab.run_js("return window._r")
            if r is not None:
                break

        if not r:
            print("    无响应")
            break

        inner = r.get("data", {}).get("data", {})
        items = inner.get("list", [])
        if not items:
            print("    无数据")
            break

        all_items.extend(items)
        total = inner.get("total", 0)
        print(f"    +{len(items)}条 (累计{len(all_items)}/共{total})")

    # 解析和保存
    parsed = []
    for item in all_items:
        parsed.append({
            "批准文号": item.get("f0", ""),
            "产品名称": item.get("f1", ""),
            "生产企业": item.get("f2", ""),
            "编码": item.get("f3", ""),
        })

    output = os.path.join(os.path.dirname(__file__), "药品数据.json")
    with open(output, "w", encoding="utf-8") as f:
        json.dump(parsed, f, ensure_ascii=False, indent=2)

    print(f"\n[=] {len(parsed)}条 → {output}")
    for p in parsed[:10]:
        print(f"    {p['批准文号']} | {p['产品名称'][:35]}")
    return parsed


if __name__ == "__main__":
    search("阿莫西林", max_pages=5)
