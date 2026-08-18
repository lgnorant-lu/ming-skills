import json
import requests

cookies = {
    'x-zp-client-id': 'b4eb88e1-3951-492f-a2e2-288f9571881c',
    'sajssdk_2015_cross_new_user': '1',
    'sensorsdata2015jssdkcross': '%7B%22distinct_id%22%3A%22197cf379c0ce07-0062bf74a8475b6-26011e51-3686400-197cf379c0deb6%22%2C%22first_id%22%3A%22%22%2C%22props%22%3A%7B%22%24latest_traffic_source_type%22%3A%22%E7%9B%B4%E6%8E%A5%E6%B5%81%E9%87%8F%22%2C%22%24latest_search_keyword%22%3A%22%E6%9C%AA%E5%8F%96%E5%88%B0%E5%80%BC_%E7%9B%B4%E6%8E%A5%E6%89%93%E5%BC%80%22%2C%22%24latest_referrer%22%3A%22%22%7D%2C%22identities%22%3A%22eyIkaWRlbnRpdHlfY29va2llX2lkIjoiMTk3Y2YzNzljMGNlMDctMDA2MmJmNzRhODQ3NWI2LTI2MDExZTUxLTM2ODY0MDAtMTk3Y2YzNzljMGRlYjYifQ%3D%3D%22%2C%22history_login_id%22%3A%7B%22name%22%3A%22%22%2C%22value%22%3A%22%22%7D%2C%22%24device_id%22%3A%22197cf379c0ce07-0062bf74a8475b6-26011e51-3686400-197cf379c0deb6%22%7D',
    'sensorsdata2015jssdkchannel': '%7B%22prop%22%3A%7B%22_sa_channel_landing_url%22%3A%22%22%7D%7D',
    'Hm_lvt_7fa4effa4233f03d11c7e2c710749600': '1751528221',
    'Hm_lpvt_7fa4effa4233f03d11c7e2c710749600': '1751528221',
    'HMACCOUNT': 'F4037280F82AFFB1',
    'locationInfo_search': '{%22code%22:%22583%22%2C%22name%22:%22%E8%BF%90%E5%9F%8E%22%2C%22message%22:%22%E5%8C%B9%E9%85%8D%E5%88%B0%E5%B8%82%E7%BA%A7%E7%BC%96%E7%A0%81%22}',
    'LastCity': '%E8%BF%90%E5%9F%8E',
    'LastCity%5Fid': '583',
    'selectCity_search': '635',
}

headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'cache-control': 'no-cache',
    'content-type': 'application/json;charset=UTF-8',
    'origin': 'https://www.zhaopin.com',
    'pragma': 'no-cache',
    'priority': 'u=1, i',
    'referer': 'https://www.zhaopin.com/',
    'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'x-zp-business-system': '1',
    'x-zp-page-code': '0',
    'x-zp-platform': '13',
    # 'cookie': 'x-zp-client-id=b4eb88e1-3951-492f-a2e2-288f9571881c; sajssdk_2015_cross_new_user=1; sensorsdata2015jssdkcross=%7B%22distinct_id%22%3A%22197cf379c0ce07-0062bf74a8475b6-26011e51-3686400-197cf379c0deb6%22%2C%22first_id%22%3A%22%22%2C%22props%22%3A%7B%22%24latest_traffic_source_type%22%3A%22%E7%9B%B4%E6%8E%A5%E6%B5%81%E9%87%8F%22%2C%22%24latest_search_keyword%22%3A%22%E6%9C%AA%E5%8F%96%E5%88%B0%E5%80%BC_%E7%9B%B4%E6%8E%A5%E6%89%93%E5%BC%80%22%2C%22%24latest_referrer%22%3A%22%22%7D%2C%22identities%22%3A%22eyIkaWRlbnRpdHlfY29va2llX2lkIjoiMTk3Y2YzNzljMGNlMDctMDA2MmJmNzRhODQ3NWI2LTI2MDExZTUxLTM2ODY0MDAtMTk3Y2YzNzljMGRlYjYifQ%3D%3D%22%2C%22history_login_id%22%3A%7B%22name%22%3A%22%22%2C%22value%22%3A%22%22%7D%2C%22%24device_id%22%3A%22197cf379c0ce07-0062bf74a8475b6-26011e51-3686400-197cf379c0deb6%22%7D; sensorsdata2015jssdkchannel=%7B%22prop%22%3A%7B%22_sa_channel_landing_url%22%3A%22%22%7D%7D; Hm_lvt_7fa4effa4233f03d11c7e2c710749600=1751528221; Hm_lpvt_7fa4effa4233f03d11c7e2c710749600=1751528221; HMACCOUNT=F4037280F82AFFB1; locationInfo_search={%22code%22:%22583%22%2C%22name%22:%22%E8%BF%90%E5%9F%8E%22%2C%22message%22:%22%E5%8C%B9%E9%85%8D%E5%88%B0%E5%B8%82%E7%BA%A7%E7%BC%96%E7%A0%81%22}; LastCity=%E8%BF%90%E5%9F%8E; LastCity%5Fid=583; selectCity_search=635',
}

params = {
    'MmEwMD': '5lozQybOsgRG0R_nRbZHyO96yZe.PSZpWqv_zFhnf__LyhSFo2KOnF96oZkMeHzm4GLBDPkTIkK0qkfhWB.Mop7QqQ0XZLncHmkOcTHvt2K0CvFYPN.s44SPqPJjEmaJszUCn95zst.5ILTOpvd0LMaAbSXjLCUzX5B75ds_SXvAyUUJ9zh5ubdZkr8Ydz2vgInCCgoLeUFIT7PF6mj_awT2vE.6LPg6Ej89q5UXvILbVroygMCDMtaN311kiWmBTcOZbrDycP2Fcprd8qnzFYf7Ku_XEwc0MohYWfaTs6IsbGm3.sB19D8abP2BWok48vHSZ9mSOUhausAsXWfM_dey6lv9OTruKhGjAjSbgrc7UJfU2JeRXKDqKPmuTV_O5xwXkZT6DKs8BypTz.Rf7Ja',
    'c1K5tw0w6_': '4WFkBjbAhTCLoPlj9eeRRxS.UF5snDzQo003_BGyD4SOiIRlwkBrUdlHyM5KQ63rsA2js0ZTLh_ogCfqJA3VA5PQrlvIGiWnvk1cWHP8B_Gae9RTr2W.F_bOBmbHzVOmLEemXu5RGRNtHeSBTzK_yl5p2o3LQXwEdO4HTqOfTygwYASjdQ.ogcPSzDB_zukKlF.nKFKp0qZl1jbUvj5tXQZ2k1LlzfRpRPGJ1.lOVrC.GSc5b88mfPzbphTTLe8tQeKgW4LpGTd5bjrPtsayWdKJbrJ9oWV_UDUZnn9Nd_vjbZTOl8MAFhhTUq6JAHbwce8pGqIGJ.bHIVSk53N88EalkuUgeVk0HmSOa.d3upeg',
}

json_data = {
    'S_SOU_WORK_CITY': '635',
    'order': 4,
    'S_SOU_FULL_INDEX': 'java',
    'pageSize': 20,
    'pageIndex': 1,
    'eventScenario': 'pcSearchedSouSearch',
    'anonymous': 1,
}

res = requests.post(
    'https://fe-api.zhaopin.com/c/i/search/positions',
    params=params,
    cookies=cookies,
    headers=headers,
    json=json_data,
)

# print(res.text)

rest = json.loads(res.text)

for lists in  rest['data']['list']:
    title = lists.get('name')
    companyName = lists.get('companyName')
    print(title,companyName)