import requests
import json
import pandas as pd
from lxml import etree
import concurrent.futures
import threading

# 全局变量和锁
all_data = []
lock = threading.Lock()
headers = {
    "accept": "application/json",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "zh-CN,zh;q=0.9",
    "cache-control": "no-cache",
    "client-type": "1",
    "content-type": "application/json",
    "cookie": "Hm_lvt_94a1e06bbce219d29285cee2e37d1d26=1748435410,1750770852; HMACCOUNT=F4037280F82AFFB1; tfstk=gJwjpr02hEYXKfM9fjjyF6NqgKM_hgWF5hiTxlp2XxHvWFEKzdzNmAk_XyrZ6-rZHVp_7ly47fjmWdUuvPGGmVut5PrTggWFLoqmIAH189WeepIO2-g97AHmeooKrjXFLoqAXn2ur9yNaeZnyVHtMfh-w4msDKUtX4ISXc8v6KUOVgisfnnxkIp-yconBVUtBgZ-rcMtDPHtipTSbsiTciza27xGFcrxPdpTHOcjRH0-q02ScjgKG49Tc8ijG2EY3nkkz0ezFXlybZD8x7zxVv6X-mN8Axn_IMds5fwmF4aCpdmuMrw-18SGiuwslXexNHpZexoTWfNlRpoj37GQhSjMyoUElWH0bH_4VXNSt0hJfIH4Tkyi9-BX-4lnfzGUGw9bJgovL2iFSCtStdiS8gsWsCbfFJeR_r4MajnoD9S5VUOiM0mS8gsWsCcxqmFFVgTWs; Hm_lpvt_94a1e06bbce219d29285cee2e37d1d26=1750771572; ariaDefaultTheme=undefined",
    "origin": "https://www.thepaper.cn",
    "pragma": "no-cache",
    "priority": "u=1, i",
    "referer": "https://www.thepaper.cn/",
    "sec-ch-ua": "\"Google Chrome\";v=\"137\", \"Chromium\";v=\"137\", \"Not/A)Brand\";v=\"24\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
}

headers1 = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "zh-CN,zh;q=0.9",
    "cache-control": "no-cache",
    "cookie": "Hm_lvt_94a1e06bbce219d29285cee2e37d1d26=1748435410,1750770852; HMACCOUNT=F4037280F82AFFB1; menuIds=[25949,143064,128409,26916,25950,122908,25951,119908,136261,36079,119489,25952,25953,26161,-8,143022,143065,-21,-24,122153,143013,150010,-1]; Hm_lpvt_94a1e06bbce219d29285cee2e37d1d26=1750771572; ariaDefaultTheme=undefined; tfstk=gHKKvujh9fch4xKdIpugZZQeKHMGwVvF1BJbq_f3PCd9hKPhP_xu2LOkFeXkFX8J6CdYtkcSLTsJtCGerMbuNgpJGXrCVua6C9WfdQprLT1WNQCk-VmDLpSPVjj-mmvEu6VNSHI7ZdsFEfvfgdoDLpysUcxwbm2-SAFOR_O5RN_1U1ZQA_O5fG6f1k67ATNsB151du_CFNi1E9B5dQsSBd1NFg6BNwM9CbUIp1yCpuL0__dP0An2DnxOpwCXBqr72DXQis9QtuEJXe_dGffTVutOpdbiXcqxrsTVtZfJ1cqd2d6J6ZYKMkdJFK85W3FIKIO6yQ6w7bURMU9HuU_tdD9Ov6QWjCwz-MLWT3QeJ8k2CMOwus7I7fW9xnbRgNFsOdvOOZLJtfr5tEp66ZxgsojXuCKRlisrJnxv1IVcMT4IBAUzzw6ZfqZjs0anAuXOiv_Qzz7lQOCmBAUzzw6NBsDQAzzPrO5..",
    "pragma": "no-cache",
    "priority": "u=0, i",
    "referer": "https://www.thepaper.cn/searchResult?id=2008%E5%B9%B4%E9%87%91%E8%9E%8D%E5%8D%B1%E6%9C%BA",
    "sec-ch-ua": "\"Google Chrome\";v=\"137\", \"Chromium\";v=\"137\", \"Not/A)Brand\";v=\"24\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
}


def get_article_detail(item):
    """获取单篇文章详情"""
    try:
        title = item['name']
        shijian = item['pubTime']
        id = item['contId']
        dizhi = 'https://www.thepaper.cn/newsDetail_forward_' + id

        txt_resp = requests.get(url=dizhi, headers=headers1, timeout=10)
        txt_resp.raise_for_status()

        resp1 = etree.HTML(txt_resp.text)
        txt = ''.join(resp1.xpath('//div[@class = "index_cententWrap__Jv8jK"]//text()')).replace(' ', '').replace('\n',
                                                                                                                  '').replace(
            '\r', '')

        return {
            '标题': title,
            '内容': txt,
            '时间': shijian,
            '地址': dizhi
        }
    except Exception as e:
        print(f"文章处理出错: {str(e)}")
        return None


def process_page_items(items):
    """处理单页的所有项目"""
    page_data = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as inner_executor:
        future_to_item = {inner_executor.submit(get_article_detail, item): item for item in items}
        for future in concurrent.futures.as_completed(future_to_item):
            result = future.result()
            if result:
                page_data.append(result)
                print(result['标题'], '已保存完成')
    return page_data


def crawl_page(page_num):
    """爬取单页数据"""
    try:
        resq_data = {
            "word": "无人机事故",
            "orderType": 3,
            "pageNum": page_num,
            "pageSize": 50,
            "searchType": 1
        }

        r = requests.post('https://api.thepaper.cn/search/web/news', headers=headers, json=resq_data, timeout=15)
        r.raise_for_status()



        data = r.json()
        if not data.get('data', {}).get('list'):
            print(f"第 {page_num} 页没有数据")
            return

        items = data['data']['list']
        page_data = process_page_items(items)

        # 将数据添加到全局列表
        with lock:
            all_data.extend(page_data)
            # 保存到Excel
            df = pd.DataFrame(all_data)
            df.to_excel('无人机事故.xlsx', index=False)
            print(f"第 {page_num} 页完成，已保存{len(all_data)}条数据")

    except requests.exceptions.RequestException as e:
        print(f"第 {page_num} 页请求失败: {str(e)}")
    except json.JSONDecodeError:
        print(f"第 {page_num} 页JSON解析失败")
    except Exception as e:
        print(f"第 {page_num} 页处理出错: {str(e)}")


if __name__ == '__main__':
    # 外层线程池处理分页
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as outer_executor:
        # 提交99页任务
        page_nums = range(1,180)
        futures = [outer_executor.submit(crawl_page, page_num) for page_num in page_nums]

        # 等待所有任务完成
        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except Exception as e:
                print(f"分页任务出错: {str(e)}")

    print("所有任务完成")