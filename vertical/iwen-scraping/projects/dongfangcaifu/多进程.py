import requests
import json
from lxml import etree
import pandas as pd
import threading
from concurrent.futures import ThreadPoolExecutor

# 全局锁用于保护共享资源
lock = threading.Lock()
arr_list = []

cookies = {
    'qgqp_b_id': '31df3c505edcb3106565e4fcfbe1e6e3',
    'HAList': 'ty-116-00732-%u4FE1%u5229%u56FD%u9645',
    'fullscreengg': '1',
    'fullscreengg2': '1',
    'st_si': '18150150446627',
    'emshistory': '%5B%22%E7%A1%85%E8%B0%B7%E9%93%B6%E8%A1%8C%22%5D',
    'st_asi': 'delete',
    'st_pvi': '75691752968005',
    'st_sp': '2025-05-22%2000%3A07%3A54',
    'st_inirUrl': 'https%3A%2F%2Fwww.baidu.com%2Flink',
    'st_sn': '28',
    'st_psi': '20250625222141687-117001350220-0356611541',
}

headers = {
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
    'Referer': 'https://so.eastmoney.com/news/s?keyword=2008%E5%B9%B4%E9%87%91%E8%9E%8D%E5%8D%B1%E6%9C%BA',
    'Sec-Fetch-Dest': 'script',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'same-site',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
}

headers1 = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "zh-CN,zh;q=0.9",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "cookie": "qgqp_b_id=31df3c505edcb3106565e4fcfbe1e6e3; HAList=ty-116-00732-%u4FE1%u5229%u56FD%u9645; fullscreengg=1; fullscreengg2=1; st_si=18150150446627; emshistory=%5B%22%E5%85%B3%E7%A8%8E%22%2C%22%E7%A1%85%E8%B0%B7%E9%93%B6%E8%A1%8C%22%5D; st_asi=delete; st_pvi=75691752968005; st_sp=2025-05-22%2000%3A07%3A54; st_inirUrl=https%3A%2F%2Fwww.baidu.com%2Flink; st_sn=33; st_psi=20250625232320315-117001350220-5931587439",
    "host": "finance.eastmoney.com",
    "pragma": "no-cache",
    "referer": "https://so.eastmoney.com/news/s?keyword=2008%E5%B9%B4%E9%87%91%E8%9E%8D%E5%8D%B1%E6%9C%BA",
    "sec-ch-ua": "\"Google Chrome\";v=\"137\", \"Chromium\";v=\"137\", \"Not/A)Brand\";v=\"24\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-site",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
}


def get_article_detail(article):
    """获取文章详情内容"""
    title, shijian, dizhi = article
    try:
        txt_resp = requests.get(url=dizhi, headers=headers1)
        resp1 = etree.HTML(txt_resp.text)
        txt = ''.join(resp1.xpath('//div[@id="ContentBody"]//text()')).replace(' ', '').replace('\r', '').replace('\n',
                                                                                                                  '').strip()

        article_data = {
            '标题': title,
            '内容': txt,
            '时间': shijian,
            '地址': dizhi,
        }

        print(title, '已爬取完成')
        return article_data
    except Exception as e:
        print(f"文章爬取出错: {title}, 错误: {str(e)}")
        return None


def crawl_page(page_index):
    """爬取单个分页数据"""
    print(f"开始爬取第 {page_index} 页")
    param_data = {
        "uid": "",
        "keyword": "二十大",
        "type": ["cmsArticleWebOld"],
        "client": "web",
        "clientType": "web",
        "clientVersion": "curr",
        "param": {
            "cmsArticleWebOld": {
                "searchScope": "default",
                "sort": "default",
                "pageIndex": page_index,
                "pageSize": 50,
                "preTag": "<em>",
                "postTag": "</em>"
            }
        }
    }

    param_json = json.dumps(param_data, separators=(',', ':'))
    params = {
        'cb': 'jQuery3510927895711577094_1750847260149',
        'param': param_json,
        '_': '1750847260159'
    }

    try:
        r = requests.get('https://search-api-web.eastmoney.com/search/jsonp',
                         params=params, cookies=cookies, headers=headers)
        data_str = r.text[r.text.find('(') + 1: -1]
        resp = json.loads(data_str)

        # 准备内层线程池任务
        articles = []
        for item in resp['result']['cmsArticleWebOld']:
            title = item['title']
            shijian = item['date']
            dizhi = item['url']
            articles.append((title, shijian, dizhi))

        # 内层线程池处理文章详情 (10个线程)
        with ThreadPoolExecutor(max_workers=10) as inner_executor:
            results = inner_executor.map(get_article_detail, articles)

            # 处理结果并安全添加到全局列表
            for result in results:
                if result:
                    with lock:
                        arr_list.append(result)

        print(f"第 {page_index} 页爬取完成")
    except Exception as e:
        print(f"分页爬取出错: 第 {page_index} 页, 错误: {str(e)}")


def main():
    # 外层线程池处理分页 (5个线程)
    with ThreadPoolExecutor(max_workers=5) as outer_executor:
        # 创建1-2页的任务
        outer_executor.map(crawl_page, range(1, 30))

    # 所有任务完成后保存数据
    if arr_list:
        df = pd.DataFrame(arr_list)
        df.to_excel('东方财富网.xlsx', index=False)
        print(f"成功保存 {len(arr_list)} 条数据到 东方财富网.xlsx")
    else:
        print("未获取到有效数据")


if __name__ == "__main__":
    main()