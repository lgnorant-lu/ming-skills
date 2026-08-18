import requests
import execjs
import ddddocr

f = open('1.js',mode='r',encoding='utf-8')
js_code = f.read()
f.close()
js = execjs.compile(js_code)

headers = {
    "accept": "*/*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "zh-CN,zh;q=0.9",
    "cache-control": "no-cache",
    "content-length": "18",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "cookie": "kbzw__Session=1kbecqffb0orhss7si3sp4e9g6; Hm_lvt_164fe01b1433a19b507595a43bf58262=1743850385; Hm_lpvt_164fe01b1433a19b507595a43bf58262=1743850385; HMACCOUNT=D842C5F1E4F86AD4; kbz_newcookie=1",
    "origin": "https://www.jisilu.cn",
    "pragma": "no-cache",
    "priority": "u=1, i",
    "referer": "https://www.jisilu.cn/login/",
    "sec-ch-ua": "\"Chromium\";v=\"134\", \"Not:A-Brand\";v=\"24\", \"Google Chrome\";v=\"134\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "x-requested-with": "XMLHttpRequest"
}

session = requests.session()
session.headers = headers
# 验证码图片地址
url1 = 'https://www.jisilu.cn/webapi/account/check_code_verify/'

# 保存验证码图片
img_data = requests.get('https://www.jisilu.cn/account/captcha/1399').content
with open('../tu.jpg', 'wb') as f:
    f.write(img_data)
# ddddocr验证图片
ddd = ddddocr.DdddOcr(show_ad=False)
f = open('../tu.jpg', 'rb')
shibie = ddd.classification(f.read())
# print(shibie)

yzm = {
    "code_verify": shibie
}
img_resp = requests.post(url1,headers=session.headers,data=yzm)
print(img_resp)

url = 'https://www.jisilu.cn/webapi/account/login_process/'

user_name = '111111111'
user_pass = '12121212'

mi_name = js.call('jslencode',user_name)
mi_pass = js.call('jslencode',user_pass)
print(f'加密后账号:{mi_name},加密后密码:{mi_pass}')
c_data = {
    "return_url": "/",
    "user_name": mi_name,
    "password": mi_pass,
    "aes": "1",
    "auto_login": "0",
    "code_verify": yzm
}

resp = requests.post(url, headers=session.headers, data=c_data)
print(resp.text)



