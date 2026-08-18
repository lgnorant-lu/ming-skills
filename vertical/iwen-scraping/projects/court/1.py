# https://wenshu.court.gov.cn/website/wenshu/181217BMTKHNT2W0/index.html?pageId=e96a5bff203af79d695d9fdce4aca817&s21=%E6%B5%B7%E6%B4%8B


# cookie会变


import requests,execjs


def get_ming(response):
    secretKey = response['secretKey']
    mi = response['result']

    f = open('gei_can_mi.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    ming = js.call('get_ming',secretKey,mi)
    return ming


def spider(page):

    url = 'https://wenshu.court.gov.cn/website/parse/rest.q4w'
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
        'Referer': 'https://wenshu.court.gov.cn/website/wenshu/181217BMTKHNT2W0/index.html?pageId=e96a5bff203af79d695d9fdce4aca817&s21=%E6%B5%B7%E6%B4%8B',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
    }

    data = {
        'pageId': 'e96a5bff203af79d695d9fdce4aca817',
        's21': '海洋',
        'sortFields': 's50:desc',
        'ciphertext': '1001100 1001100 1100100 1110011 1010101 1010110 1100001 1110101 1110001 110001 1100101 1110011 1100110 1001101 1100110 110010 1101011 1001100 110110 1110111 111000 1101110 1000101 1101110 110010 110000 110010 110101 110001 110001 110000 111001 1000010 1000100 1101000 1001111 1101011 1101010 1111000 110111 1100100 1100101 1001111 1000001 101011 1000010 1010010 1010010 1001000 1101011 1000011 1001000 1101001 1110111 111101 111101',
        'pageNum': '{}'.format(page),
        'pageSize': '15',
        'queryCondition': '[{"key":"s21","value":"海洋"}]',
        'cfg': 'com.lawyee.judge.dc.parse.dto.SearchDataDsoDTO@queryDoc',
        '__RequestVerificationToken': 'SypGttEHwWWNaQhKyix49Xpr',
        'wh': '631',
        'ww': '1280',
        'cs': '0',
    }

    response = requests.post(url, cookies=cookies, headers=headers,data=data).json()
    print(response)
    return response


def jiexi(ming):
    # print(ming)
    # print(type(ming))
    ming_list = ming['queryResult']['resultList']
    for a_ming in ming_list:
        print(a_ming)


def main():
    for page in range(1,10):
        response = spider(page)
        ming = get_ming(response)
        jiexi(ming)


if __name__ == '__main__':
    main()