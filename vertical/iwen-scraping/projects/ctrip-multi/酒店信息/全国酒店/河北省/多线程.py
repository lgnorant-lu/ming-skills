import json
import re
import threading
import pandas as pd
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

# 全局数据结构
data_list = []
lock = threading.Lock()  # 线程安全锁
processed_hotel_ids = set()  # 已处理的酒店ID集合，用于去重


def fetch_hotel_list(i):
    """获取单页酒店列表数据"""


# page_index

    json_data = {
        'date': {
            'dateType': 1,
            'dateInfo': {
                'checkInDate': '20251125',
                'checkOutDate': '20251126',
            },
        },
        'destination': {
            'type': 1,
            'geo': {
                'cityId': 1,
                'countryId': 1,
            },
            'keyword': {
                'word': '',
            },
        },
        'extraFilter': {
            'childInfoItems': [],
            'ctripMainLandBDCoordinate': True,
            'sessionId': '563634abf88a41579cc01db8f077a094',
            'extendableParams': {
                'tripWalkDriveSwitch': 'T',
                'isUgcSentenceB': '',
            },
        },
        'filters': [
            {
                'type': '17',
                'title': '欢迎度排序',
                'value': '1',
                'filterId': '17|1',
            },
            {
                'type': '80',
                'title': '',
                'value': '2',
                'filterId': '80|2',
            },
            {
                'filterId': '29|1',
                'type': '29',
                'value': '1|1',
            },
        ],
        'roomQuantity': 1,
        'marketInfo': {},
        'paging': {
            'pageIndex': i,
            'pageSize': 10,
            'pageCode': '10650171192',
        },
        'hotelIdFilter': {
            'hotelAldyShown': [
                '393315',
                '80920781',
                '429531',
                '429158',
                '1286148',
                '1013461',
                '427807',
                '374781',
                '608516',
                '427952',
                '72673691',
                '387040',
            ],
        },
        'head': {
            'platform': 'PC',
            'cver': '0',
            'cid': '1739016193115.1e81spSBmcOH',
            'bu': 'HBU',
            'group': 'ctrip',
            'aid': '4897',
            'sid': '130026',
            'ouid': '',
            'locale': 'zh-CN',
            'timezone': '8',
            'currency': 'CNY',
            'pageId': '10650171192',
            'vid': '1739016193115.1e81spSBmcOH',
            'guid': '',
            'isSSR': False,
            'extension': [
                {
                    'name': 'cityId',
                    'value': '',
                },
                {
                    'name': 'checkIn',
                    'value': '2025-11-25',
                },
                {
                    'name': 'checkOut',
                    'value': '2025-11-26',
                },
                {
                    'name': 'region',
                    'value': 'CN',
                },
            ],
        },
    }


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
        'intl_ht1': 'h4=1048_1798254,1048_5377542,1047_28112330,1048_112008385,21890_83267478,1565_43581436',
        'Hm_lvt_a8d6737197d542432f4ff4abc6e06384': '1752979785,1752998368,1753076298,1753152338',
        'Hm_lpvt_a8d6737197d542432f4ff4abc6e06384': '1753152338',
        'HMACCOUNT': 'F4037280F82AFFB1',
        'Session': 'smartlinkcode=U130026&smartlinklanguage=zh&SmartLinkKeyWord=&SmartLinkQuary=&SmartLinkHost=',
        'Union': 'AllianceID=4897&SID=130026&OUID=&createtime=1753152339&Expires=1753757139251',
        '_ga_9BZF483VNQ': 'GS2.1.s1753152339$o18$g0$t1753152397$j2$l0$h0',
        '_ga_5DVRDQD429': 'GS2.1.s1753152339$o19$g0$t1753152397$j2$l0$h0',
        '_ga_B77BES1Z8Z': 'GS2.1.s1753152339$o19$g0$t1753152397$j2$l0$h0',
        'librauuid': '',
        '_jzqco': '%7C%7C%7C%7C1753076300186%7C1.1777369495.1739016193598.1753154073162.1753154209861.1753154073162.1753154209861.undefined.0.0.250.250',
        '_bfa': '1.1739016193115.1e81spSBmcOH.1.1753154209440.1753154382708.27.11.102002',
    }

    headers = {
        'accept': 'application/json',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'content-type': 'application/json;charset=UTF-8',
        'origin': 'https://hotels.ctrip.com',
        'p': '85896143134',
        'phantom-token': '1004-common-BMBeptJfqyTDxP1EflylXwMmRN6v6XwktjqPR8SYdXY5oiaHw0cYXBWDgy4SyOZRQ7vXLvZqE9zi0oj3XWnGy1mitOi5QWosEa3Jl9yo9j8ki6kW6J9YMNeStiPvqoROAyDhJ9QidZWc8yX6wsDEB9WmQYDsikzvfmiZ3rq9rpDyAYHSjdgRpTWDXKUBjsMjUME1heoEHFia1YDEloY0zyPEFgYQcyctKUkiBfjf0jLzWSlyUcIqZwcbjXnwZXescE4NIA0wLtioNRlESsYgsyM5KHFiQOj3DjOXW3zyXEGmYbPyspWGleHQygdjmEaoibPyBow7Gif1v3gYHsjqhwZLIMmxk6yPE8pi6PJlQRaET4YgQw9Fwl7epajzAIdE4nizHJt1EgDwbMjBE57YHFwdoE3pwl3igbxODeLcY53w65jH3xkZy4EzGibAJMAWLE8dYpgwoMwboKpSj73w8qrqaeXDY6EcDi1SJkoYpAWZ6YHLJ4EOPY49y9gWpsy6Ek5YznyP4YdDRFEb1YzZwsMwHkKfajlUwzGrSni1UvZ3jsE4hi83JmaY6HWAlYL4J8Ea5Y7Fy0kWz3ybEM0YPGy1TYABYmEzDYd5wT8iNTEPajkLeaMiHzYhNxFGyoEUTikGJtlEXhwoZjAENLYQDwd5ia5E8MjaleGSiHoYPSwBtIpSEBfjDEAki8QJ1fE3oenTjMbIzEadYsFw3UyPQe4fwbOjk4wXkjTpJl5jkgEtnwd9wQFKlEBdih0J6QWqEDLYPSwghyb9enhy3bEstWTPED8IaEfSiaAJhEFHYsXJUXw4kJcEmnYdGJ6qv4nE0EMQYB3JasvU6WzEoOY5zJLqwbDJ6EpSYT5JG0iqsRhETLYL5JoziN9R5EdLY8BJzUYbTEnEgHYnpJmsYFGWzEfNYD9JG4w0ZwnEfLYaSJZci9gYUEtGYfTJcQib3i0E7mY6OJZAw3kJzEacYkDJGcjQhy3zJ03ioYpoy6dRPNKPgRG9y0SilNv3OWzTR6GwPqR1dvh5isfRPGRz1JFDIldR7njsmjncR69y8LEFpJOqi68Rp5wSURdFvmcrpNI4DE0YzdvHljsFWhQjMOwBdj5bwOdi6XYDAJH3RUdeaQR6Pjs9EQ6jToeOBEH9w6zRPpwUHesAJHFWzTvqPJMUeQZwPpy4lilnW0kwQSRoOjbdEpkw80vSHyfMjGUyhkyLZe4Yp0yUw4TySgw0cvq7YdOw5BidTJDoYHowtgjg3WX1I0YOqr5AvbbK4fYqQEogRU9EnFxzYHUYscr0tYlQva7epMYgLiQ5Ynay97ezlwGYMHKkdwL5YPhehMEAgjc4WtOYoLj9HwUYl5W8HjSarbZrlZKpQefHEQmW9dYAFy0TEGYDOjPFyZ1wtqYzcJTHwAdWsTeh8RgDELZETnWdAwp7J6neGYX9EPLRXHwLlYXBJtPwzhWqteBnRhAi6mvdLYpMvPcRASWdYA0yA0Is6YD5JXQWF9W5PrghvZmY4Y4LrTzjScIN7Yh8ip5wHmRPzEAlWFJayUXEzYZhW0E1OWbkJa7I4nv3E0Y64xmhKNGYnajb9wUXv15j1UKOQwpkrNYZoIc1j10yXoYMtI9ylZEpYUGJg9eNoJlajPXw7lvUBjqGrgyPkjaYcJ3OjhsWhcJfSWQkrdpEzytYGlK71xGAvlQj4Li94ioLx7LWQSj9rDSxPmYkTwUoIGrTyQ1xqtYdHj71jnOWqjPGIohW9PrgYG3IB9i5nK9ZROcWstY7NWTQW65Y4Qi1XYUA',
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
        # 'cookie': 'UBT_VID=1739016193115.1e81spSBmcOH; GUID=09031133216049249678; MKT_CKID=1739016193592.e04oj.ivp7; _RSG=Dq430kpIcyB03Pej6sBal9; _RDG=28d066feee74c927280b98cfd6b4465ee7; _RGUID=bf264b3b-800c-4d0d-9be4-2f61ada190c0; nfes_isSupportWebP=1; ibulanguage=CN; ibulocale=zh_cn; cookiePricesDisplayed=CNY; _abtest_userid=e5774eeb-0fe0-4b55-b1cc-cc9a3c6e05f0; _gcl_au=1.1.2072623806.1746544620; nfes_isSupportWebP=1; _ga=GA1.1.22635546.1739016194; _bfaStatusPVSend=1; _bfaStatus=send; _ubtstatus=%7B%22vid%22%3A%221739016193115.1e81spSBmcOH%22%2C%22sid%22%3A10%2C%22pvid%22%3A8%2C%22pid%22%3A290601%7D; _RF1=60.222.15.56; MKT_Pagesource=PC; cticket=0A96DDDF35192EA23A749A6D845E5577DD7071BBA239FA4E25558BA817817546; login_type=0; login_uid=A7E286E3BD44214839DA9AFA29287948; DUID=u=17ACEC716FDFDE9F3E386E087E34B96D&v=0; IsNonUser=F; AHeadUserInfo=VipGrade=0&VipGradeName=%C6%D5%CD%A8%BB%E1%D4%B1&UserName=&NoReadMessageCount=0; _udl=708D70C2B179E2F91CC5ED1C2CCE362D; intl_ht1=h4=428_117639175,1991_1596297,1232_6632989,1232_107169939,1232_4840320,1232_28111423; Hm_lvt_a8d6737197d542432f4ff4abc6e06384=1752908736,1752979785,1752998368,1753076298; Hm_lpvt_a8d6737197d542432f4ff4abc6e06384=1753076298; HMACCOUNT=F4037280F82AFFB1; Session=smartlinkcode=U130026&smartlinklanguage=zh&SmartLinkKeyWord=&SmartLinkQuary=&SmartLinkHost=; Union=AllianceID=4897&SID=130026&OUID=&createtime=1753076300&Expires=1753681099975; _ga_5DVRDQD429=GS2.1.s1753076299$o18$g1$t1753076380$j60$l0$h0; _ga_B77BES1Z8Z=GS2.1.s1753076299$o18$g1$t1753076380$j60$l0$h0; _ga_9BZF483VNQ=GS2.1.s1753076299$o17$g1$t1753076380$j60$l0$h0; _bfa=1.1739016193115.1e81spSBmcOH.1.1753076298899.1753076382217.24.2.102002; librauuid=; _jzqco=%7C%7C%7C%7C1753076300186%7C1.1777369495.1739016193598.1753076299999.1753076382502.1753076299999.1753076382502.undefined.0.0.150.150',
    }

    try:
        response = requests.post(
            'https://m.ctrip.com/restapi/soa2/31454/json/fetchHotelList',
            cookies=cookies,
            headers=headers,
            json=json_data,
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"第{i}页请求失败: {str(e)}")
        return None


