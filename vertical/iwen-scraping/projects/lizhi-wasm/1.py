# https://www.gdtv.cn/channels/3#30

# 参数：x-开头参数   wasm
import requests


def spider():

    headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'content-type': 'application/json',
        'origin': 'https://www.gdtv.cn',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://www.gdtv.cn/',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'x-itouchtv-ca-key': '89541943007407288657755311868534',
        'x-itouchtv-ca-signature': 'jdzmaF94X1+HA0bZ+b5QwVZELVCMz6NyGim4GZx4wnw=',
        'x-itouchtv-ca-timestamp': '1759934013049',
        'x-itouchtv-client': 'WEB_PC',
        'x-itouchtv-device-id': 'WEB_466f5e70-a453-11f0-8fae-8d838fa70bf9',
    }

    params = {
        'beginScore': '0',
        'channelId': '30',
        'pageSize': '11',
    }

    response = requests.get('https://gdtv-api.gdtv.cn/api/channel/v1/news', params=params, headers=headers).text

    print(response)

def main():
    spider()

if __name__ == '__main__':
    main()