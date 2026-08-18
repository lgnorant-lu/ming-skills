# https://www.qcc.com/web/search?key=%E9%98%BF%E9%87%8C%E5%B7%B4%E5%B7%B4


# 参数： t-id   request.key  request.value
#                 加盐sha512


import requests,execjs
from openpyxl import Workbook

wb = Workbook()
sheet = wb.active
sheet.append(['企业名','法定代表人','注册资本','社会信用代码','电话','邮箱','官网','地址'])


def get_key_value(json_data):
    f = open('get_key_val.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)
    key_val = js.call('get_key_val',json_data)
    # print(key_val)
    return key_val


def spider(page,guan_jian_ci):

    url = 'https://www.qcc.com/api/search/searchMulti'

    cookies = {
        'qcc_did': 'b3ca4583-fc41-4bb6-9c2e-1a0032219e0a',
        'tfstk': 'gtKxwzjcMbcm3ZtAEKuus9ziWQHoW4vqnIJQj1f05QdJdpPc5ZcV6Ud6aZfbmx7tBQOenNx9QlB6CCkVsxuk3KSNfXcH6Dv23yT4mzhlfA95jOKwrSrv3KSaUtdBLCJ4BCi4uGs61g_5COs1Cs6je86dNo6_cONSe_57c56fG0a53Oz_5CsseL1PCG161ZMJFjb-H_yfHlLnDSij_2rQorxRHZCTj_rTkAXAkT9fw40k2o_AOK18fj9UXQ1OaHGoyLR6lIXy6DhRAeRJXwstDWWvPpI5iMgLyipkgHIXvjEcENCvPn_8Cl9A4E_eWIhYusTDwwW5PRnFEBfW3nT-Q79XtsIfFamIpL_6rn7embZAAeJcmFOIZrfXJOszlHxpNBVh9O4jeYUa7Z6rV2ZIZjZAFAXRtx_b7P7GUTCneYUa7Z6Pe6DbcPzNST5..',
        '_c_WBKFRo': 'sih3bEw7JFwq6Iho97IL7EUFUaPzT4ZZVosqCgFj',
        'QCCSESSID': '9f8d2439188241825186f045e1',
        'UM_distinctid': '19afc5e786c1da-0829542480038c8-26061b51-384000-19afc5e786d90f',
        'acw_tc': '1a0c384d17651788984632687ecc1e62aa40ff06028e777d9668fe92cce083',
        'CNZZDATA1254842228': '1343437863-1748695119-https%253A%252F%252Fwww.baidu.com%252F%7C1765178932',
    }

    json_data = {
        'searchKey': guan_jian_ci,
        'pageIndex': page,
        'pageSize': 20,
    }

    headers = {
        get_key_value(json_data)[0]: get_key_value(json_data)[1],
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'content-type': 'application/json',
        'origin': 'https://www.qcc.com',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://www.qcc.com/web/search?key=%E8%B5%A4%E5%B3%B0%E8%80%81%E7%99%BE%E5%A7%93%E5%A4%A7%E8%8D%AF%E6%88%BF%E8%BF%9E%E9%94%81%E6%9C%89%E9%99%90%E5%85%AC%E5%8F%B8',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'x-pid': 'e03e42b6d238082dd4b6f2caf056be8a',
        'x-requested-with': 'XMLHttpRequest',
        # 'cookie': 'qcc_did=b3ca4583-fc41-4bb6-9c2e-1a0032219e0a; UM_distinctid=1972659f5bd7b4-029bc8f1af16658-26011e51-fa000-1972659f5be1121; tfstk=gtKxwzjcMbcm3ZtAEKuus9ziWQHoW4vqnIJQj1f05QdJdpPc5ZcV6Ud6aZfbmx7tBQOenNx9QlB6CCkVsxuk3KSNfXcH6Dv23yT4mzhlfA95jOKwrSrv3KSaUtdBLCJ4BCi4uGs61g_5COs1Cs6je86dNo6_cONSe_57c56fG0a53Oz_5CsseL1PCG161ZMJFjb-H_yfHlLnDSij_2rQorxRHZCTj_rTkAXAkT9fw40k2o_AOK18fj9UXQ1OaHGoyLR6lIXy6DhRAeRJXwstDWWvPpI5iMgLyipkgHIXvjEcENCvPn_8Cl9A4E_eWIhYusTDwwW5PRnFEBfW3nT-Q79XtsIfFamIpL_6rn7embZAAeJcmFOIZrfXJOszlHxpNBVh9O4jeYUa7Z6rV2ZIZjZAFAXRtx_b7P7GUTCneYUa7Z6Pe6DbcPzNST5..; _c_WBKFRo=sih3bEw7JFwq6Iho97IL7EUFUaPzT4ZZVosqCgFj; acw_tc=0a47314e17625859872185360e5d83ffd19f573b3a64843c1f9c99e5ad64fd; QCCSESSID=8be9de96054b52f9616c600676; CNZZDATA1254842228=1343437863-1748695119-https%253A%252F%252Fwww.baidu.com%252F%7C1762586365',
    }
    print(headers)

    response = requests.post(url, cookies=cookies, headers=headers,json=json_data).json()
    print(response)
    return response


def analysis_data(response):
    # print(response)
    result = response['Result']
    for a in result:
        try:
            # 企业名
            qym = a['Name'].replace('<em>','').replace('</em>','')
            # 法定代表人
            fddbr = a['OperName']
            # 注册资本
            zczb = a['RegistCapi']
            # 成立时间

            # 社会信用代码
            xydm = a['CreditCode']
            # 电话
            dh = a['ContactNumber']
            # 邮箱
            yx = a['Email']
            # 官网
            gw = a['GW']
            # 地址
            dz = a['Address']
            # print(qym,fddbr,zczb,xydm,dh,yx,gw,dz,sep=' | ')
            print(f'{qym}数据已爬取完成')
            sheet.append([qym,fddbr,zczb,xydm,dh,yx,gw,dz])
        except Exception as e:
            print(f"解析出错: {e}")


def main():
    guan_jian_ci = '赤峰老百姓大药房连锁有限公司'
    for page in range(1,3):
        response = spider(page,guan_jian_ci)
        analysis_data(response)

        try:
            wb.save(f'{guan_jian_ci}.xlsx')
            print(f'第{page}页已保存完成')
        except Exception as e:
            print(f'保存文件时出错{e}')


if __name__ == '__main__':
    main()
