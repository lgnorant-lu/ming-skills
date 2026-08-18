# https://kyfw.12306.cn/otn/leftTicket/init




import requests,execjs



def ger_resp(result,map):
    f = open('get_data.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    data = js.call('get_data',result,map)
    # print(data)
    # for a in data:
    #     print(a)

    return data


def spider():

    cookies = {
        '_uab_collina': '176374235410255695230168',
        'JSESSIONID': 'EF4C0B800E88CFCF42373F757B6FFB44',
        'guidesStatus': 'off',
        'highContrastMode': 'defaltMode',
        'cursorStatus': 'off',
        '_jc_save_fromStation': '%u5317%u4EAC%2CBJP',
        '_jc_save_toStation': '%u4E0A%u6D77%2CSHH',
        '_jc_save_toDate': '2025-11-22',
        '_jc_save_wfdc_flag': 'dc',
        '_jc_save_fromDate': '2025-11-23',
        'route': '6f50b51faa11b987e576cdb301e545c4',
        'BIGipServerotn': '1473839370.24610.0000',
    }

    headers = {
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'If-Modified-Since': '0',
        'Pragma': 'no-cache',
        'Referer': 'https://kyfw.12306.cn/otn/leftTicket/init',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        # 'Cookie': '_uab_collina=176374235410255695230168; JSESSIONID=EF4C0B800E88CFCF42373F757B6FFB44; guidesStatus=off; highContrastMode=defaltMode; cursorStatus=off; _jc_save_fromStation=%u5317%u4EAC%2CBJP; _jc_save_toStation=%u4E0A%u6D77%2CSHH; _jc_save_toDate=2025-11-22; _jc_save_wfdc_flag=dc; _jc_save_fromDate=2025-11-23; route=6f50b51faa11b987e576cdb301e545c4; BIGipServerotn=1473839370.24610.0000',
    }

    params = {
        'leftTicketDTO.train_date': '2025-11-23',
        'leftTicketDTO.from_station': 'BJP',
        'leftTicketDTO.to_station': 'SHH',
        'purpose_codes': 'ADULT',
    }

    response = requests.get('https://kyfw.12306.cn/otn/leftTicket/queryG', params=params, cookies=cookies,headers=headers).json()
    result = response['data']['result']
    map = response['data']['map']
    data = ger_resp(result,map)
    for a in data:
        print(a)


def main():
    spider()


if __name__ == '__main__':
    main()