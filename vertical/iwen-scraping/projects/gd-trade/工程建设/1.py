# http://ygp.gdzwfw.gov.cn/#/44/jygg


# 参数： nonce、signature、timestamp

import requests,time
from urllib.parse import urlencode
import execjs


def get_sign(data,nonce,ti):
    js_code = open('get_sign.js','r',encoding='utf-8').read()
    sign = execjs.compile(js_code).call('get_sign',data,nonce,ti)
    return sign



def spider(page):

    url = 'http://ygp.gdzwfw.gov.cn/ggzy-portal/search/v2/items'

    json_data = {
        'type': 'trading-type',
        'openConvert': "false",
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
    nonce = "MsHd97e3q6JrXTFz"
    ti = int(time.time()*1000)

    sign = get_sign(data,nonce,ti)
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
        'X-Dgi-Req-Nonce': '{}'.format(nonce),
        'X-Dgi-Req-Signature': '{}'.format(sign),
        'X-Dgi-Req-Timestamp': '{}'.format(ti),
        # 'Cookie': '_horizon_uid=a8d64dc4-e597-4d7d-b601-7597399554f2; _horizon_sid=158c8cad-6b22-46b8-922f-90ac077bbac8',
    }

    response = requests.post(url,headers=headers,json=json_data,verify=False,).text

    print(response)


def main():
    for page in range(1,11):
        spider(page)


if __name__ == '__main__':
    main()