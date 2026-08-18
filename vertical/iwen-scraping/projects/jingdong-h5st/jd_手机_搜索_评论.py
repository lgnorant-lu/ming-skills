"""
京东手机搜索 + 评论爬取
用法: chrome --remote-debugging-port=9222 (先打开京东并搜索)
      python jd_手机_搜索_评论.py
"""

from DrissionPage import Chromium
import json, time, os

SEARCH_KW = "手机"
MAX_PAGES = 2
REVIEWS_PER = 10


def extract_products(tab):
    """从当前页面提取商品"""
    return tab.run_js("""
        return JSON.stringify(
            Array.from(document.querySelectorAll('[data-sku]')).map(el => {
                var nameEl = el.querySelector('._newStyle_1k2fi_39') || el.querySelector('span[title]');
                var name = nameEl ? (nameEl.getAttribute('title') || nameEl.textContent).trim() : '';
                var priceMatch = el.textContent.match(/¥\\s*([\\d.]+)/);
                var shopMatch = el.textContent.match(/(\\S+京东自营旗舰店|\\S+官方旗舰店|\\S+专卖店)/);
                return {
                    sku: el.getAttribute('data-sku'),
                    name: name,
                    price: priceMatch ? priceMatch[1] : '',
                    shop: shopMatch ? shopMatch[1] : '自营'
                };
            }).filter(p => p.name && p.price)
        );
    """)


def get_reviews(tab, sku_id):
    """打开商品详情页，从页面HTML抓评论"""
    url = f"https://item.jd.com/{sku_id}.html"
    tab.get(url)
    tab.wait(2)

    # 从商品页提取评论
    comments = tab.run_js(f"""
        var result = [];
        // JD评论通常在 .comment-item 或 .J-comments-list 中
        var items = document.querySelectorAll('.comment-item, [class*=commentItem], .mc');
        items.forEach(function(el) {{
            var content = el.querySelector('.comment-con, [class*=content], p')?.textContent?.trim();
            if (content && content.length > 5) result.push(content.substring(0, 200));
        }});
        // 也尝试从页面数据中提取
        if (result.length === 0) {{
            var scripts = document.querySelectorAll('script');
            scripts.forEach(function(s) {{
                var m = s.textContent.match(/\"content\"\\s*:\\s*\"([^\"]{10,200})\"/g);
                if (m) m.forEach(function(c) {{
                    var t = c.match(/\"content\"\\s*:\\s*\"([^\"]+)\"/);
                    if (t) result.push(t[1].substring(0, 200));
                }});
            }});
        }}
        return JSON.stringify(result.slice(0, {REVIEWS_PER}));
    """)
    return json.loads(comments) if comments else []


def main():
    print(f"搜索: {SEARCH_KW}")
    browser = Chromium(9222)
    tab = browser.latest_tab

    # Step 1: 搜索商品
    print("[1] 搜索商品...")
    products = []
    for p in range(1, MAX_PAGES + 1):
        url = f"https://search.jd.com/Search?keyword={SEARCH_KW}&enc=utf-8"
        if p > 1:
            url += f"&page={p*2-1}"
        tab.get(url)
        tab.wait(3)
        items = json.loads(extract_products(tab))
        products.extend(items)
        print(f"  第{p}页: +{len(items)}个 (累计{len(products)})")
        time.sleep(2)

    if not products:
        print("  没找到商品! 请确认Chrome已打开京东搜索页面")
        return

    # Step 2: 爬评论
    print(f"\n[2] 爬评论 (每个{REVIEWS_PER}条)...")
    results = []
    for i, p in enumerate(products[:20]):
        sku = p.get("sku", "")
        name = p.get("name", "")
        price = p.get("price", "")
        shop = p.get("shop", "")
        print(f"  [{i+1}/{min(20,len(products))}] {name[:40]}...")

        comments = get_reviews(tab, sku) if sku else []
        review_texts = [c.get("content", "") for c in comments[:REVIEWS_PER]]
        print(f"      评论: {len(review_texts)}条")

        results.append([name, price, shop, sku, len(review_texts), "\n".join(review_texts)])
        time.sleep(0.5)

    # Step 3: 保存xlsx
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = SEARCH_KW
    ws.append(["商品名称", "价格", "店铺", "SKU", "评论数", "评论内容"])
    for r in results:
        ws.append(r)
    out = os.path.join(os.path.dirname(__file__), f"jd_{SEARCH_KW}_结果.xlsx")
    wb.save(out)
    print(f"\n[=] 保存: {out}")
    print(f"    共{len(results)}个商品")


if __name__ == "__main__":
    main()
