import time

import execjs
import requests
from urllib.parse import urlencode


def get_sign(ti,u,data):
    f = open('2.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    sign = js.call('get_sign',ti,u,data)
    return sign


def spider(page,json_data,sign,ti):
    url = 'http://ygp.gdzwfw.gov.cn/ggzy-portal/search/v2/items'

    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'Origin': 'http://ygp.gdzwfw.gov.cn',
        'Pragma': 'no-cache',
        'Referer': 'http://ygp.gdzwfw.gov.cn/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'X-Dgi-Req-App': 'ggzy-portal',
        'X-Dgi-Req-Nonce': 'xq0nqnhEd2HmRgA3',
        'X-Dgi-Req-Signature': sign,
        'X-Dgi-Req-Timestamp': str(ti),
        # 'Cookie': '_horizon_uid=a8d64dc4-e597-4d7d-b601-7597399554f2; _horizon_sid=c4a9ce33-da58-43c4-a931-3f1247b95238',
    }

    response = requests.post(
        url = url,
        headers=headers,
        json=json_data,
        verify=False,
    ).text
    print(f'正在爬取第{page}页数据')
    print(response)


def main():

    for page in range(1,16):
        ti = int(time.time() * 1000)
        u = "6zRgcbWXFjLwotUO"
        json_data = {
            'type': 'trading-type',
            'openConvert': 'false',
            'keyword': '',
            'siteCode': '44',
            'secondType': 'A',
            'tradingProcess': '',
            'thirdType': '[]',
            'projectType': '',
            'publishStartTime': '',
            'publishEndTime': '',
            'pageNo': page,
            'pageSize': 10,
        }
        data = urlencode(json_data)
        sign = get_sign(ti,u,data)
        # print(ti,u,data,sign)

        spider(page,json_data,sign,ti)

if __name__ == '__main__':
    main()