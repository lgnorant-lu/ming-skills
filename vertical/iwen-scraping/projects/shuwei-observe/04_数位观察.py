import requests
import execjs
import json

f = open('复刻数位观察城市数据.js', mode='r', encoding='utf-8')
js_code = f.read()
f.close()
js = execjs.compile(js_code)

headers = {
    "accept": "application/json, text/plain, */*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "zh-CN,zh;q=0.9",
    "connection": "keep-alive",
    "content-length": "174",
    "content-type": "application/json;charset=UTF-8",
    "devicetype": "1",
    "host": "app.swguancha.com",
    "origin": "https://www.swguancha.com",
    "referer": "https://www.swguancha.com/",
    "sec-ch-ua": "\"Not A(Brand\";v=\"8\", \"Chromium\";v=\"132\", \"Google Chrome\";v=\"132\"",
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": "\"Android\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36"
}

session = requests.session()
session.headers = headers

url = 'https://app.swguancha.com/client/v1/cPublic/consumer/baseInfo'

data = {
    "size": 16,
    "current": 2,
    "propertyCode":
        ["DISTRICT_PROP_GJ025_RJDQSCZZ",
         "DISTRICT_PROP_GJ117_NMSYGGQDCYYCLS",
         "DISTRICT_PROP_GJ001_NMHJRK"],
    "dimensionTime": "2019",
    "levelType": 2
}

resp = requests.post(url, data=json.dumps(data, separators=(',', ':')), headers=session.headers)
# print(resp.text)

print(js.call('fn', resp.text))
