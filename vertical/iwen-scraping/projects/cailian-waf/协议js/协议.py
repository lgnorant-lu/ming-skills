import time

import requests
import pandas as pd
import json
from lxml import etree

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
    # 'Cookie': 'HWWAFSESTIME=1750951904130; HWWAFSESID=a2a5d945c3f57903aa; Hm_lvt_fa5455bb5e9f0f260c32a1d45603ba3e=1750951904; HMACCOUNT=F4037280F82AFFB1; hasTelegraphNotification=on; hasTelegraphRemind=on; hasTelegraphSound=on; vipNotificationState=on; wafatcltime=2918253; wafatclconfirm=n8OsehF3Hb2k43q3EE4jTr7VXgDVt6yK6ysH92Cj5T+JI+KHn4AKZ8YOkLRNOpo7L77lx6R5UYivvEhVsxL+HxHFVTfja5jDnynJpHmOmS6ttM09y7qzUFrNqzsxjBk3pk5I7NOluNNAp/KQXnA+8PpfIzU3TUqPRCDHegi7djb/GsMBSrVd2gNRJGtWLtnzzxotX4nQ9W6ADNId8Gii2wJLFdRcezF1+SYwvxukvk1Kivm7AVPm69UemHGRnk7RSi6fVx/dznDBjWBNDdK3lF/5T8K3IxXz/XIgJfpRb7OKYttpyReoubFIjWeZr3emBe7JwDW12y7usWnhGvLuKJFD125jcmy6COSlAAZSne69Yo2YySxPgzFvt1fDuj7bFkvt6bmOMCnbRBkhGu1agv47KZgPPyqUucntCCMm2sBr1FG9hFGt+R3cbp8BOAvhVykVneazKNUuQYzcQF1WBxfF+bchDogzoPuXjgv1hAuJdrVa9Srlkwz3ULEphcP0KkJTFH51mJ1NOdK8Vc8Yoif019RNJoRKRZrtJKfEmJ4+XFgkM8YSknsrj1VU0bKHfPELcxjs0/zv3KkfCN0sChHK8N74qsNGBL8SO7MoMG/nRyljTuWSxMhztQ7dDBnCPd/u/aggPqoeKJXnfl87pF3QwC3tPD9nIH+7cdj1/lJH6o000v07TXLK7vu33Xc8t3ISR7CZHqgPBTv1vV3Vb1ckr867+uRsOiiWTnjN4NfRTK5KkAJ6fqcld9LNheV/OjOqIUB2cVNLr6Qth5FhRCP49CZsam0IUrD+nkrz9OY%3D; wafatcltoken=15ecf94d5bc999d008d1879f9fb24323; Hm_lpvt_fa5455bb5e9f0f260c32a1d45603ba3e=1750952086; tfstk=g-O-wHfl2mmoF9dRoUk0xVEEZHummxYyZ38_tMjudnKv5Frld0-hAKKBmgNozYWCv3JIz30y9KPp7eRoz60PaU5FOcmisHLyz6yIyeJqmEgC86Q7rVYwkU5FOmYUnmDJz3JvxRK5OqCfJwQCOMwSkZ_Gc7_QNwZjkiSfR867FjTfJwbQOH1IkEsVR6_WATgvljIoyiz5yWpgv8HecrS4OWOAyTMDPiNCuIQReGTWGWNQ8aBRfUsxVPIuetTFpBzU9OTWQH76VuidYILXNdtsm8jWBwLMpUG7G_AyPd6B1DyBX_KdCQ6YR5TyPgfAlCg3QiAAqHORhVVOKsOGC_9m30XhwNKBa3ULOhTDSQW29cEfYLbNGwdE5JIddgPwsCKXjljO-8gxkJyFFZljC5i0rjCPVZIiPTwUL9bVkG0xkJyFFZ7Aj4N7LJWhu',
}
# headers =
all_data = []


for i in range(130):
    params = {
        'app': 'CailianpressWeb',
        'os': 'web',
        'sv': '8.4.6',
        'sign': '9f8797a1f4de66c2370f7a03990d2737',
    }

    json_data = {
        'type': 'depth',
        'keyword': '二十大',
        'page': i,
        'rn': 20,
        'os': 'web',
        'sv': '8.4.6',
        'app': 'CailianpressWeb',
    }

    r = requests.post('https://www.cls.cn/api/sw', params=params, cookies=cookies, headers=headers, json=json_data)

    # print(r.text)
    resp = json.loads(r.text)

    for item in resp['data']['depth']['data']:
        try:
            title = item['title'].replace('<em>','').replace('</em>','')
            id = item['id']
            dizhi = 'https://www.cls.cn/detail/'+str(id)
            # print(title,dizhi)

            r1 = requests.get(url=dizhi,headers=headers)
            # print(r1.text)
            resp = etree.HTML(r1.text)
            txt = ''.join(resp.xpath('//div[@class="m-b-10"]//text()')).replace(' ','').replace('\n','').replace('\r','')
            shijian = ''.join(resp.xpath('//div[@class="f-l m-r-10"]/text()')).replace(' ','').replace('\n','').replace('\r','')
            # print(title,txt,shijian,dizhi)

            all_data.append({
                '标题': title,
                '内容': txt,
                '时间': shijian,
                '地址': dizhi
            })
            print(title, '已保存完成')
            # time.sleep()
            # break
        except Exception as e:
            print(f"程序运行出错: {str(e)}")
            continue

    # 每一页保存一次
    if all_data:
        df = pd.DataFrame(all_data)
        df.to_excel('财联社.xlsx', index=False)
        print(f"成功保存{len(all_data)}条数据到财联社.xlsx")
    else:
        print("未获取到有效数据")