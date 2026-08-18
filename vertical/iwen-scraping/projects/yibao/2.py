#  https://fuwu.nhsa.gov.cn/nationalHallSt/#/search/medical



import requests,execjs


def get_ming(mi_resp):
    f = open('get_can2.js', 'r', encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    ming_resp = js.call('get_ming', mi_resp)
    return ming_resp


def get_can2(parmas):
    f = open('get_can2.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    dic2 = js.call('f2',parmas)
    return dic2


def spider(page):
    parmas = {
            "addr": "",
            "regnCode": "140400",
            "medinsName": "",
            "medinsLvCode": "",
            "medinsTypeCode": "",
            "outMedOpenFlag": "",
            "pageNum": page,
            "pageSize": 10,
            "queryDataSource": "es"
    }

    dic2 = get_can2(parmas)
    # print(dic2['data'])
    headers = {
        'Accept': 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'Origin': 'https://fuwu.nhsa.gov.cn',
        'Pragma': 'no-cache',
        'Referer': 'https://fuwu.nhsa.gov.cn/nationalHallSt/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'X-Tingyun': dic2['headers']['X-Tingyun'],
        'channel': 'web',
        'contentType': 'application/json',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'x-tif-nonce': dic2['headers']['x-tif-nonce'],
        'x-tif-paasid': 'undefined',
        'x-tif-signature': dic2['headers']['x-tif-signature'],
        'x-tif-timestamp': str(dic2['headers']['x-tif-timestamp']),
    }
    from_data = dic2['data']

    response = requests.post('https://fuwu.nhsa.gov.cn/ebus/fuwu/api/nthl/api/CommQuery/queryFixedHospital',headers=headers,data=from_data).json()
    mi_resp = response['data']['data']['encData']
    return mi_resp


def main():
    for page in range(1,11):
        mi_resp = spider(page)
        print(mi_resp)
        ming_resp = get_ming(mi_resp)
        print(ming_resp)


if __name__ == '__main__':
    main()