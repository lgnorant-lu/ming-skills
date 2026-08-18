import requests
import execjs
import ddddocr
import json

headers = {
    "accept": "*/*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "zh-CN,zh;q=0.9",
    "content-length": "18",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "cookie": "kbzw__Session=56n27e5nnr3t08cfcgg78guqk2; Hm_lvt_164fe01b1433a19b507595a43bf58262=1737534017; HMACCOUNT=28D298F69298E4E4; kbz_newcookie=1; Hm_lpvt_164fe01b1433a19b507595a43bf58262=1737535778",
    "origin": "https://www.jisilu.cn",
    "priority": "u=1, i",
    "referer": "https://www.jisilu.cn/login/",
    "sec-ch-ua": "\"Not A(Brand\";v=\"8\", \"Chromium\";v=\"132\", \"Google Chrome\";v=\"132\"",
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": "\"Android\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
    "x-requested-with": "XMLHttpRequest"
}

session = requests.session()
session.headers = headers

# 保存验证码图片
img_data = requests.get('https://www.jisilu.cn/account/captcha/1399').content
with open('../tu.jpg', 'wb') as f:
    f.write(img_data)
# ddddocr验证图片
ddd = ddddocr.DdddOcr(show_ad=False)
f = open('../tu.jpg', 'rb')
shibie = ddd.classification(f.read())
print(shibie)
# 发送验证码接口
url = 'https://www.jisilu.cn/webapi/account/check_code_verify/'

yzm = {
    "code_verify": shibie
}
resp = requests.post(url, headers=session.headers, data=yzm)

print(resp.text)

# # 账号密码
# url1 = 'https://www.jisilu.cn/webapi/account/login_process/'
#
# data = {
#     "return_url": "/",
#     "user_name": "ec4c0ddcc132d80a2f7848d671439fd1",
#     "password": "8ead4fa5dc4e49e459b394071e237dd9",
#     "aes": "1",
#     "auto_login": "0"
# }
#
# resps = requests.post(url1, data=data, headers=session.headers)
# print(resps.text)
