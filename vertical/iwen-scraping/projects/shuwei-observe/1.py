import requests
import execjs
import json

f = open('1.js',mode='r',encoding='utf-8')
js_code = f.read()
f.close()
js = execjs.compile(js_code)

url = 'https://app.swguancha.com/client/v1/cPublic/consumer/baseInfo'

data = {
    "current": 2,
    "dimensionTime": "2019",
    "levelType": 2,
    "propertyCode":
        ['DISTRICT_PROP_GJ025_RJDQSCZZ',
         'DISTRICT_PROP_GJ117_NMSYGGQDCYYCLS',
         'DISTRICT_PROP_GJ001_NMHJRK'],
    "size": 16
}
# print(data)

headers = {
    "accept": "application/json, text/plain, */*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "zh-CN,zh;q=0.9",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "content-length": "174",
    "content-type": "application/json;charset=UTF-8",
    "devicetype": "1",
    "host": "app.swguancha.com",
    "origin": "https://www.swguancha.com",
    "pragma": "no-cache",
    "referer": "https://www.swguancha.com/",
    "sec-ch-ua": "\"Chromium\";v=\"134\", \"Not:A-Brand\";v=\"24\", \"Google Chrome\";v=\"134\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
}

resp = requests.post(url,data=json.dumps(data,separators=(',', ':')),headers=headers)
# print(resp.text)
resp_data = js.call('fn',resp.text)
print(resp_data)