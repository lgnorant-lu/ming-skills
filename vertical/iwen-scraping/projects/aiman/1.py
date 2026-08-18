# https://www.chinaindex.net/ranklist/4

# 参数：sign -> md5  resp加密
import execjs
import requests


def get_sign(e):
    f = open('get_sign.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    sign = js.call('getSign',e)
    return sign


def spider(p):
    cookies = {
        'mobile_iindex_uuid': '10c4c22d-10d8-5c78-b903-15128dc50fe5',
        'Hm_lvt_2873e2b0bdd5404c734992cd3ae7253f': '1762094427',
        'Hm_lpvt_2873e2b0bdd5404c734992cd3ae7253f': '1762094427',
        'HMACCOUNT': '08D353962B94E89F',
    }

    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache',
        'Referer': 'https://www.chinaindex.net/ranklist/4',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'UUID': '10c4c22d-10d8-5c78-b903-15128dc50fe5',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'funcID': 'undefined',
        'incognitoMode': '0',
        'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        # 'Cookie': 'mobile_iindex_uuid=10c4c22d-10d8-5c78-b903-15128dc50fe5; Hm_lvt_2873e2b0bdd5404c734992cd3ae7253f=1762094427; Hm_lpvt_2873e2b0bdd5404c734992cd3ae7253f=1762094427; HMACCOUNT=08D353962B94E89F',
    }

    e = p.get('channel')
    # print(e)

    params = {
        'channel': 'movielist',
        'sign': get_sign(e),
    }

    response = requests.get(
        'https://www.chinaindex.net/iIndexMobileServer/mobile/movie/objectFansRank',
        params=params,
        cookies=cookies,
        headers=headers,
    ).text
    print(response)


def main():
    p = {
        'channel': 'movielist',
    }

    spider(p)


if __name__ == '__main__':
    main()