def process_hotel(hotel, shengji, chengshi):
    """处理单个酒店详情"""
    try:
        name = hotel['hotelInfo']['nameInfo']['name']
        hotel_id = hotel['hotelInfo']['summary']['hotelId']

        # 检查是否已处理过该酒店
        with lock:
            if hotel_id in processed_hotel_ids:
                print(f"跳过已处理酒店: {name} (ID: {hotel_id})")
                return
            processed_hotel_ids.add(hotel_id)

        # 获取酒店详情页
        xiang_url = f'https://hotels.ctrip.com/hotels/detail/?cityId=1232&checkIn=2025-07-19&checkOut=2025-07-20&hotelId={hotel_id}&adult=1&crn=1&children=0&highprice=-1&lowprice=0&listfilter=1'

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

        xiang_response = requests.get(url=xiang_url, headers=xiang_headers, timeout=30)
        xiang_response.raise_for_status()

        # 解析数据
        data_str = str(xiang_response.text)

        # 客房数提取
        room_pattern = r"客房数：(\d+)"
        room_match = re.search(room_pattern, data_str)
        room_count = room_match.group(1) if room_match else "N/A"

        # 电话号码提取
        phone_number = None
        phone_pattern = r"(\+\d{2,3}-\d{2,4}-\d{6,11}(?:-\d{1,10})?)"
        phone_match = re.search(phone_pattern, data_str)

        if phone_match:
            phone_number = phone_match.group(1)
        else:
            alt_match = re.search(r'\"telephone\":\s*\[\s*\"(\+86-1\d{10})\"', data_str)
            if alt_match:
                phone_number = alt_match.group(1)

        # 如果找到有效电话则保存
        if phone_number:
            hotel_data = {
                '省': shengji,
                '地区': chengshi,
                '酒店': name,
                '客房数': room_count,
                '电话': phone_number
            }

            # 线程安全的数据写入
            with lock:
                data_list.append(hotel_data)
                df = pd.DataFrame(data_list)
                df.to_excel('酒店111.xlsx', index=False)

            print(f"成功保存: {name} | 电话: {phone_number} | 客房: {room_count}")
        else:
            print(f"跳过无电话酒店: {name}")

    except Exception as e:
        print(f"酒店处理出错: {str(e)}")


