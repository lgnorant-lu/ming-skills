import json
from lxml import etree
import requests
import re
import pandas as pd


cookies = {
    'UBT_VID': '1739016193115.1e81spSBmcOH',
    'GUID': '09031133216049249678',
    'MKT_CKID': '1739016193592.e04oj.ivp7',
    '_RSG': 'Dq430kpIcyB03Pej6sBal9',
    '_RDG': '28d066feee74c927280b98cfd6b4465ee7',
    '_RGUID': 'bf264b3b-800c-4d0d-9be4-2f61ada190c0',
    'nfes_isSupportWebP': '1',
    'ibulanguage': 'CN',
    'ibulocale': 'zh_cn',
    'cookiePricesDisplayed': 'CNY',
    '_abtest_userid': 'e5774eeb-0fe0-4b55-b1cc-cc9a3c6e05f0',
    '_gcl_au': '1.1.2072623806.1746544620',
    'nfes_isSupportWebP': '1',
    '_ga': 'GA1.1.22635546.1739016194',
    '_bfaStatusPVSend': '1',
    '_bfaStatus': 'send',
    '_ubtstatus': '%7B%22vid%22%3A%221739016193115.1e81spSBmcOH%22%2C%22sid%22%3A10%2C%22pvid%22%3A8%2C%22pid%22%3A290601%7D',
    '_RF1': '60.222.15.56',
    'MKT_Pagesource': 'PC',
    'cticket': '0A96DDDF35192EA23A749A6D845E5577DD7071BBA239FA4E25558BA817817546',
    'login_type': '0',
    'login_uid': 'A7E286E3BD44214839DA9AFA29287948',
    'DUID': 'u=17ACEC716FDFDE9F3E386E087E34B96D&v=0',
    'IsNonUser': 'F',
    'AHeadUserInfo': 'VipGrade=0&VipGradeName=%C6%D5%CD%A8%BB%E1%D4%B1&UserName=&NoReadMessageCount=0',
    '_udl': '708D70C2B179E2F91CC5ED1C2CCE362D',
    'Hm_lvt_a8d6737197d542432f4ff4abc6e06384': '1751701061,1752839113,1752908736,1752979785',
    'Hm_lpvt_a8d6737197d542432f4ff4abc6e06384': '1752979785',
    'HMACCOUNT': 'F4037280F82AFFB1',
    'Session': 'smartlinkcode=U130026&smartlinklanguage=zh&SmartLinkKeyWord=&SmartLinkQuary=&SmartLinkHost=',
    'Union': 'AllianceID=4897&SID=130026&OUID=&createtime=1752979785&Expires=1753584584894',
    '_ga_5DVRDQD429': 'GS2.1.s1752979785$o16$g0$t1752979788$j57$l0$h0',
    '_ga_B77BES1Z8Z': 'GS2.1.s1752979785$o16$g0$t1752979788$j57$l0$h0',
    '_ga_9BZF483VNQ': 'GS2.1.s1752979785$o15$g0$t1752979788$j57$l0$h0',
    'librauuid': '',
    'intl_ht1': 'h4=1232_99984168,1232_3183489,1232_1210039,340_2022614,370_121179136,1105_114768734',
    '_bfa': '1.1739016193115.1e81spSBmcOH.1.1752979817533.1752980092902.21.4.102003',
    '_jzqco': '%7C%7C%7C%7C1752930600355%7C1.1777369495.1739016193598.1752979817784.1752980093252.1752979817784.1752980093252.undefined.0.0.95.95',
}

