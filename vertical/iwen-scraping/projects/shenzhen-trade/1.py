import time

import requests
import json
import pandas as pd

all_data = []
for j in range(500):

    cookies = {
        'Hm_lvt_42d6d6c9d2c97bcda19906bdfe55f5c0': '1750072686',
        'HMACCOUNT': 'F4037280F82AFFB1',
        'JSESSIONID': '',
        'Hm_lpvt_42d6d6c9d2c97bcda19906bdfe55f5c0': '1750073154',
    }

    headers = {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'Origin': 'https://new.szggzy.com',
        'Pragma': 'no-cache',
        'Referer': 'https://new.szggzy.com/jygg/list.html?id=jsgc',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        # 'Cookie': 'Hm_lvt_42d6d6c9d2c97bcda19906bdfe55f5c0=1750072686; HMACCOUNT=F4037280F82AFFB1; JSESSIONID=; Hm_lpvt_42d6d6c9d2c97bcda19906bdfe55f5c0=1750073154',
    }

    json_data = {
        'modelId': 1378,
        'channelId': 2851,
        'fields': [
            {
                'fieldName': 'jygg_gglxmc_rank1',
                'fieldValue': '定标公示',
            },
            {
                'fieldName': 'jygg_gglxmc',
                'fieldValue': '中标结果公示',
            },
            {
                'fieldName': 'jygg_gclx',
                'fieldValue': '施工',
            },
        ],
        'parentBusinessType': '政府采购',
        'title': None,
        'releaseTimeBegin': '2024-06-16 00:00:00',
        'releaseTimeEnd': '2024-12-01 23:59:59',
        'page': j,
        'size': 50,
        'siteId': 1,
    }

    response = requests.post('https://new.szggzy.com/cms/api/v1/trade/content/page', cookies=cookies, headers=headers, json=json_data)

    resp = response.text

    # print(resp)

    data = json.loads(resp)

    # 提取所有contentId的值
    content_ids = []

    # 检查数据结构是否存在
    if "data" in data and "content" in data["data"]:
        for item in data["data"]["content"]:
            # 检查contentId字段是否存在
            if "contentId" in item:
                content_ids.append(item["contentId"])

    # 打印结果
    print("提取到的contentId值:")
    # for cid in content_ids:
    #     print(cid)

    # 统计总数
    print(f"\n共提取到 {len(content_ids)} 个contentId")

    headers2 = {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "accept-encoding": "gzip, deflate, zstd",
        "accept-language": "zh-CN,zh;q=0.9",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "content-type": "application/json",
        "cookie": "Hm_lvt_42d6d6c9d2c97bcda19906bdfe55f5c0=1750072686; HMACCOUNT=F4037280F82AFFB1; JSESSIONID=; Hm_lpvt_42d6d6c9d2c97bcda19906bdfe55f5c0=1750076089",
        "host": "new.szggzy.com",
        "pragma": "no-cache",
        "referer": "https://new.szggzy.com/jyfw/ggDetails.html?contentId=19823956&noticeType=%E5%AE%9A%E6%A0%87%E5%85%AC%E7%A4%BA&bidSectionNumber=4403832025007001001&crumb=jsgc",
        "sec-ch-ua": "\"Google Chrome\";v=\"137\", \"Chromium\";v=\"137\", \"Not/A)Brand\";v=\"24\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
    }

    for i in range(0,50):
        t = content_ids[i]
        # print(t)
        url2 = f'https://new.szggzy.com/cms/api/v1/rhgw/project/detail?contentId={t}'
        # url2 = f'https://new.szggzy.com/cms/api/v1/rhgw/project/detail?contentId=19823956'
        response2 = requests.get(url2,headers=headers2)
        resp2 = (response2.text)
        # print(resp2)
        data2 = json.loads(resp2)
        try:
            bid_info = data2["data"]["bidList"][0]
            bidName = bid_info.get("bidName")
            bidMan = bid_info.get("bidMan")
            bidPrice = bid_info.get("bidPrice")
            # print(bidName,bidMan,bidPrice)
            all_data.append({
                "标题":bidName,
                "中标人":bidMan,
                "金额":bidPrice
            })
            print(bidName)
            if all_data:
                df = pd.DataFrame(all_data)
                df.to_excel('深圳公共资源数据.xlsx', index=False)
                print(f"成功保存{len(all_data)}条深圳公共资源数据到数据.xlsx")
            else:
                print("未获取到有效数据")
            # time.sleep(0.5)
        except:
            continue

    print(f"第{j}页已经爬取完成")