def process_page(page_index, shengji, chengshi, inner_executor):
    """处理单页数据"""
    try:
        print(f"开始处理第{page_index}页...")
        data = fetch_hotel_list(page_index)
        if not data or 'data' not in data or 'hotelList' not in data['data']:
            print(f"第{page_index}页无有效数据")
            return

        # 提交酒店详情任务到内层线程池
        futures = []
        for hotel in data['data']['hotelList']:
            futures.append(inner_executor.submit(process_hotel, hotel, shengji, chengshi))

        # 等待当前页所有酒店处理完成
        for future in as_completed(futures):
            future.result()

        print(f"第{page_index}页处理完成")
    except Exception as e:
        print(f"第{page_index}页处理异常: {str(e)}")


def main():
    shengji = ''
    chengshi = '北京'

    # 创建双层级线程池
    outer_executor = ThreadPoolExecutor(max_workers=5)  # 外层处理分页
    inner_executor = ThreadPoolExecutor(max_workers=10)  # 内层处理酒店详情

    # 提交分页任务
    futures = []
    for page_index in range(1, 1000):
        futures.append(outer_executor.submit(
            process_page, page_index, shengji, chengshi, inner_executor
        ))

    # 等待所有分页任务完成
    for future in as_completed(futures):
        future.result()

    # 关闭线程池
    outer_executor.shutdown()
    inner_executor.shutdown()
    print("所有任务处理完成")


if __name__ == "__main__":
    main()