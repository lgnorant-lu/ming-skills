import requests
import pandas as pd
import json
from lxml import etree
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

# 全局变量
all_data = []
lock = threading.Lock()  # 全局锁用于保护共享资源


# 获取文章详情函数
def get_article_detail(url, headers):
    try:
        r1 = requests.get(url=url, headers=headers)
        resp = etree.HTML(r1.text)
        txt = ''.join(resp.xpath('//div[@class="m-b-10"]//text()')).replace(' ', '').replace('\n', '').replace('\r', '')
        shijian = ''.join(resp.xpath('//div[@class="f-l m-r-10"]/text()')).replace(' ', '').replace('\n', '').replace(
            '\r', '')
        return {
            '内容': txt,
            '时间': shijian,
            '地址': url
        }
    except Exception as e:
        print(f"获取文章详情出错: {str(e)}")
        return None


# 分页爬取函数
def crawl_page(page, cookies, headers):
    global all_data
    page_data = []  # 存储当前页面的数据

    params = {
        'app': 'CailianpressWeb',
        'os': 'web',
        'sv': '8.4.6',
        'sign': '9f8797a1f4de66c2370f7a03990d2737',
    }

    json_data = {
        'type': 'depth',
        'keyword': '2008年金融危机',
        'page': page,
        'rn': 20,
        'os': 'web',
        'sv': '8.4.6',
        'app': 'CailianpressWeb',
    }

    try:
        r = requests.post('https://www.cls.cn/api/sw', params=params, cookies=cookies, headers=headers, json=json_data)
        resp = json.loads(r.text)

        # 内层线程池处理文章详情 (10个线程)
        with ThreadPoolExecutor(max_workers=10) as inner_executor:
            futures = []
            for item in resp['data']['depth']['data']:
                title = item['title']
                article_id = item['id']
                url = f'https://www.cls.cn/detail/{article_id}'
                futures.append(inner_executor.submit(process_article, title, url, headers))

            # 等待当前页所有文章处理完成
            for future in as_completed(futures):
                result = future.result()
                if result:
                    page_data.append(result)

        # 将当前页数据添加到全局列表
        with lock:
            all_data.extend(page_data)

        # 保存数据到Excel (线程安全)
        with lock:
            if all_data:
                df = pd.DataFrame(all_data)
                df.to_excel('财联社.xlsx', index=False)
                print(f"页码 {page} 处理完成，已保存 {len(all_data)} 条数据")
            else:
                print(f"页码 {page} 处理完成，但未获取到有效数据")

        return len(page_data)

    except Exception as e:
        print(f"处理页码 {page} 时出错: {str(e)}")
        return 0


# 处理单篇文章的函数
def process_article(title, url, headers):
    try:
        detail = get_article_detail(url, headers)
        if detail:
            detail['标题'] = title
            print(f"文章处理完成: {title}")
            return detail
        return None
    except Exception as e:
        print(f"处理文章出错 [{title}]: {str(e)}")
        return None


