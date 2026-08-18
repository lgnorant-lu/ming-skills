# https://www.bilibili.com/video/BV1WWCXBfEHF/?spm_id_from=333.1007.tianma.3-1-7.click&vd_source=84e0c0af5797b6664def9062b87116cf



# 参数：w_rid     方式 md5


import requests,execjs


def get_rid(parmas,):
    f = open('get_rid.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    dic = js.call('get_rid',parmas)
    return dic


def spider(parmas):

    dic = get_rid(parmas)
    rid = dic['w_rid']
    wts = dic['wts']

    url = f'https://api.bilibili.com/x/v2/reply/wbi/main?oid=115557336617709&type=1&mode=3&pagination_str=%7B%22offset%22:%22CAESEDE4MDYyMjE2NTMwMjQzODAiAggB%22%7D&plat=1&web_location=1315875&w_rid={rid}&wts={wts}'
    cookies = {
        'buvid_fp': 'f014e7e822e8ddd8724494b10c6fe3ed',
        'enable_web_push': 'DISABLE',
        'DedeUserID': '1696637618',
        'DedeUserID__ckMd5': 'c31d4f2670e33674',
        'rpdid': '0zbfAGu1XW|hDhy1Wry|2pK|3w1TaIGc',
        'header_theme_version': 'OPEN',
        'enable_feed_channel': 'ENABLE',
        'theme-tip-show': 'SHOWED',
        'theme-avatar-tip-show': 'SHOWED',
        'home_feed_column': '5',
        'browser_resolution': '2560-1271',
        'buvid4': '2F62C934-014F-173E-CE41-505EB4C04A3582918-024111204-mwErRRAUiOS7dIYT2cL6kaG8Pgyr6rRKC3P5+0kzNqiUglgOncaATrVC0rpqnt9r',
        'CURRENT_QUALITY': '80',
        'buvid3': '5FE6B175-6697-4339-5AA2-85CD1F0179B904311infoc',
        'b_nut': '1763736504',
        '_uuid': 'B9122C56-D2105-DDFB-91042-8A93617C4910F12676infoc',
        'bili_ticket': 'eyJhbGciOiJIUzI1NiIsImtpZCI6InMwMyIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NjM5OTU3MTYsImlhdCI6MTc2MzczNjQ1NiwicGx0IjotMX0.JMR9zJSp9hutCREikdobLRwdoy2FZd25Cc8U4sa6Dpk',
        'bili_ticket_expires': '1763995656',
        'SESSDATA': '1c69cfb3%2C1779288548%2Cd839a%2Ab1CjA1YdPtPnRwNEBEdHFjhHSolo-LbRYl39j-QptKcdnHxCdWD5gRJQk564ZJ8uf53cYSVmk5ZWlqU2lkOGtNS081Mk10Y1h3ZVBrbUtsNXV2X0EzQm9kTERaUHhyZTJ6VnJfbW5oRHp5ODJKZjlMLXROVWN5X2JhN1lGYW1lcFNQY0xBQTVscG53IIEC',
        'bili_jct': 'c30eac499ef39381b84d2d015ed90639',
        'b_lsid': '2E6E427F_19AAFDD080B',
        'sid': '7lgmkemr',
        'CURRENT_FNVAL': '4048',
    }

    headers = {
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'origin': 'https://www.bilibili.com',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://www.bilibili.com/video/BV1WWCXBfEHF/?spm_id_from=333.1007.tianma.3-1-7.click&vd_source=84e0c0af5797b6664def9062b87116cf',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        # 'cookie': 'buvid_fp=f014e7e822e8ddd8724494b10c6fe3ed; enable_web_push=DISABLE; DedeUserID=1696637618; DedeUserID__ckMd5=c31d4f2670e33674; rpdid=0zbfAGu1XW|hDhy1Wry|2pK|3w1TaIGc; header_theme_version=OPEN; enable_feed_channel=ENABLE; theme-tip-show=SHOWED; theme-avatar-tip-show=SHOWED; home_feed_column=5; browser_resolution=2560-1271; buvid4=2F62C934-014F-173E-CE41-505EB4C04A3582918-024111204-mwErRRAUiOS7dIYT2cL6kaG8Pgyr6rRKC3P5+0kzNqiUglgOncaATrVC0rpqnt9r; CURRENT_QUALITY=80; buvid3=5FE6B175-6697-4339-5AA2-85CD1F0179B904311infoc; b_nut=1763736504; _uuid=B9122C56-D2105-DDFB-91042-8A93617C4910F12676infoc; bili_ticket=eyJhbGciOiJIUzI1NiIsImtpZCI6InMwMyIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NjM5OTU3MTYsImlhdCI6MTc2MzczNjQ1NiwicGx0IjotMX0.JMR9zJSp9hutCREikdobLRwdoy2FZd25Cc8U4sa6Dpk; bili_ticket_expires=1763995656; SESSDATA=1c69cfb3%2C1779288548%2Cd839a%2Ab1CjA1YdPtPnRwNEBEdHFjhHSolo-LbRYl39j-QptKcdnHxCdWD5gRJQk564ZJ8uf53cYSVmk5ZWlqU2lkOGtNS081Mk10Y1h3ZVBrbUtsNXV2X0EzQm9kTERaUHhyZTJ6VnJfbW5oRHp5ODJKZjlMLXROVWN5X2JhN1lGYW1lcFNQY0xBQTVscG53IIEC; bili_jct=c30eac499ef39381b84d2d015ed90639; b_lsid=2E6E427F_19AAFDD080B; sid=7lgmkemr; CURRENT_FNVAL=4048',
    }

    response = requests.get(url,cookies=cookies,headers=headers).json()
    # print(response)
    return response


def jiexi(response):
    # print(response)
    pls = response['data']['replies']
    for a_pl in pls:
        nr = a_pl['content']['message']
        print(nr)


def main():
    parmas = {
        "oid": "115557336617709",
        "type": 1,
        "mode": 3,
        "pagination_str": "{\"offset\":\"CAESEDE4MDYyMjE2NTMwMjQzODAiAggB\"}",
        "plat": 1,
        "web_location": 1315875
    }

    for page in range(1,11):
        response = spider(parmas)
        jiexi(response)


if __name__ == '__main__':
    main()