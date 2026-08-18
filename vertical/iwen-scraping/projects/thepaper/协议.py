import requests
import json
import pandas as pd
from lxml import etree

url = 'https://api.thepaper.cn/search/web/news'

all_data = []

for i in range(1,100):
    resq_data = {
        "word": "无人机事故",
        "orderType": 3,
        "pageNum": i,
        "pageSize": 50,
        "searchType": 1
    }

    headers = {
        "accept": "application/json",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "zh-CN,zh;q=0.9",
        "cache-control": "no-cache",
        "client-type": "1",
        "content-length": "85",
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

    r = requests.post(url, headers=headers, json=resq_data)
    # print(r.text)
    data = json.loads(r.text)

    if r.status_code != 200:
        print(f"请求失败，状态码: {r.status_code}，停止爬取")
        continue

    try:
        data = json.loads(r.text)
    except json.JSONDecodeError:
        print("JSON解析失败，停止爬取")
        continue

    if not data.get('data', {}).get('list'):
        print(f"第 {i} 页没有数据，爬取结束")
        break

    for item in data['data']['list']:
        try:
            title = item['name']
            shijian = item['pubTime']
            id = item['contId']
            dizhi = 'https://www.thepaper.cn/newsDetail_forward_' + id
            # print(title,shijian,dizhi)

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
            txt_resp = requests.get(url=dizhi, headers=headers1)
            # print(txt_resp.text)
            resp1 = etree.HTML(txt_resp.text)
            txt = ''.join(resp1.xpath('//div[@class = "index_cententWrap__Jv8jK"]//text()')).replace(' ', '').replace('\n','').replace('\r', '')
            # print(txt)

            all_data.append({
                '标题': title,
                '内容': txt,
                '时间': shijian,
                '地址': dizhi
            })
            print(title,'已保存完成')
        except Exception as e:
            print(f"程序运行出错: {str(e)}")
            continue
    # 每一页保存一次
    if all_data:
        df = pd.DataFrame(all_data)
        df.to_excel('无人机事故.xlsx', index=False)
        print(f"成功保存{len(all_data)}条数据到澎湃新闻.xlsx")
    else:
        print("未获取到有效数据")


