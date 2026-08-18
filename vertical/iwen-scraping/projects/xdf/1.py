# https://souke.xdf.cn/search?cityCode=430300&categoryCode=123

# 参数：sign  md5  webpack逻辑

import requests,execjs,time
from urllib.parse import urlencode


def get_sign(c):
    f = open('get_sign.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    sign = js.call('get_sign',c)
    return sign


def spider(page):
    t = int(time.time()*1000)
    # print(t)
    params = {
        'appId': '5053',
        't': '{}'.format(t),
        'cityCode': '430300',
        'pageIndex': '{}'.format(page),
        'pageSize': '12',
        'categoryCode': '123',
        'order': '0',
    }
    c = urlencode(params)
    # print(c)

    headers = {
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'content-type': 'application/json',
        'origin': 'https://souke.xdf.cn',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://souke.xdf.cn/search?cityCode=430300&categoryCode=123',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'sign': get_sign(c),
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    }
    # print(headers)

    response = requests.get('https://dsapi.xdf.cn/product/v2/class/search', params=params, headers=headers).text
    print(response)


def main():
    for page in range(1,11):
        spider(page)
        time.sleep(1)


if __name__ == '__main__':
    main()