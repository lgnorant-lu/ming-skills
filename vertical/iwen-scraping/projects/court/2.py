# https://wenshu.court.gov.cn/website/wenshu/181217BMTKHNT2W0/index.html?pageId=e96a5bff203af79d695d9fdce4aca817&s21=%E6%B5%B7%E6%B4%8B


# cookie会变


import requests,execjs,json


cookies = {
    'SESSION': 'f4d4e02e-acf9-4393-9aa4-5221ffa99b8f',
}

headers = {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Origin': 'https://wenshu.court.gov.cn',
    'Pragma': 'no-cache',
    'Referer': 'https://wenshu.court.gov.cn/website/wenshu/181217BMTKHNT2W0/index.html?pageId=bd8260b1dc58b0ce639e28293acd7c71&s21=%E5%BC%BA%E5%A5%B8',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    # 'Cookie': 'SESSION=f4d4e02e-acf9-4393-9aa4-5221ffa99b8f',
}


def get_ming(response):
    secretKey = response['secretKey']
    mi = response['result']

    f = open('get_can_mi2.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    ming = js.call('get_ming',secretKey,mi)
    # print(ming)
    return ming


def spider(page):
    import requests

    data = {
        'pageId': 'bd8260b1dc58b0ce639e28293acd7c71',
        's21': '强奸',
        'sortFields': 's50:desc',
        'ciphertext': '110010 1100101 1001111 1101111 1000011 1001000 1011010 1101100 1110000 1010100 1000010 1110011 1000110 1110011 110100 1010011 1001000 110110 1011000 110001 1000010 1101001 1110010 1100111 110010 110000 110010 110110 110000 110010 110000 110111 1101101 110101 1110111 1111010 1010111 1001111 1001010 1011000 1101100 1001110 1011010 1010011 101011 1110000 1001100 1110011 1101000 101111 1101111 1000100 1001111 1100111 111101 111101',
        'pageNum': '{}'.format(page),
        'pageSize': '15',
        'queryCondition': '[{"key":"s21","value":"强奸"}]',
        'cfg': 'com.lawyee.judge.dc.parse.dto.SearchDataDsoDTO@queryDoc',
        '__RequestVerificationToken': 'w45CskZ85aWYS8YI2tPYEdbd',
        'wh': '1271',
        'ww': '2560',
        'cs': '0',
    }

    response = requests.post('https://wenshu.court.gov.cn/website/parse/rest.q4w', cookies=cookies, headers=headers,data=data)
    print(response.text)
    return response


def xiang_data(rowkey):
    import requests

    data = {
        'docId': '{}'.format(rowkey),
        'ciphertext': '110100 1000111 1110101 1010001 111001 1101010 1001111 110101 1000001 110100 110101 1000010 1101001 1000010 1101111 1000100 1001011 1101110 110100 1100001 110100 110100 1101001 1010011 110010 110000 110010 110110 110000 110010 110000 111000 1000101 1000110 110100 1000011 1010110 110011 1010111 1000101 1110000 1011010 1000101 1110011 1110101 1100110 1110010 1001000 1010010 111000 1011010 1000110 1000011 1110111 111101 111101',
        'cfg': 'com.lawyee.judge.dc.parse.dto.SearchDataDsoDTO@docInfoSearch',
        '__RequestVerificationToken': 'Ti2tAaup462cm3f7S0hMXqlG',
        'wh': '1271',
        'ww': '1019',
        'cs': '0',
    }

    resp2 = requests.post('https://wenshu.court.gov.cn/website/parse/rest.q4w', cookies=cookies, headers=headers,data=data)
    a_xiang_data = get_ming(resp2.json())
    print(a_xiang_data)


def jiexi(ming):
    # print(ming)
    # print(type(ming))
    ming_list = ming['queryResult']['resultList']
    for a_ming in ming_list:
        # print(a_ming)
        rowkey = a_ming['rowkey']
        xiang_data(rowkey)


def main():
    for page in range(1,2):
        resp = spider(page)
        ming = get_ming(resp.json())
        jiexi(json.loads(ming))


if __name__ == '__main__':
    main()