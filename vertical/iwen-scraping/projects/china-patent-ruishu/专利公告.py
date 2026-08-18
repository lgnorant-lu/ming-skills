"""
中国专利公布公告 - 瑞数反爬绕过
URL: http://epub.cnipa.gov.cn/
方案: iv8 (Python原生V8+浏览器环境) 补环境生成Cookie
核心: S cookie(服务端返回) + T cookie(iv8生成) = 200

依赖: pip install iv8
"""

import iv8, requests, json, re
from lxml import etree


def get_patent_data(search_keyword="", page=1, page_size=10):
    """获取专利数据"""
    s = requests.session()
    h = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

    # Step 1: 首次请求 → 202 + S cookie + 瑞数挑战
    print("[1] Getting RS challenge...")
    r = s.get("http://epub.cnipa.gov.cn/", headers=h, verify=False)
    r.encoding = "utf-8"
    s_cookie = s.cookies.get_dict()

    # 解析瑞数三件套
    tree = etree.HTML(r.text)
    auto_url = "http://epub.cnipa.gov.cn" + tree.xpath("//script[2]/@src")[0]
    auto_js = s.get(auto_url, headers=h).text
    page_html = r.text

    # Step 2: iv8 补环境 → 生成 T cookie
    print("[2] Generating T cookie via iv8...")
    with iv8.JSContext() as ctx:
        ctx.eval(f"""
            window.__iv8__.page.load({{
                baseURL: 'http://epub.cnipa.gov.cn/',
                html: {json.dumps(page_html)},
                resources: {{'{auto_url}': {json.dumps(auto_js)}}}
            }});
        """)
        t_cookie_str = ctx.eval("document.cookie", to_py=True)

    # 解析 T cookie
    t_dict = {}
    for c in t_cookie_str.split(";"):
        c = c.strip()
        if "=" in c:
            k, v = c.split("=", 1)
            t_dict[k.strip()] = v.strip()

    print(f"    S: {list(s_cookie.keys())}  T: {list(t_dict.keys())}")

    # Step 3: 合并 cookie 发起第二次请求
    print("[3] Requesting data with valid cookies...")
    s2 = requests.session()
    all_cookies = {**s_cookie, **t_dict}
    for k, v in all_cookies.items():
        s2.cookies.set(k, v)

    r2 = s2.get("http://epub.cnipa.gov.cn/", headers=h, verify=False)

    if r2.status_code != 200:
        print(f"    FAILED: {r2.status_code}")
        return None

    print(f"    SUCCESS: 200 OK")

    # Step 4: 搜索/获取专利数据(根据实际API调整)
    print(f"[4] Getting patent data (keyword={search_keyword}, page={page})...")
    # 根据实际专利网站API补充数据获取逻辑
    # r3 = s2.post("http://epub.cnipa.gov.cn/api/search", ...)

    return r2.text


def main():
    result = get_patent_data()
    if result:
        title = re.search(r"<title>(.*?)</title>", result)
        print(f"\nTitle: {title.group(1) if title else 'N/A'}")
        print("Done!")


if __name__ == "__main__":
    main()
