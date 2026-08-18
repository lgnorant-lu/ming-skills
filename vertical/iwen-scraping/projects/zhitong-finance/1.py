# https://www.zhitongcaijing.com/content/recommend.html


# 参数：token    方式：sha1


import requests,execjs,datetime


def get_token(params):
    f = open('get_mi_can.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    return js.call('get_token',params)


def spider(page):

    cookies = {
        'aliyungf_tc': 'e16f52ac8f1180c63045411bf1f012638c0791bfe484e81f5b47dfb8d46caf73',
        'PHPSESSID': '2f69us95u8r2cdhdatm483np9c',
        'Hm_lvt_798bcc2e164540abf265d2beeb49b3b0': '1764167889',
        'HMACCOUNT': '08D353962B94E89F',
        'zh_choose_ztcj': 'jian',
        'Hm_lpvt_798bcc2e164540abf265d2beeb49b3b0': '1764167907',
    }

    headers = {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json;charset=utf-8',
        'Pragma': 'no-cache',
        'Referer': 'https://www.zhitongcaijing.com/content/recommend.html',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        # 'Cookie': 'aliyungf_tc=e16f52ac8f1180c63045411bf1f012638c0791bfe484e81f5b47dfb8d46caf73; PHPSESSID=2f69us95u8r2cdhdatm483np9c; Hm_lvt_798bcc2e164540abf265d2beeb49b3b0=1764167889; HMACCOUNT=08D353962B94E89F; zh_choose_ztcj=jian; Hm_lpvt_798bcc2e164540abf265d2beeb49b3b0=1764167907',
    }

    params = {
        'data_type': '1',
        'page': str(page),
        'platform': 'web',
    }
    token = get_token(params)
    params['token'] = token
    # print(params)

    response = requests.get('https://www.zhitongcaijing.com/content/recommend.html', params=params, cookies=cookies,headers=headers).json()
    # print(response)
    return response


def jiexi(resp):
    data_list = resp['data']
    for a_data in data_list:
        title = a_data['title']
        ti = int(a_data['original_time'])
        ti = datetime.datetime.fromtimestamp(ti)
        xiang_url = 'https://www.zhitongcaijing.com' + a_data['url']
        print(title,ti,xiang_url)


def main():
    for page in range(1,20):
        resp = spider(page)
        jiexi(resp)


if __name__ == '__main__':
    main()