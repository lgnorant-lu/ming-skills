# https://www.chanmama.com/promotionRank/tikGoodsSale/?category_id=8


import requests,execjs


def jiexi(ming):
    shop_list = ming['list']
    # print(shop_list)
    for a_shop in shop_list:
        # 商品名称
        shop_name = a_shop['shop_name']
        # 标题
        title = a_shop['title']
        # 佣金比例
        yj = a_shop.get('jx_cos_ratio', 'null')
        if yj == '':
            yj = 'null'
            # 日销量
        rxl = a_shop['day_order_count_text']
        # 销售额
        xse = a_shop['amount_text']
        # 近一年销量
        nxl = a_shop['order_count_text']
        # 30天转化率
        zhl = a_shop['month_conversion_rate_text']
        print(shop_name,title,yj,rxl,xse,nxl,zhl,sep=' | ')


def get_ming(mi):
    f = open('biao_get_ming.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    ming = js.call('get_ming',mi)
    # print(ming)
    return ming


def spider():

    url = 'https://api-service.chanmama.com/v6/home/rank/yesterdaySaleRank'

    cookies = {
        'CMM_U_C_ID': 'c309dfcf-b944-11f0-a412-7217dcd4e192',
        'frontend_canary1': 'none',
        'Hm_lvt_1f19c27e7e3e3255a5c79248a7f4bdf1': '1762236422,1763819214',
        'HMACCOUNT': '08D353962B94E89F',
        'CMM_A_C_ID': 'b501a0fb-c7a9-11f0-83df-664dc89cec30',
        'LOGIN-TOKEN-FORSNS': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhcHBJZCI6MTAwMDAsImFwcFZlcnNpb24iOiIiLCJleHBpcmVfdGltZSI6MTc2NDM1NjQwMCwiaWF0IjoxNzYzODE5Mjk3LCJpZCI6MTUwMjc0NTUsImtpZCI6IkNBUy1GMzJXWEQwSlFPNzQtMTNHMVo5IiwicmsiOiJmR2F2OCJ9.dmrjTvFhYbW6ywN2nikFmlkcsQLPldfSFch_Z0tmyfM',
        'Authorization-By-CAS': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhcHBfaWQiOjEwMDAwLCJleHAiOjE3NjQzNTY0MDAsImlhdCI6MTc2MzgyMTcxOSwicmsiOiJkczRPbSIsInVuaXF1ZV9pZCI6IkNBUy1GMzJXWEQwSlFPNzQtMTNHMVo5In0.Uu3_9Ma8OF26mzokH4AvmXhC2sww0tQ7zrES0xhrXrk',
        'Hm_lpvt_1f19c27e7e3e3255a5c79248a7f4bdf1': '1763821719',
    }

    headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'origin': 'https://www.chanmama.com',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://www.chanmama.com/promotionRank/tikGoodsSale/?category_id=8',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'x-client-hash': '56e71cf043ec56c6a727cc5eb5fdab60beb93e68',
        'x-client-id': '3664157897',
        'x-client-version': '1',
        'x-encrypt-version': '2',
        'x-platform-id': '10000',
    }

    params = {
        'platform': 'jinritemai',
        'date': '2025-11-21',
        'day_type': 'day',
        'big_promotion': '0',
        'page': '1',
        'size': '50',
        'sort': 'volume',
        'category_id': '8',
        'is_new_product': '0',
        'is_price_40_plus': '0',
        'has_jx_commission': '0',
        'price': '',
        'cal_day30_volume_trend': '1',
        'cal_price_rate': '1',
        'this_month': '0',
    }

    response = requests.get(url,params=params,cookies=cookies,headers=headers,).json()
    mi = response['data']['data']
    # print(mi)
    return mi


def main():
    mi = spider()
    ming = get_ming(mi)
    jiexi(ming)

if __name__ == '__main__':
    main()