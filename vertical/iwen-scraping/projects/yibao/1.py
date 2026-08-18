# https://fuwu.nhsa.gov.cn/nationalHallSt/#/search/medical


# 参数：x-tif-nonce  x-tif-signature   x-tif-timestamp   x-tingyun
#         requests  signData      responst  encData


import requests,execjs


def get_ming_data(mi_response):
    f = open('get_can.js', 'r', encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    ming_data = js.call('get_ming', mi_response)
    return ming_data


def get_headers(params):
    f = open('get_can.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    dic = js.call('f',params)
    return dic


def spider(page):

    url = 'https://fuwu.nhsa.gov.cn/ebus/fuwu/api/nthl/api/CommQuery/queryFixedHospital'
    params = {
        "addr": "",
        "regnCode": "141000",
        "medinsName": "",
        "medinsLvCode": "",
        "medinsTypeCode": "",
        "outMedOpenFlag": "",
        "pageNum": page,
        "pageSize": 10,
        "queryDataSource": "es"
    }
    dic = get_headers(params)
    # print(dic['data'])
    # print(type(dic['data']))
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
        'channel': 'web',
        'contentType': 'application/json',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'x-tif-nonce': dic['headers']['x-tif-nonce'],
        'x-tif-paasid': 'undefined,',
        'x-tif-signature': dic['headers']['x-tif-signature'],
        'x-tif-timestamp': str(dic['headers']['x-tif-timestamp']),
        'X-Tingyun': dic['headers']['X-Tingyun'],
    }
    form_data = dic['data']
    response = requests.post(url,headers=headers,data=form_data).json()
    mi_response = response['data']['data']['encData']
    print(mi_response)
    ming_data = get_ming_data(mi_response)
    print(ming_data)


def main():
    for page in range(1,11):
        spider(page)


if __name__ == '__main__':
    main()