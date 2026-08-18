import requests
import execjs

f = open('3.js',mode='r',encoding='utf-8')
js_code = f.read()
f.close()
js = execjs.compile(js_code)

url = 'https://dict.youdao.com/webtranslate'

danci = 'open'

mi_data = js.call('fn',danci)
# print(mi_data)

my_headers = {
    "accept": "application/json, text/plain, */*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "zh-CN,zh;q=0.9",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "content-length": "330",
    "content-type": "application/x-www-form-urlencoded",
    "cookie": "OUTFOX_SEARCH_USER_ID=562968306@60.222.91.47; OUTFOX_SEARCH_USER_ID_NCOO=2108306468.4729972; _uetsid=f9a61ac017ae11f09baa83f0b75439cf; _uetvid=0ae326e0e3cd11ef9164c3979c01731f; DICT_DOCTRANS_SESSION_ID=ZWU4NjVjODEtMTgyMi00MjM2LWFkMzktODY4OGI3NjdjYWJk",
    "host": "dict.youdao.com",
    "origin": "https://fanyi.youdao.com",
    "pragma": "no-cache",
    "referer": "https://fanyi.youdao.com/",
    "sec-ch-ua": "\"Google Chrome\";v=\"135\", \"Not-A.Brand\";v=\"8\", \"Chromium\";v=\"135\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
}


mi_resp = requests.post(url,data=mi_data,headers=my_headers)
# print(mi_resp.text)
data = js.call('O',mi_resp.text)
print(data)