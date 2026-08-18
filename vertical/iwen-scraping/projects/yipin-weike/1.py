# https://www.epwk.com/login.html

# 参数：signature


import requests
import execjs
import time
import base64
import json


def get_img_sign():
    f = open('get_img_sign.js', 'r', encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    signature = js.call('sign')['he']['Signature']
    noncestr = js.call('sign')['he']['NonceStr']
    timestemp = js.call('sign')['he']['timestemp']
    print(signature, noncestr,timestemp)

    return {
        'Signature': signature,
        'NonceStr': noncestr,
        'timestemp': timestemp
    }


def get_img_code():
    img_url = 'https://www.epwk.com/api/epwk/v1/captcha/show'

    sign_data = get_img_sign()
    # print(sign_data)
    # 获取 Signature 和 NonceStr
    signature = sign_data['Signature']
    noncestr = sign_data['NonceStr']
    timestemp = sign_data['timestemp']
    # tm = str(int(time.time()))

    cookies = {
        'Hm_lvt_387b8f4fdb89d4ea233922bdc6466394': '1758113416',
        'HMACCOUNT': 'F4037280F82AFFB1',
        'HWWAFSESID': 'fc2508895680434f71',
        'HWWAFSESTIME': '1758113414463',
        'time_diff': '-2',
        'XDEBUG_SESSION': 'XDEBUG_ECLIPSE',
        'adbanner_city': '%E5%A4%AA%E5%8E%9F%E5%B8%82',
        'login_referer': 'https%3A%2F%2Fwww.epwk.com%2F',
        'login_fail_need_graphics': '1',
        'PHPSESSID': '6bfa19f7aa768d58aa6e4edc64986e478a43e4aa',
        'Hm_lpvt_387b8f4fdb89d4ea233922bdc6466394': '1758113649',
    }

    headers1 = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Access-Token': '',
        'App-Id': '4ac490420ac63db4',
        'App-Ver': '',
        'CHOST': 'www.epwk.com',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Device-Os': 'web',
        'Device-Ver': '',
        'Imei': '',
        'NonceStr': noncestr,
        'Os-Ver': '',
        'Pragma': 'no-cache',
        'Referer': 'https://www.epwk.com/login.html',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Signature': signature,
        'Timestemp': str(timestemp),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'X-REQUEST-ID': '489897b3ef1609d178667b2a24cff840',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        # 'Cookie': 'Hm_lvt_387b8f4fdb89d4ea233922bdc6466394=1758113416; HMACCOUNT=F4037280F82AFFB1; HWWAFSESID=fc2508895680434f71; HWWAFSESTIME=1758113414463; time_diff=-2; XDEBUG_SESSION=XDEBUG_ECLIPSE; adbanner_city=%E5%A4%AA%E5%8E%9F%E5%B8%82; login_referer=https%3A%2F%2Fwww.epwk.com%2F; login_fail_need_graphics=1; PHPSESSID=6bfa19f7aa768d58aa6e4edc64986e478a43e4aa; Hm_lpvt_387b8f4fdb89d4ea233922bdc6466394=1758113649',
    }

    print(headers1)

    params = {
        'channel': 'common_channel',
        'base64': '1',
    }

    response = requests.get(url=img_url, params=params, cookies=cookies, headers=headers1)
    print(response.json())


def base64_api(uname, pwd, img, typeid):
    with open(img, 'rb') as f:
        base64_data = base64.b64encode(f.read())
        b64 = base64_data.decode()
    data = {"username": uname, "password": pwd, "typeid": 3, "image": b64}
    result = json.loads(requests.post("http://api.ttshitu.com/predict", json=data).text)
    if result['success']:
        return result["data"]["result"]
    else:
        # ！！！！！！！注意：返回 人工不足等 错误情况 请加逻辑处理防止脚本卡死 继续重新 识别
        return result["message"]
    return ""


def identify_img():
    img_path = "tu.png"
    result = base64_api(uname='15603578082', pwd='Wgh051120', img=img_path, typeid=3)
    print(result)
    return result


def get_login_sign(username, pas, code):
    f = open('get_login_sign.js', 'r', encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    signature = js.call('sign', username, pas, code)['he']['Signature']
    noncestr = js.call('sign', username, pas, code)['he']['NonceStr']
    print(signature, noncestr)

    return {
        'Signature': signature,
        'NonceStr': noncestr
    }


def login_part():
    login_url = 'https://www.epwk.com/api/epwk/v1/user/login'

    username = '15603578082'
    pas = '123456'
    code = identify_img()

    sign_data = get_login_sign(username, pas, code)
    # 获取 Signature 和 NonceStr
    signature = sign_data['Signature']
    noncestr = sign_data['NonceStr']
    tm = str(int(time.time()))

    cookies = {
        'Hm_lvt_387b8f4fdb89d4ea233922bdc6466394': '1758113416',
        'HMACCOUNT': 'F4037280F82AFFB1',
        'HWWAFSESID': 'fc2508895680434f71',
        'HWWAFSESTIME': '1758113414463',
        'time_diff': '-2',
        'XDEBUG_SESSION': 'XDEBUG_ECLIPSE',
        'adbanner_city': '%E5%A4%AA%E5%8E%9F%E5%B8%82',
        'login_referer': 'https%3A%2F%2Fwww.epwk.com%2F',
        'login_fail_need_graphics': '1',
        'PHPSESSID': '6bfa19f7aa768d58aa6e4edc64986e478a43e4aa',
        'Hm_lpvt_387b8f4fdb89d4ea233922bdc6466394': '1758113649',
    }

    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Access-Token': '',
        'App-Id': '4ac490420ac63db4',
        'App-Ver': '',
        'CHOST': 'www.epwk.com',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Device-Os': 'web',
        'Device-Ver': '',
        'Imei': '',
        'NonceStr': str(noncestr),
        'Origin': 'https://www.epwk.com',
        'Os-Ver': '',
        'Pragma': 'no-cache',
        'Referer': 'https://www.epwk.com/login.html',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Signature': str(signature),
        'Timestemp': tm,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'X-REQUEST-ID': '489897b3ef1609d178667b2a24cff840',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        # 'Cookie': 'Hm_lvt_387b8f4fdb89d4ea233922bdc6466394=1758113416; HMACCOUNT=F4037280F82AFFB1; HWWAFSESID=fc2508895680434f71; HWWAFSESTIME=1758113414463; time_diff=-2; XDEBUG_SESSION=XDEBUG_ECLIPSE; adbanner_city=%E5%A4%AA%E5%8E%9F%E5%B8%82; login_referer=https%3A%2F%2Fwww.epwk.com%2F; login_fail_need_graphics=1; PHPSESSID=6bfa19f7aa768d58aa6e4edc64986e478a43e4aa; Hm_lpvt_387b8f4fdb89d4ea233922bdc6466394=1758113649',
    }

    data = {
        'username': '15603578082',
        'password': '123456',
        'code': '7293',
        'hdn_refer': 'https://www.epwk.com/',
    }

    response = requests.post(url=login_url, cookies=cookies, headers=headers, data=data)
    print(response.text)
    print(headers)


def main():
    login_part()
    # get_img_code()
    # identify_img()


if __name__ == '__main__':
    main()
