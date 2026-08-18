# https://tousu.sina.com.cn/index/search/?keywords=%E6%B7%98%E5%AE%9D&t=1


# 参数：sign     方式：sha256


import requests,execjs


def jiexi_resp(response):
    # print(response)
    for a in response:
        a = a['main']
        bt = a['title'].replace('<span class="code-red">','').replace("</span>",'')
        ly = a['summary']
        wt = a['issue']
        dx = a['cotitle'].replace('<span class="code-red">','').replace("</span>",'')
        yq = a['appeal']
        print(bt,ly,wt,dx,yq,sep=' | ')


def get_mi_dic(key,page):
    f = open('get_sign.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    dic = js.call('get_sign',key,page)
    return dic


def spider(key,page):

    url = 'https://tousu.sina.com.cn/api/index/s'
    cookies = {
        'UOR': 'www.baidu.com,henan.sina.com.cn,',
        'SINAGLOBAL': '120.207.171.58_1746720022.705143',
        'U_TRS1': '00000029.4c7c1e379.683db739.3a7b6174',
        'ALF': '02_1766395204',
        'SCF': 'An79xs1skEZ_biKT8RJTwigCB35oFLMcuZuElEhAq9gDxsNbmfW7eo_ImT5gi7WK69uC3ruG9OjaNS5ZoSWvkRg.',
        'SUB': '_2A25EJfAUDeRhGeFH71QV8yrFwjuIHXVnWw3crDV_PUJbkNANLWuikW9NeznLukuc7kiJfFleabMAN_rg0azN_uSa',
        'SUBP': '0033WrSXqPxfM725Ws9jqgMF55529P9D9WhYR.7.Sl_efeJeDcCRl7Np5NHD95QN1KBcSheX1K.NWs4Dqc_ii--ciKy8i-2fi--NiKnRi-8hi--RiK.4i-8Fi--fiKy2iK.fPEH8Sb-4BE-R1CH81C-4BE-ReFH8SbHFeC-RebH8SEHWSE-ReBtt',
        'Apache': '120.207.171.38_1763803210.545240',
        'U_TRS2': '00000026.7a4b431e.6921804c.3eecc884',
        'ULV': '1763803265788:16:1:1:120.207.171.38_1763803210.545240:1751362203120',
        'HM-AMT': '%7B%22amt%22%3A30952843%2C%22amt24h%22%3A21585%2C%22v%22%3A%222.3.184%22%2C%22vPcJs%22%3A%221.6.87%22%2C%22vPcCss%22%3A%221.2.399%22%7D',
    }

    headers = {
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://tousu.sina.com.cn/index/search/?keywords=%E6%B7%98%E5%AE%9D&t=1',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'x-requested-with': 'XMLHttpRequest',
        # 'cookie': 'UOR=www.baidu.com,henan.sina.com.cn,; SINAGLOBAL=120.207.171.58_1746720022.705143; U_TRS1=00000029.4c7c1e379.683db739.3a7b6174; ALF=02_1766395204; SCF=An79xs1skEZ_biKT8RJTwigCB35oFLMcuZuElEhAq9gDxsNbmfW7eo_ImT5gi7WK69uC3ruG9OjaNS5ZoSWvkRg.; SUB=_2A25EJfAUDeRhGeFH71QV8yrFwjuIHXVnWw3crDV_PUJbkNANLWuikW9NeznLukuc7kiJfFleabMAN_rg0azN_uSa; SUBP=0033WrSXqPxfM725Ws9jqgMF55529P9D9WhYR.7.Sl_efeJeDcCRl7Np5NHD95QN1KBcSheX1K.NWs4Dqc_ii--ciKy8i-2fi--NiKnRi-8hi--RiK.4i-8Fi--fiKy2iK.fPEH8Sb-4BE-R1CH81C-4BE-ReFH8SbHFeC-RebH8SEHWSE-ReBtt; Apache=120.207.171.38_1763803210.545240; U_TRS2=00000026.7a4b431e.6921804c.3eecc884; ULV=1763803265788:16:1:1:120.207.171.38_1763803210.545240:1751362203120; HM-AMT=%7B%22amt%22%3A30952843%2C%22amt24h%22%3A21585%2C%22v%22%3A%222.3.184%22%2C%22vPcJs%22%3A%221.6.87%22%2C%22vPcCss%22%3A%221.2.399%22%7D',
    }

    mi = get_mi_dic(key,page)
    # print(mi)

    params = {
        'ts': mi['ts'],
        'rs': mi['rs'],
        'signature': mi['sign'],
        'keywords': '淘宝',
        'page_size': '10',
        'page': page,
    }

    response = requests.get(url, params=params, cookies=cookies, headers=headers).json()
    response = response['result']['data']['lists']
    # print(response)
    return response


def main():
    key = '淘宝'
    for page in range(1,20):
        response = spider(key,page)
        jiexi_resp(response)
        # break


if __name__ == '__main__':
    main()