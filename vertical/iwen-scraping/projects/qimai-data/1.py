# https://www.qimai.cn/rank/index/brand/grossing/device/iphone/country/cn/genre/36


# 参数：analysis


import requests,execjs


def get_analysis(info):
    f = open('get_analysis.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    analysis = js.call('get_analysis',info)
    print(analysis)
    return analysis


def spider(page):
    url = 'https://api.qimai.cn/rank/index?'

    cookies = {
        'gr_user_id': '101ba6f4-0720-44de-9e4b-2dec39bb031a',
        'ada35577182650f1_gr_last_sent_cs1': 'qm23495750667',
        'Hm_lvt_ff3eefaf44c797b33945945d0de0e370': '1737285893,1737286001,1738428995,1738429033',
        'Hm_lvt_5743840c765eced6094267d6e69ad21d': '1737285893,1737286001,1738428995,1738429033',
        'qm_check': 'A1sdRUIQChtxen8pI0dAMRcOUFseEHBeQF0JTjVBWCwycRd1QlhAXFEGFUdASAFKBQcCBA9xBxFFIg4aHRoOBnMDARlGR2dQOVdICAolAGgCHBl0B3xUV05KVFsZXVJRWxsKFghJVktYVElWBRVP',
        'PHPSESSID': '774h359s5qujc2nq829mk37ffg',
        'ada35577182650f1_gr_session_id': '77d3be2c-60b6-4f19-b981-110bb84100fa',
        'ada35577182650f1_gr_last_sent_sid_with_cs1': '77d3be2c-60b6-4f19-b981-110bb84100fa',
        'ada35577182650f1_gr_session_id_sent_vst': '77d3be2c-60b6-4f19-b981-110bb84100fa',
        'USERINFO': 'lkZMKg87NJgxxPhbXvILY5X1EuIovgR1nhRI1UAbmsCr2kvQJ7JQFJmMPhKJU9e3gduQiVzMtyeLXGEoryeuscwDLACDoA3AGwBY%2F7WZ0Wg9Alug%2Fv3%2FilzQGmsi1jD8bxDfomV%2BUp4HleDZ0q3nWl9TOBf3fxvy',
        'AUTHKEY': 'owsQdWQ%2BKrWgMQ2j8IXAau8%2FX23j07U1729bLvM0TXo8%2Bmb0Qh8E5RLcJ3u%2B3bCCtwkdhDywYJKQd61WVNvry%2FTFeecB7mRq0laUm%2BpfBbprJGy4VUWbnA%3D%3D',
        'aso_ucenter': '3317SMSlGIglufZO9vcdkfdOlyH2FN8usVHlQD5JAiHwwstANh%2FWz0QBf9jUY4%2BvcFo',
        'synct': '1762935213.161',
        'syncd': '-451',
        'ada35577182650f1_gr_cs1': 'qm23495750667',
    }

    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Origin': 'https://www.qimai.cn',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        # 'Cookie': 'gr_user_id=101ba6f4-0720-44de-9e4b-2dec39bb031a; ada35577182650f1_gr_last_sent_cs1=qm23495750667; Hm_lvt_ff3eefaf44c797b33945945d0de0e370=1737285893,1737286001,1738428995,1738429033; Hm_lvt_5743840c765eced6094267d6e69ad21d=1737285893,1737286001,1738428995,1738429033; qm_check=A1sdRUIQChtxen8pI0dAMRcOUFseEHBeQF0JTjVBWCwycRd1QlhAXFEGFUdASAFKBQcCBA9xBxFFIg4aHRoOBnMDARlGR2dQOVdICAolAGgCHBl0B3xUV05KVFsZXVJRWxsKFghJVktYVElWBRVP; PHPSESSID=774h359s5qujc2nq829mk37ffg; ada35577182650f1_gr_session_id=77d3be2c-60b6-4f19-b981-110bb84100fa; ada35577182650f1_gr_last_sent_sid_with_cs1=77d3be2c-60b6-4f19-b981-110bb84100fa; ada35577182650f1_gr_session_id_sent_vst=77d3be2c-60b6-4f19-b981-110bb84100fa; USERINFO=lkZMKg87NJgxxPhbXvILY5X1EuIovgR1nhRI1UAbmsCr2kvQJ7JQFJmMPhKJU9e3gduQiVzMtyeLXGEoryeuscwDLACDoA3AGwBY%2F7WZ0Wg9Alug%2Fv3%2FilzQGmsi1jD8bxDfomV%2BUp4HleDZ0q3nWl9TOBf3fxvy; AUTHKEY=owsQdWQ%2BKrWgMQ2j8IXAau8%2FX23j07U1729bLvM0TXo8%2Bmb0Qh8E5RLcJ3u%2B3bCCtwkdhDywYJKQd61WVNvry%2FTFeecB7mRq0laUm%2BpfBbprJGy4VUWbnA%3D%3D; aso_ucenter=3317SMSlGIglufZO9vcdkfdOlyH2FN8usVHlQD5JAiHwwstANh%2FWz0QBf9jUY4%2BvcFo; synct=1762935213.161; syncd=-451; ada35577182650f1_gr_cs1=qm23495750667',
    }

    info = [
    1,
    "2025-11-12",
    "21:56:19",
    page,
    "36",
    "cn",
    "grossing",
    "iphone"
]

    parsme = {
        "analysis": get_analysis(info),
        "brand": "grossing",
        "device": "iphone",
        "country": "cn",
        "genre": "36",
        "date": "2025-11-12",
        "page": '{}'.format(page),
        "is_rank_index": "1",
        "snapshot": "21:56:19"
    }

    response = requests.get(url,cookies=cookies,headers=headers,params=parsme).json()
    print(response)


def main():
    for page in range(1,6):
        spider(page)


if __name__ == '__main__':
    main()