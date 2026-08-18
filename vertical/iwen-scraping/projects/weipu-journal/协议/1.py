# https://qikan.cqvip.com/Qikan/Search/Index?from=index

# 瑞数

import requests
from lxml import etree
import execjs


def spider():
    url = 'https://qikan.cqvip.com/Qikan/Search/Index?from=index'
    headers = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'priority': 'u=0, i',
        'referer': 'https://qikan.cqvip.com/Qikan/Search/Index?from=index',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        # 'cookie': '6HZbKHDjIEcgS=60zjSDIwqHZ7azEn9Vbm3pnZjL96iQ0WSypAs1HtbcLERCNseNPZ2rl7rYyFlZv01_kUTqo3Vju5bwsEa6bd7VQq; bbe2fd78a5836b4864=9412c3c5350c84c17f2255979cf15e34; f6324025fe=c9d1538376cacc113f615e4718350312; ASP.NET_SessionId=hnow0eeekvmmugcpiuygpsca; LIBUSERCOOKIE=Oosn4ui%2b3LJX5JgKzYZ95idPxkVpETqyjRyS8c7iRf0HCVRXosYw7LzYtXoz%2fa2BcXU26V2QLFlxOL0kv7VPUkvzdYaV9EU4zMzj800rsYtQuX9ryhpLIizuSAIe3hk6GwzBwj9ndxfj9gouCCC41nJPa3kz4Aq60ZbfvzhIbdNDO05tHXtM%2bqJFze2iFrDStikRXvCNFPv%2bQzW2WUN9xOfIAQPLKSL4YS3KmKDV3T%2fFz6UwEeqyrbEHVxKK9WHvvcd19xVQ6BAhAJLQacRqoxSzoR7EMSYR3626VyNUBTunbrPmMNYfD9MEB0dDwcP0enCHUn7QJZ4MpCGaF%2bHwrlv%2f%2bW0mDSqb6oWm9PTxOQ2IPui33GKLq5R4J81ex2r9bauqW4obemfSNcAcVuaGLQQCzBcdEgNYsaXIb19QTgQ%3d; LIBUSERIDCOOKIE=0; LIBUSERNAMECOOKIE=; Hm_lvt_fee827c3dc795c5122daf5ee854c1683=1761490682,1761531766,1761582910,1761613070; Hm_lvt_17262dc62ce874a510e9c97140f381d6=1761490686,1761531766,1761582910,1761613070; __root_domain_v=.cqvip.com; _qddaz=QD.509847841171388; _qdda=3-1.228itv; _qddab=3-dpisw1.mh9y8kkk; user_behavior_flag=4eabe8b0-0583-4525-9509-37cb08ff4fb5; search_isEnable=1; Hm_lpvt_17262dc62ce874a510e9c97140f381d6=1761618981; Hm_lpvt_fee827c3dc795c5122daf5ee854c1683=1761618981; 6HZbKHDjIEcgT=0yTSjJPOZIJfux6TgNDg4dGO3A..GuZyC48_iinRL5vVqm_RNfXvvL4t5jeCH.8fDIZEcq_oLNohU22uTKciqYNsT2wVZaS5ctnlBDR2wstJ6Qa1wwB7lN8a3IWgc_YCQnFpdsJJgibc7ulm0Eaevfeq3DgNuUHKiO45jz03d1.5LgHG4mgKg8Phx1BNiDFAITNHvL4bA2OfyJM2phO.DHiuLk.dx0w.UHqRfReNe5mhsx6TS5jBejjwv7m2uj_.j1K.ophr.RJwZv09wZgrAu44vyW8drxqRtFCQzNI7YZbInORLNGdhLIxzn4u3wkK9K1kMS7H6uEeQltNg5uLUmPEtVNfaWI0OZZWLDSQSsP2Tt5u6EkquaV6gyu5pcgjGZ76w55LtcoDbIpbIYt8GdUleyJeH7y0HCQnyrnEVGkb9tu6MJEl3C0lj9Xa04t8N; tfstk=gu5-f7Ok2oqoebnryM20KqEVJlUc9-bzHg7stHxodiIA-gduzwbBvB_O2HvQ4QfdD9jJZz7HNncdxwflxQ6PpeIGPMpUzHxBvMbCErVgsa7yTBOLj5VgW-2ig_KIxBOyGt1bTYPgsa75g13pP5XlzrKyJHOBF3gjcn8ePDsIOIavRemSdbsClrK2-XTWdL9jceYpRBOCAZav8nTWOLsClrLecHGxrzKnPhldUGeOV5NDzXGCMUp8natjOE5vyLK1PKhIOV8Jeh_WDuNTku9f8pCE8Xp1POSe5gi7vH5Al_61foDkVOLdS9Q7NjOlaa66d1ZEdGdRvd1WH2G1zatkME1_-A-cM3jCwKai6pAfsdO5n-rkKQLOA_S-JXs1oNfy36EtcHWk7ITdTPMpvpsrG1fTGYnMXeD7krHELLTqHnlCtIWWHhTvjr2mLvJvuEKgkrHELLT2kh4VgvkeHE5..',
    }
    session = requests.session()
    resp = session.get(url,headers = headers,verify=False)
    resp.encoding = 'utf-8'
    print(resp)

    html = etree.HTML(resp.text)
    content_str = html.xpath('//meta/@content')[-1]
    ts_js = html.xpath('//script/text()')[0]
    auto_url = 'https://qikan.cqvip.com' + html.xpath('//script[2]/@src')[0]

    auto_js = session.get(auto_url).text

    with open('整体环境.js','r',encoding='utf-8') as js_file:
        js_code = js_file.read()
    js_code = js_code.replace('meta_content',content_str).replace("'ts_'",ts_js).replace("'auto_'",auto_js)

    js_compile = execjs.compile(js_code)
    # print(js_compile)
    cookie_t = js_compile.call('get_cookie').split(';')[0].split('=')
    print(cookie_t)

    session.cookies.update({cookie_t[0]: cookie_t[1]})

    print(session.cookies.get_dict())

    response = session.get(url, headers=headers, verify=False)
    print(response)


def main():
    spider()


if __name__ == '__main__':
    main()