import requests
import execjs

f = open('天气.js', mode='r', encoding='utf-8')
js_code = f.read()
f.close()
js = execjs.compile(js_code)

url = 'https://www.aqistudy.cn/apinew/aqistudyapi.php'

data = {
    'city': '南京'
}
mi = js.call('fn', data)
form_data = {
    'h1zlb1QoZ': mi
}

headers = {
    "accept": "*/*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "zh-CN,zh;q=0.9",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "content-length": "252",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "cookie": "Hm_lvt_6088e7f72f5a363447d4bafe03026db8=1738998525,1739027008,1739027620,1739098868; HMACCOUNT=D842C5F1E4F86AD4; Hm_lpvt_6088e7f72f5a363447d4bafe03026db8=1739100094",
    "host": "www.aqistudy.cn",
    "origin": "https://www.aqistudy.cn",
    "pragma": "no-cache",
    "referer": "https://www.aqistudy.cn/html/city_realtime.php?v=2.3",
    "sec-ch-ua": "\"Not(A:Brand\";v=\"99\", \"Google Chrome\";v=\"133\", \"Chromium\";v=\"133\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "x-requested-with": "XMLHttpRequest"
}

resp = requests.post(url, headers=headers, data=form_data)
# print(resp.text)
# 打开charles会报错，提示ssl证书不通过

ming = js.call('gn', resp.text)
print(ming)
