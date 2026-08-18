import requests
import base64




def get_b64_data():

    cookies = {
        'adbanner_city': '%E5%A4%AA%E5%8E%9F%E5%B8%82',
        'HWWAFSESID': '098667c9f03aee0196',
        'HWWAFSESTIME': '1758170949050',
        'PHPSESSID': '163187754f13c7d8c5e8b7067377719a37a6b3de',
        'time_diff': '0',
        'XDEBUG_SESSION': 'XDEBUG_ECLIPSE',
        'Hm_lvt_387b8f4fdb89d4ea233922bdc6466394': '1758113416,1758170960',
        'Hm_lpvt_387b8f4fdb89d4ea233922bdc6466394': '1758170960',
        'HMACCOUNT': 'F4037280F82AFFB1',
        'login_fail_need_graphics': '1',
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
        'Device-Os': 'web',
        'Device-Ver': '',
        'Imei': '',
        'NonceStr': '1758173858ljzqe',
        'Os-Ver': '',
        'Pragma': 'no-cache',
        'Referer': 'https://www.epwk.com/login.html',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Signature': 'H8TVYVPrrYJAjrgBDOzWTdF1o0sflDTIEeUEQSor1WpZ+iY5EB77N9aTaaus30xf',
        'Timestemp': '1758173858',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'X-REQUEST-ID': '2138e1d95f9d9dd14358b5dbeb3e58de',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        # 'Cookie': 'adbanner_city=%E5%A4%AA%E5%8E%9F%E5%B8%82; HWWAFSESID=098667c9f03aee0196; HWWAFSESTIME=1758170949050; PHPSESSID=163187754f13c7d8c5e8b7067377719a37a6b3de; time_diff=0; XDEBUG_SESSION=XDEBUG_ECLIPSE; Hm_lvt_387b8f4fdb89d4ea233922bdc6466394=1758113416,1758170960; Hm_lpvt_387b8f4fdb89d4ea233922bdc6466394=1758170960; HMACCOUNT=F4037280F82AFFB1; login_fail_need_graphics=1',
    }

    params = {
        'channel': 'common_channel',
        'base64': '1',
    }

    response = requests.get('https://www.epwk.com/api/epwk/v1/captcha/show', params=params, cookies=cookies,
                            headers=headers).json()

    b64_img = response['data']['base64']

    print(b64_img)
    return b64_img


def b64_to_img(b64_img):
    img_data = base64.b64decode(b64_img)
    with open('tu.png','wb') as f:
        f.write(img_data)
    print('验证码生成成功')


def main():
    b64_img = get_b64_data()
    b64_to_img(b64_img)

if __name__ == '__main__':
    main()