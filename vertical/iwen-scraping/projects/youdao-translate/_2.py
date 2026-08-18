import requests
import execjs

f = open('_2.js',mode='r',encoding='utf-8')
js_code = f.read()
f.close()
js = execjs.compile(js_code)

url = 'https://dict.youdao.com/webtranslate'
wind = 'banana'
headers = {
    "accept": "application/json, text/plain, */*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "zh-CN,zh;q=0.9",
    "connection": "keep-alive",
    "content-length": "324",
    "content-type": "application/x-www-form-urlencoded",
    "cookie": "OUTFOX_SEARCH_USER_ID=562968306@60.222.91.47; OUTFOX_SEARCH_USER_ID_NCOO=2108306468.4729972; _uetsid=0ae31cf0e3cd11efa2fc17fc8463a791; _uetvid=0ae326e0e3cd11ef9164c3979c01731f; DICT_DOCTRANS_SESSION_ID=NjgzZWI3MzYtYjczNS00NDJhLWI4YWEtN2M5ZWZjYzY3NmEw",
    "host": "dict.youdao.com",
    "origin": "https://fanyi.youdao.com",
    "referer": "https://fanyi.youdao.com/",
    "sec-ch-ua": "\"Not A(Brand\";v=\"8\", \"Chromium\";v=\"132\", \"Google Chrome\";v=\"132\"",
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": "\"Android\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36"
}

form_data = js.call('k',wind)

resp = requests.post(url,headers=headers,data=form_data)
# print(resp.text)

ming = js.call('O',resp.text)
print(ming)