headers = {
    'accept': 'application/json',
    'accept-language': 'zh-CN,zh;q=0.9',
    'cache-control': 'no-cache',
    'content-type': 'application/json;charset=UTF-8',
    'origin': 'https://hotels.ctrip.com',
    'p': '85896143134',
    'phantom-token': '1004-common-cthinDRc6vGpybsj17IX1Y81i4XJQcEbTW5OjbfyLMyctR0nEsmJzLEZDwtzjhlROSWa5WD1Y6bvNOEl9YDli01YSMYG7wM1JzZyMQwGoWBXJdGE7FI0Y4Jo0RF7KX6R3Ay89Jb5YP7vBPjbMWonYSgYpfR48Y8SWc8Eq4rfseGfxcY5hKsoy90rkmKl4jhfjsDE9by7EHni40Y0ET4Ym8yAEOqYX8ygOKZfiPhjo1j6qWfZy6dIqXw0NjOawkheBhEnPIgFwqAiX0RqESPYlTy8zK7GimMjohjGNWBXySEo5Yt7yl4WXbePgyS9jHEfAiD5yNdwBoi58vm5Ybcj7MwqpID5xTOydEBOi56J48RhE09YOmw5hwSceHDjZGIhEQaiFHJ8hRFsYbtiFQYcELmYBmwfbEnsw3bihSxoOegSY8dwgfjNtx6fy4Eqzi0HJ7zWAE8qYtfwOBwdbKM6jXLw4HrA5epMYQEOtiNTJLGYkbWDOYGXJtEA6Yfoy1sWLsyQEThYZGyAHYq1WmElAYBgwBzw75Kmtjs9w8Ar7SisNvF1jlEPAiQFJgBYG8WkfYqQJ0EakYhbyXmWLQyMEfdYZ5y3mYacRbEcsYzLwBzi47EfPjHteMzifFYhfxO8y7EDBip3JQ1RLlYPaiBlYkEBbYTUw6ai5XEocjpMe50ilqYftwA5I48Efhj6EGBiZSJm3EO6ekqjZSI6EFmY3FwkayhTensw4zjTSwc7jSaJU6jg0EhUw7Fw9SKnEq4i5qJ6gWQEd7YndwnayMFe1QysDEhLWD7EPnI5EGDiTPJbE1nYaHJ97wLpw9ETcYXNJkgiBZycEPGYgdJPqYZ6wLEDTYm8J0AwaXvmEQPY6sJSLvM4jDEAZY9gJlLiD3i5E6hY84JtLYNTE5EqOY9TJQLYABWnEfGYGLJt0w7hw6EUoYo8JdbinGY4EFpYM1JsqikQimEg0YTnJ70w0HJpbWlOefDKcYhwbOeASwq0R17ydlikhv1HW57R49whfRb7v74iDbRz5RfLJXbI9dRkgjtHjQARkNyAoEcFJDdiamRgTwqoRBDvbhyPajqFRHYtTYfUY84Ks4yfUw5pjqdwPQRpMyZgyaTJShetFwhnJHGRZPJzleBlEMny67J3ZEDbekgj8MWP9y8Tyz8eXmYF9yBPE4awFTj8hvO5E0Oy9qEnAvAfvfqiAsW8hvzti9YtdvDmWmUwhGwqDvzlYf9wp0izfJUpYUSw5lepkyMUR4YfQiALihZwkBYMGEa9YtUYLnvQY35WckIaZvB3vAHeUHYXQiqfYXaJHTiqAYXYm6RNoET8vLSeh3Ez9jTSWbkWlsvNJqYGqioNRbAih6rz7KFBednEBNWUSea0YQ9r5YAQr17xhsyMoYNfJo7w3AW8heOHRDSEgBEPnWhcjldrQSK4Y0AKcFYzbE9TYmNJl5w64W8SeocRqZigXvtsYhDWtGKP5idYX9WAlKhUyk1J5QWLqWg5EoGEdSiaYs9RUBEZ4IqpY3OiAhwbpR8DEUTW6fvzdvbORZYZzW6sWO9YoBJfNjFQY6lJoYNXrstInJDpjH4wPnvmHjcoEs1eSkYzYzcwdkrP6vcAYcAyG7rdDwMYsEmUvTpefTjzNwHnvFTjoqJFswOowcYsZwgSRBOikSJX8W5zE9DIghjOYdXraQY4UJzHjpOiZqiacx3kWLmjqr76x7cYPZw09IQrQyFGxOtY0mjHXjPZWXjP8wGlISTWPYOXxZSEUzES5R1dWzMYF4WaNWMPYfLiDDxhM',
    'pragma': 'no-cache',
    'priority': 'u=1, i',
    'referer': 'https://hotels.ctrip.com/',
    'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    # 'cookie': 'UBT_VID=1739016193115.1e81spSBmcOH; GUID=09031133216049249678; MKT_CKID=1739016193592.e04oj.ivp7; _RSG=Dq430kpIcyB03Pej6sBal9; _RDG=28d066feee74c927280b98cfd6b4465ee7; _RGUID=bf264b3b-800c-4d0d-9be4-2f61ada190c0; nfes_isSupportWebP=1; ibulanguage=CN; ibulocale=zh_cn; cookiePricesDisplayed=CNY; _abtest_userid=e5774eeb-0fe0-4b55-b1cc-cc9a3c6e05f0; _gcl_au=1.1.2072623806.1746544620; nfes_isSupportWebP=1; _ga=GA1.1.22635546.1739016194; _bfaStatusPVSend=1; _bfaStatus=send; _ubtstatus=%7B%22vid%22%3A%221739016193115.1e81spSBmcOH%22%2C%22sid%22%3A10%2C%22pvid%22%3A8%2C%22pid%22%3A290601%7D; _RF1=60.222.15.56; MKT_Pagesource=PC; cticket=0A96DDDF35192EA23A749A6D845E5577DD7071BBA239FA4E25558BA817817546; login_type=0; login_uid=A7E286E3BD44214839DA9AFA29287948; DUID=u=17ACEC716FDFDE9F3E386E087E34B96D&v=0; IsNonUser=F; AHeadUserInfo=VipGrade=0&VipGradeName=%C6%D5%CD%A8%BB%E1%D4%B1&UserName=&NoReadMessageCount=0; _udl=708D70C2B179E2F91CC5ED1C2CCE362D; Hm_lvt_a8d6737197d542432f4ff4abc6e06384=1751701061,1752839113,1752908736,1752979785; Hm_lpvt_a8d6737197d542432f4ff4abc6e06384=1752979785; HMACCOUNT=F4037280F82AFFB1; Session=smartlinkcode=U130026&smartlinklanguage=zh&SmartLinkKeyWord=&SmartLinkQuary=&SmartLinkHost=; Union=AllianceID=4897&SID=130026&OUID=&createtime=1752979785&Expires=1753584584894; _ga_5DVRDQD429=GS2.1.s1752979785$o16$g0$t1752979788$j57$l0$h0; _ga_B77BES1Z8Z=GS2.1.s1752979785$o16$g0$t1752979788$j57$l0$h0; _ga_9BZF483VNQ=GS2.1.s1752979785$o15$g0$t1752979788$j57$l0$h0; librauuid=; intl_ht1=h4=1232_99984168,1232_3183489,1232_1210039,340_2022614,370_121179136,1105_114768734; _bfa=1.1739016193115.1e81spSBmcOH.1.1752979817533.1752980092902.21.4.102003; _jzqco=%7C%7C%7C%7C1752930600355%7C1.1777369495.1739016193598.1752979817784.1752980093252.1752979817784.1752980093252.undefined.0.0.95.95',
}

