import requests
import execjs

f = open('headers参数加密.js',mode='r',encoding='utf-8')
js_code = f.read()
f.close()
js = execjs.compile(js_code)


headers = {
    "accept": "application/json, text/plain, */*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "zh-CN,zh;q=0.9",
    "cache-control": "no-cache",
    "cookie": "qcc_did=b3ca4583-fc41-4bb6-9c2e-1a0032219e0a; UM_distinctid=1972659f5bd7b4-029bc8f1af16658-26011e51-fa000-1972659f5be1121; tfstk=gtKxwzjcMbcm3ZtAEKuus9ziWQHoW4vqnIJQj1f05QdJdpPc5ZcV6Ud6aZfbmx7tBQOenNx9QlB6CCkVsxuk3KSNfXcH6Dv23yT4mzhlfA95jOKwrSrv3KSaUtdBLCJ4BCi4uGs61g_5COs1Cs6je86dNo6_cONSe_57c56fG0a53Oz_5CsseL1PCG161ZMJFjb-H_yfHlLnDSij_2rQorxRHZCTj_rTkAXAkT9fw40k2o_AOK18fj9UXQ1OaHGoyLR6lIXy6DhRAeRJXwstDWWvPpI5iMgLyipkgHIXvjEcENCvPn_8Cl9A4E_eWIhYusTDwwW5PRnFEBfW3nT-Q79XtsIfFamIpL_6rn7embZAAeJcmFOIZrfXJOszlHxpNBVh9O4jeYUa7Z6rV2ZIZjZAFAXRtx_b7P7GUTCneYUa7Z6Pe6DbcPzNST5..; QCCSESSID=f3421a71a954f0d3edf6dfbdba; _c_WBKFRo=sih3bEw7JFwq6Iho97IL7EUFUaPzT4ZZVosqCgFj; _nb_ioWEgULi=; CNZZDATA1254842228=1343437863-1748695119-https%253A%252F%252Fwww.baidu.com%252F%7C1755657336",
    # "ed791ad8a70d0a08ec80": "319b758176d2434e670516a2bc533b23960ed3dd6c0493f83bf82484ad4f346294a6a1bcacd3f98baea230bb8c7774b6aff51272f4711d1824dd808540bdb71c",
    "pragma": "no-cache",
    "priority": "u=1, i",
    "referer": "https://www.qcc.com/firm/5dffb644394922f9073544a08f38be9f.html",
    "sec-ch-ua": "\"Not;A=Brand\";v=\"99\", \"Google Chrome\";v=\"139\", \"Chromium\";v=\"139\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    "x-pid": "2536e5b2487d8d14fbe5f7ed1bcd2102",
    "x-requested-with": "XMLHttpRequest"
}

for i in range(1,4):
    params = {
        'isNewAgg': 'true',
        'keyNo': '5dffb644394922f9073544a08f38be9f',
        'nodeName': 'IpoEmployees',
        'pageIndex': i,
    }

    key = js.call('hea',f"/api/datalist/mainmember?isnewagg=true&keyno=5dffb644394922f9073544a08f38be9f&nodename=ipoemployees&pageindex={i}")['key']
    value = js.call('hea',f"/api/datalist/mainmember?isnewagg=true&keyno=5dffb644394922f9073544a08f38be9f&nodename=ipoemployees&pageindex={i}")['value']

    # print(key)
    # print(value)

    headers[key] = value

    # print(headers)

    response = requests.get('https://www.qcc.com/api/datalist/mainmember', params=params, headers=headers)
    print(response.text)