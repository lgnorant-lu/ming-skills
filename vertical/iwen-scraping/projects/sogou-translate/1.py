# https://fanyi.sogou.com/text


import requests


def spider(key_word):

    url = 'https://fanyi.sogou.com/api/transwap/text/result'

    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json;charset=UTF-8',
        'Origin': 'https://fanyi.sogou.com',
        'Pragma': 'no-cache',
        'Referer': 'https://fanyi.sogou.com/text?keyword=%E4%BD%A0%E5%A5%BD&transfrom=auto&transto=zh-CHS&model=general&errcode=s10',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
        'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'Cookie': 'SUID=7FABCF785B54A20B0000000068C82DE3; SUV=001E1B5178CFAB7F68C82E04D62A0798; cuid=AAFfKpMEVgAAAAuiUb+8VAAASQU=; LSTMV=209%2C81; LCLKINT=3577; ABTEST=0|1762267968|v17; SNUID=0044B71F151256D0E82BA20D1572E9AD; wuid=1762267968225; FQV=ae0415c5f996d3cd4e9bf90be7440c8d; translate.sess=1dcbdaa5-6c77-4cd1-9d04-1c960856f24e; SGINPUT_UPSCREEN=1762267968696; FUV=5e9c593f157b53a7b3bf1367baa065eb; wuid=AAHifgQGVwAAAAuipZel+gAA1wA=',
    }

    json_data = {
        'from': 'auto',
        'to': 'en',
        'text': key_word,
        'client': 'wap',
        'fr': 'browser_wap',
        'needQc': 1,
        's': 'fbcbe14b530b41d0a11773a107776f5e',
        'uuid': 'e8bb75cb-68ef-4539-b5bd-2f265b4bcb24',
    }

    response = requests.post(url, headers=headers,json=json_data).text
    print(response)


def main():
    key_word = 'hi'
    spider(key_word)

if __name__ == '__main__':
    main()