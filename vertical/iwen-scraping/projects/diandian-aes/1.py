# https://app.diandian.com/rank/ios/1-4-0-75-2?time=1764241360000&device=1


# 参数:k     方式：AES
import requests,time,execjs,datetime


def get_k(params):
    f = open('get_mi_can.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)
    return js.call('get_k',params)


def spider(page):

    ti = int(time.time())

    cookies = {
        'deviceid': 'c27598a2149e0fa2fc127c065dc6244',
        'Qs_lvt_404253': '1764241096',
        '_ga': 'GA1.1.2079485503.1764241101',
        'token': '89e013f938ffb8714b926260859170993dddef4960b6beabd8181878a4d192813c5c4d34d245bea22a337850b6548565f088a0788df16f5e2672471037635edb3557f80e3960a295c835eea4b926551a',
        '_uetsid': 'fd0a0e40cb7f11f0bab003fa0fddfaa7|ylu076|2|g1d|0|2157',
        '_uetvid': 'fd0a0dd0cb7f11f0b89677d75bb9e97b|136ma6x|1764244047383|18|1|bat.bing.com/p/conversions/c/b',
        'Qs_pv_404253': '697957136887494500%2C4278877137483383000%2C3093821525638321000%2C1055192542657013800%2C579062568059765600',
        '_ga_GVCWL6PNZ2': 'GS2.1.s1764241101$o1$g1$t1764244047$j57$l0$h0',
    }

    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Origin': 'https://app.diandian.com',
        'Pragma': 'no-cache',
        'Referer': 'https://app.diandian.com/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'language': 'zh',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        # 'Cookie': 'deviceid=c27598a2149e0fa2fc127c065dc6244; Qs_lvt_404253=1764241096; _ga=GA1.1.2079485503.1764241101; token=89e013f938ffb8714b926260859170993dddef4960b6beabd8181878a4d192813c5c4d34d245bea22a337850b6548565f088a0788df16f5e2672471037635edb3557f80e3960a295c835eea4b926551a; _uetsid=fd0a0e40cb7f11f0bab003fa0fddfaa7|ylu076|2|g1d|0|2157; _uetvid=fd0a0dd0cb7f11f0b89677d75bb9e97b|136ma6x|1764244047383|18|1|bat.bing.com/p/conversions/c/b; Qs_pv_404253=697957136887494500%2C4278877137483383000%2C3093821525638321000%2C1055192542657013800%2C579062568059765600; _ga_GVCWL6PNZ2=GS2.1.s1764241101$o1$g1$t1764244047$j57$l0$h0',
    }

    params = {
        'market_id': '1',
        'genre_id': '0',
        'country_id': '75',
        'device_id': '1',
        'page': '{}'.format(page),
        'time': str(ti),
        'rank_type': '4',
        'brand_id': '2',
    }
    k = get_k(params)
    params['k'] = k
    # print(params)

    response = requests.get('https://api.diandian.com/pc/app/v1/rank', params=params, cookies=cookies, headers=headers).json()
    # print(response)
    return response


def jiexi(resp):
    data_list = resp['data']['apps']
    print("======= 所有应用名称 =======")
    for a_data in data_list:
        # 名字
        name = a_data['name']
        # 综合评分
        zhpf = a_data['rating']
        # 评分数
        pfs = a_data['rating_count']
        # 发布时间
        ti = a_data['release_time']
        ti = datetime.datetime.fromtimestamp(ti)
        # 分类
        fl = ",".join([cat['name'] for cat in a_data['genres']])
        print(name,zhpf,pfs,ti,fl)


def main():
    for page in range(1,11):
        resp = spider(page)
        jiexi(resp)


if __name__ == '__main__':
    main()