if __name__ == "__main__":
    cookies = {
        'HWWAFSESTIME': '1750951904130',
        'HWWAFSESID': 'a2a5d945c3f57903aa',
        'Hm_lvt_fa5455bb5e9f0f260c32a1d45603ba3e': '1750951904',
        'HMACCOUNT': 'F4037280F82AFFB1',
        'hasTelegraphNotification': 'on',
        'hasTelegraphRemind': 'on',
        'hasTelegraphSound': 'on',
        'vipNotificationState': 'on',
        'wafatcltime': '2918253',
        'wafatclconfirm': 'n8OsehF3Hb2k43q3EE4jTr7VXgDVt6yK6ysH92Cj5T+JI+KHn4AKZ8YOkLRNOpo7L77lx6R5UYivvEhVsxL+HxHFVTfja5jDnynJpHmOmS6ttM09y7qzUFrNqzsxjBk3pk5I7NOluNNAp/KQXnA+8PpfIzU3TUqPRCDHegi7djb/GsMBSrVd2gNRJGtWLtnzzxotX4nQ9W6ADNId8Gii2wJLFdRcezF1+SYwvxukvk1Kivm7AVPm69UemHGRnk7RSi6fVx/dznDBjWBNDdK3lF/5T8K3IxXz/XIgJfpRb7OKYttpyReoubFIjWeZr3emBe7JwDW12y7usWnhGvLuKJFD125jcmy6COSlAAZSne69Yo2YySxPgzFvt1fDuj7bFkvt6bmOMCnbRBkhGu1agv47KZgPPyqUucntCCMm2sBr1FG9hFGt+R3cbp8BOAvhVykVneazKNUuQYzcQF1WBxfF+bchDogzoPuXjgv1hAuJdrVa9Srlkwz3ULEphcP0KkJTFH51mJ1NOdK8Vc8Yoif019RNJoRKRZrtJKfEmJ4+XFgkM8YSknsrj1VU0bKHfPELcxjs0/zv3KkfCN0sChHK8N74qsNGBL8SO7MoMG/nRyljTuWSxMhztQ7dDBnCPd/u/aggPqoeKJXnfl87pF3QwC3tPD9nIH+7cdj1/lJH6o000v07TXLK7vu33Xc8t3ISR7CZHqgPBTv1vV3Vb1ckr867+uRsOiiWTnjN4NfRTK5KkAJ6fqcld9LNheV/OjOqIUB2cVNLr6Qth5FhRCP49CZsam0IUrD+nkrz9OY%3D',
        'wafatcltoken': '15ecf94d5bc999d008d1879f9fb24323',
        'Hm_lpvt_fa5455bb5e9f0f260c32a1d45603ba3e': '1750952086',
        'tfstk': 'g-O-wHfl2mmoF9dRoUk0xVEEZHummxYyZ38_tMjudnKv5Frld0-hAKKBmgNozYWCv3JIz30y9KPp7eRoz60PaU5FOcmisHLyz6yIyeJqmEgC86Q7rVYwkU5FOmYUnmDJz3JvxRK5OqCfJwQCOMwSkZ_Gc7_QNwZjkiSfR867FjTfJwbQOH1IkEsVR6_WATgvljIoyiz5yWpgv8HecrS4OWOAyTMDPiNCuIQReGTWGWNQ8aBRfUsxVPIuetTFpBzU9OTWQH76VuidYILXNdtsm8jWBwLMpUG7G_AyPd6B1DyBX_KdCQ6YR5TyPgfAlCg3QiAAqHORhVVOKsOGC_9m30XhwNKBa3ULOhTDSQW29cEfYLbNGwdE5JIddgPwsCKXjljO-8gxkJyFFZljC5i0rjCPVZIiPTwUL9bVkG0xkJyFFZ7Aj4N7LJWhu',
    }

    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json;charset=UTF-8',
        'Origin': 'https://www.cls.cn',
        'Pragma': 'no-cache',
        'Referer': 'https://www.cls.cn/searchPage?keyword=2008%E5%B9%B4%E9%87%91%E8%9E%8D%E5%8D%B1%E6%9C%BA&type=depth',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
    }

    # 外层线程池处理分页 (5个线程)
    with ThreadPoolExecutor(max_workers=5) as outer_executor:
        futures = []
        for page in range(10):
            futures.append(outer_executor.submit(crawl_page, page, cookies, headers))

        # 等待所有分页任务完成
        total_articles = 0
        for future in as_completed(futures):
            total_articles += future.result()

        print(f"所有任务完成! 共爬取 {total_articles} 篇文章")

    # 最终保存一次确保数据完整
    if all_data:
        df = pd.DataFrame(all_data)
        df.to_excel('财联社.xlsx', index=False)
        print(f"最终保存完成，共 {len(all_data)} 条数据")