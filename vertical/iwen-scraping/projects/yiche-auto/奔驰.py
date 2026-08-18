# https://car.yiche.com/benchieji/m179777/peizhi/


# 参数 x-sign  md5
import requests,json,time,execjs


def get_sign_tm(serialId,tm):
    f = open('get_sign_tm.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)
    sign = js.call('sign',serialId,tm)
    return sign



def spider():
    tm = int(time.time()*1000)

    # 车型id
    serialId = '1987'

    cookies = {
        'CIGUID': 'bf29494079b79a9bad984eb1b4f7bea8',
        'auto_id': '382a9faf920e31d78a077ba70b0c261e',
        'selectcity': '141000',
        'selectcityid': '2205',
        'selectcityName': '%E4%B8%B4%E6%B1%BE',
        'selectcityPinyin': 'linfen',
        'UserGuid': 'bf29494079b79a9bad984eb1b4f7bea8',
        'isWebP': 'true',
        'locatecity': '141000',
        'CIGDCID': '47sYezmcYhcC5aywpG6diCPxbdZ7rhT2',
        'bitauto_ipregion': '120.207.171.82%3A%E5%B1%B1%E8%A5%BF%E7%9C%81%E4%B8%B4%E6%B1%BE%E5%B8%82%3B2205%2C%E4%B8%B4%E6%B1%BE%E5%B8%82%2Clinfen',
        'Hm_lvt_610fee5a506c80c9e1a46aa9a2de2e44': '1758384305,1758423356',
        'HMACCOUNT': 'F4037280F82AFFB1',
        'csids': '2364',
        'Hm_lpvt_610fee5a506c80c9e1a46aa9a2de2e44': '1758431268',
    }

    headers = {
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'cid': '508',
        'content-type': 'application/json;charset=UTF-8',
        'origin': 'https://car.yiche.com',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://car.yiche.com/benchicji-2364/m179408/peizhi/',
        'reqid': '6479e523d30d0d9cd7f729db8dd81b22',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'x-city-id': '2205',
        'x-ip-address': '120.207.171.82',
        'x-platform': 'pc',
        'x-sign': get_sign_tm(serialId,tm),
        'x-timestamp': str(tm),
        'x-user-guid': 'bf29494079b79a9bad984eb1b4f7bea8',
        # 'cookie': 'CIGUID=bf29494079b79a9bad984eb1b4f7bea8; auto_id=382a9faf920e31d78a077ba70b0c261e; selectcity=141000; selectcityid=2205; selectcityName=%E4%B8%B4%E6%B1%BE; selectcityPinyin=linfen; UserGuid=bf29494079b79a9bad984eb1b4f7bea8; isWebP=true; locatecity=141000; CIGDCID=47sYezmcYhcC5aywpG6diCPxbdZ7rhT2; bitauto_ipregion=120.207.171.82%3A%E5%B1%B1%E8%A5%BF%E7%9C%81%E4%B8%B4%E6%B1%BE%E5%B8%82%3B2205%2C%E4%B8%B4%E6%B1%BE%E5%B8%82%2Clinfen; Hm_lvt_610fee5a506c80c9e1a46aa9a2de2e44=1758384305,1758423356; HMACCOUNT=F4037280F82AFFB1; csids=2364; Hm_lpvt_610fee5a506c80c9e1a46aa9a2de2e44=1758431268',
    }
    print(headers)

    info = {"cityId":"2205","serialId":serialId}
    info = json.dumps(info).replace(' ','')

    params = {
        'cid': '508',
        'param': info,
    }
    print(params)

    response = requests.get(
        'https://mhapi.yiche.com/hcar/h_car/api/v1/param/get_param_details',
        params=params,
        cookies=cookies,
        headers=headers,
    ).text
    print(response)

def main():
    spider()

if __name__ == '__main__':
    main()


# {"cityId":"2205","carIds":"179780","serialId":"1987"}