data_list = []
chengshi = '濮阳'

for i in range(1,50):

    json_data = {
        'hotelIdFilter': {
            'hotelAldyShown': [
                '99984168',
                '75464504',
                '1718913',
                '100419457',
                '28301818',
                '114940155',
                '125823893',
                '1706996',
                '128206566',
                '96106730',
                '95081577',
                '113019796',
                '100314067',
            ],
        },
        'destination': {
            'type': 1,
            'geo': {
                'cityId': 1232,
                'countryId': 1,
            },
            'keyword': {
                'word': '',
            },
        },
        'date': {
            'dateType': 1,
            'dateInfo': {
                'checkInDate': '20250720',
                'checkOutDate': '20250721',
            },
        },
        'filters': [
            {
                'filterId': '17|1',
                'type': '17',
                'subType': '2',
                'value': '1',
            },
            {
                'filterId': '29|1',
                'type': '29',
                'value': '1|1',
                'subType': '2',
            },
        ],
        'extraFilter': {
            'childInfoItems': [],
            'sessionId': '7765b5d6b29a4f33b595128167896963',
        },
        'paging': {
            'pageCode': '102002',
            'pageIndex': 7,
            'pageSize': 20,
        },
        'roomQuantity': 1,
        'recommend': {
            'nearbyHotHotel': {},
        },
        'genk': True,
        'residenceCode': 'CN',
        'head': {
            'platform': 'PC',
            'cid': '09031133216049249678',
            'cver': 'hotels',
            'bu': 'HBU',
            'group': 'ctrip',
            'aid': '4897',
            'sid': '130026',
            'ouid': '',
            'locale': 'zh-CN',
            'timezone': '8',
            'currency': 'CNY',
            'pageId': '102002',
            'vid': '1739016193115.1e81spSBmcOH',
            'guid': '09031133216049249678',
            'isSSR': False,
        },
        'ServerData': '',
    }

    response = requests.post(
        'https://m.ctrip.com/restapi/soa2/31454/json/fetchHotelList',
        cookies=cookies,
        headers=headers,
        json=json_data,
    )

    xiang_headers = {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "zh-CN,zh;q=0.9",
        "cache-control": "no-cache",
        "cookie": "UBT_VID=1739016193115.1e81spSBmcOH; GUID=09031133216049249678; MKT_CKID=1739016193592.e04oj.ivp7; _RSG=Dq430kpIcyB03Pej6sBal9; _RDG=28d066feee74c927280b98cfd6b4465ee7; _RGUID=bf264b3b-800c-4d0d-9be4-2f61ada190c0; nfes_isSupportWebP=1; IBU_TRANCE_LOG_P=85896143134; ibulanguage=CN; ibulocale=zh_cn; cookiePricesDisplayed=CNY; _abtest_userid=e5774eeb-0fe0-4b55-b1cc-cc9a3c6e05f0; _gcl_au=1.1.2072623806.1746544620; _ga=GA1.1.22635546.1739016194; _bfaStatusPVSend=1; _bfaStatus=send; _ubtstatus=%7B%22vid%22%3A%221739016193115.1e81spSBmcOH%22%2C%22sid%22%3A10%2C%22pvid%22%3A8%2C%22pid%22%3A290601%7D; _RF1=60.222.15.56; MKT_Pagesource=PC; Hm_lvt_a8d6737197d542432f4ff4abc6e06384=1751644828,1751701061,1752839113,1752908736; HMACCOUNT=F4037280F82AFFB1; manualclose=1; cticket=0A96DDDF35192EA23A749A6D845E5577DD7071BBA239FA4E25558BA817817546; login_type=0; login_uid=A7E286E3BD44214839DA9AFA29287948; DUID=u=17ACEC716FDFDE9F3E386E087E34B96D&v=0; IsNonUser=F; AHeadUserInfo=VipGrade=0&VipGradeName=%C6%D5%CD%A8%BB%E1%D4%B1&UserName=&NoReadMessageCount=0; _udl=708D70C2B179E2F91CC5ED1C2CCE362D; _ga_5DVRDQD429=GS2.1.s1752908752$o15$g1$t1752908902$j22$l0$h0; _ga_B77BES1Z8Z=GS2.1.s1752908752$o15$g1$t1752908902$j22$l0$h0; _ga_9BZF483VNQ=GS2.1.s1752908753$o14$g1$t1752908902$j22$l0$h0; Hm_lvt_4a51227696a44e11b0c61f6105dc4ee4=1751645316,1751701065,1752839135,1752908903; librauuid=; Hm_lpvt_a8d6737197d542432f4ff4abc6e06384=1752930702; Session=smartlinkcode=U130026&smartlinklanguage=zh&SmartLinkKeyWord=&SmartLinkQuary=&SmartLinkHost=; Union=AllianceID=4897&SID=130026&OUID=&createtime=1752930703&Expires=1753535502666; intl_ht1=h4=1232_99984168,1232_3183489,1232_1210039,340_2022614,370_121179136,1105_114768734; hotel=99984168; hotelhst=1164390341; Hm_lpvt_4a51227696a44e11b0c61f6105dc4ee4=1752934131; _bfa=1.1739016193115.1e81spSBmcOH.1.1752934119947.1752934131882.20.2.102003; _jzqco=%7C%7C%7C%7C1752930600355%7C1.1777369495.1739016193598.1752934120455.1752934132356.1752934120455.1752934132356.undefined.0.0.89.89",
        "pragma": "no-cache",
        "priority": "u=0, i",
        "referer": "https://hotels.ctrip.com/hotels/list?countryId=1&city=1232&provinceId=0&checkin=2025/07/19&checkout=2025/07/20&optionId=1232&optionType=City&directSearch=0&display=%E6%BF%AE%E9%98%B3%2C%20%E6%B2%B3%E5%8D%97%2C%20%E4%B8%AD%E5%9B%BD&crn=1&adult=1&children=0&searchBoxArg=t&travelPurpose=0&ctm_ref=ix_sb_dl&domestic=1&",
        "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
    }

    data = response.text

    # print(data)

    datas = json.loads(data)

    for hotel in datas['data']['hotelList']:

        try:
            name = hotel['hotelInfo']['nameInfo']['name']
            id = hotel['hotelInfo']['summary']['hotelId']

            xiang_url = f'https://hotels.ctrip.com/hotels/detail/?cityId=1232&checkIn=2025-07-19&checkOut=2025-07-20&hotelId={id}&adult=1&crn=1&children=0&highprice=-1&lowprice=0&listfilter=1'
            xiang_response = requests.get(url=xiang_url,headers=xiang_headers)
            print(xiang_response.text)
            # xiang_resp = etree.HTML(xiang_response.text)

            data_str = str(xiang_response.text)  # 将数据转换为字符串

            # 提取电话号码的正则
            phone_pattern = r"(\+\d{2,3}-\d{3,4}-\d{6,7})"
            phone_match = re.search(phone_pattern, data_str)
            phone_number = phone_match.group(1) if phone_match else None
            if phone_match is None:
                match = re.search(r'\"telephone\":\s*\[\s*\"(\+86-1\d{10})\"', data_str)

                if match:
                    phone_number = match.group(1)
                    print(phone_number)  # 输出: +86-16650570008
                else:
                    print("未找到电话号码")

            # 提取客房数的正则
            room_pattern = r"客房数：(\d+)"
            room_match = re.search(room_pattern, data_str)
            room_count = room_match.group(1) if room_match else None

            print(f'酒店名',{name},'电话号码:',{phone_number},'客房数量:',{room_count})
            break

            # data_list.append({
            #     '城市': chengshi,
            #     '酒店名称': name,
            #     '客房数': room_count,
            #     '电话': phone_number
            # })

            # if data_list:
            #     df = pd.DataFrame(data_list)
            #     df.to_excel('酒店2.xlsx', index=False)
            #     print(f"成功保存{len(data_list)}条数据到酒店2.xlsx")
            # else:
            #     print("未获取到有效数据")


        except Exception as e:
            print(f"程序运行出错: {str(e)}")

            # break