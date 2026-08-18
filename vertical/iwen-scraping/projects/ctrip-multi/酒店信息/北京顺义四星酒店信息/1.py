# https://hotels.ctrip.com/hotels/list?countryId=1&city=1&provinceId=0&checkin=2025/11/13&checkout=2025/11/14&starlist=4&optionId=98&optionType=Location&directSearch=0&optionName=%E9%A1%BA%E4%B9%89%E5%8C%BA&display=%E9%A1%BA%E4%B9%89%E5%8C%BA&crn=1&adult=1&children=0&searchBoxArg=t&travelPurpose=0&ctm_ref=ix_sb_dl&domestic=1&&v2_mod=45&v2_version=E


import requests
from lxml import etree

def spider_zhu():
    zhu_url = 'https://hotels.ctrip.com/hotels/list?cityId=1&provinceId=0&countryId=1&cityName=%E5%8C%97%E4%BA%AC&destName=%E5%8C%97%E4%BA%AC&searchWord=%E9%A1%BA%E4%B9%89%E5%8C%BA&searchType=D&searchValue=9%7C98*9*98%7C40.1499038%7C116.66084543%7C2%7C%E9%A1%BA%E4%B9%89%E5%8C%BA&checkin=2025-11-13&checkout=2025-11-14&crn=1&listFilters=29~1*29*1~1*2%2C16~4*16*4%2C17~1*17*1%2C80~2*80*2&curr=CNY&locale=zh-CN&old=1&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E'
    # cookies = {
    #     'UBT_VID': '1739016193115.1e81spSBmcOH',
    #     'GUID': '09031133216049249678',
    #     'MKT_CKID': '1739016193592.e04oj.ivp7',
    #     '_RSG': 'Dq430kpIcyB03Pej6sBal9',
    #     '_RDG': '28d066feee74c927280b98cfd6b4465ee7',
    #     '_RGUID': 'bf264b3b-800c-4d0d-9be4-2f61ada190c0',
    #     'nfes_isSupportWebP': '1',
    #     'IBU_TRANCE_LOG_P': '85896143134',
    #     '_abtest_userid': 'e5774eeb-0fe0-4b55-b1cc-cc9a3c6e05f0',
    #     '_ga': 'GA1.1.22635546.1739016194',
    #     '_bfaStatusPVSend': '1',
    #     '_bfaStatus': 'send',
    #     '_ubtstatus': '%7B%22vid%22%3A%221739016193115.1e81spSBmcOH%22%2C%22sid%22%3A10%2C%22pvid%22%3A8%2C%22pid%22%3A290601%7D',
    #     'intl_ht1': 'h4=905_1738861,905_5247407,1048_1798254,1048_5377542,1047_28112330,1048_112008385',
    #     '_RF1': '60.222.157.220',
    #     'GUID': '09031133216049249678',
    #     'nfes_isSupportWebP': '1',
    #     'ibu_hotel_search_crn_guest': '%7B%22adult%22%3A1%2C%22children%22%3A0%2C%22ages%22%3A%22%22%2C%22crn%22%3A1%7D',
    #     'ibu_country': 'CN',
    #     'ibulocale': 'zh_cn',
    #     'cookiePricesDisplayed': 'CNY',
    #     'oldCurrency': 'CNY',
    #     'cticket': '0A96DDDF35192EA23A749A6D845E55772A0CC074D91B89FB62B70E63798ADDB6',
    #     'login_type': '0',
    #     'login_uid': 'E7DB6ED4A80659916A1ED06FDC7225C7',
    #     'DUID': 'u=17ACEC716FDFDE9F3E386E087E34B96D&v=0',
    #     'IsNonUser': 'F',
    #     'AHeadUserInfo': 'VipGrade=0&VipGradeName=%C6%D5%CD%A8%BB%E1%D4%B1&UserName=&NoReadMessageCount=0',
    #     '_udl': '708D70C2B179E2F91CC5ED1C2CCE362D',
    #     'Hm_lvt_a8d6737197d542432f4ff4abc6e06384': '1761056328,1762272672,1763015038',
    #     'Hm_lpvt_a8d6737197d542432f4ff4abc6e06384': '1763015038',
    #     'HMACCOUNT': '08D353962B94E89F',
    #     'Session': 'smartlinkcode=U130026&smartlinklanguage=zh&SmartLinkKeyWord=&SmartLinkQuary=&SmartLinkHost=',
    #     'Union': 'AllianceID=4897&SID=130026&OUID=&createtime=1763015039&Expires=1763619839172',
    #     'MKT_Pagesource': 'PC',
    #     '_ga_9BZF483VNQ': 'GS2.1.s1763015039$o32$g1$t1763015084$j15$l0$h0',
    #     '_ga_5DVRDQD429': 'GS2.1.s1763015039$o33$g1$t1763015084$j15$l0$h786741158',
    #     '_ga_B77BES1Z8Z': 'GS2.1.s1763015039$o33$g1$t1763015084$j15$l0$h0',
    #     'Hm_lvt_4a51227696a44e11b0c61f6105dc4ee4': '1761056523,1762272970,1763015084',
    #     'ibu_hotel_search_date': '%7B%22checkIn%22%3A%222025-11-13%22%2C%22checkOut%22%3A%222025-11-14%22%7D',
    #     'ibu_hotel_search_target': '%7B%22countryId%22%3A1%2C%22provinceId%22%3A-1%2C%22searchWord%22%3A%22%E9%A1%BA%E4%B9%89%E5%8C%BA%22%2C%22cityId%22%3A1%2C%22searchType%22%3A%22%22%2C%22searchValue%22%3A%22%22%7D',
    #     'IBU_showtotalamt': '2',
    #     'intl_ht1': 'h4%3D1_81450535%2C1_429492%2C1_70490388%2C1_65394133%2C1_30006625%2C274_988507',
    #     'ibusite': 'CN',
    #     'ibugroup': 'ctrip',
    #     '_jzqco': '%7C%7C%7C%7C1763015039662%7C1.1777369495.1739016193598.1763019290432.1763019793449.1763019290432.1763019793449.undefined.0.0.669.669',
    #     '_bfa': '1.1739016193115.1e81spSBmcOH.1.1763019289468.1763019793065.61.25.10650171192',
    #     'Hm_lpvt_4a51227696a44e11b0c61f6105dc4ee4': '1763019795',
    #     'ibulanguage': 'CN',
    # }
    headers = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'priority': 'u=0, i',
        'referer': 'https://www.ctrip.com/',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        # 'cookie': 'UBT_VID=1739016193115.1e81spSBmcOH; GUID=09031133216049249678; MKT_CKID=1739016193592.e04oj.ivp7; _RSG=Dq430kpIcyB03Pej6sBal9; _RDG=28d066feee74c927280b98cfd6b4465ee7; _RGUID=bf264b3b-800c-4d0d-9be4-2f61ada190c0; nfes_isSupportWebP=1; IBU_TRANCE_LOG_P=85896143134; _abtest_userid=e5774eeb-0fe0-4b55-b1cc-cc9a3c6e05f0; _ga=GA1.1.22635546.1739016194; _bfaStatusPVSend=1; _bfaStatus=send; _ubtstatus=%7B%22vid%22%3A%221739016193115.1e81spSBmcOH%22%2C%22sid%22%3A10%2C%22pvid%22%3A8%2C%22pid%22%3A290601%7D; intl_ht1=h4=905_1738861,905_5247407,1048_1798254,1048_5377542,1047_28112330,1048_112008385; _RF1=60.222.157.220; GUID=09031133216049249678; nfes_isSupportWebP=1; ibu_hotel_search_crn_guest=%7B%22adult%22%3A1%2C%22children%22%3A0%2C%22ages%22%3A%22%22%2C%22crn%22%3A1%7D; ibu_country=CN; ibulocale=zh_cn; cookiePricesDisplayed=CNY; oldCurrency=CNY; cticket=0A96DDDF35192EA23A749A6D845E55772A0CC074D91B89FB62B70E63798ADDB6; login_type=0; login_uid=E7DB6ED4A80659916A1ED06FDC7225C7; DUID=u=17ACEC716FDFDE9F3E386E087E34B96D&v=0; IsNonUser=F; AHeadUserInfo=VipGrade=0&VipGradeName=%C6%D5%CD%A8%BB%E1%D4%B1&UserName=&NoReadMessageCount=0; _udl=708D70C2B179E2F91CC5ED1C2CCE362D; Hm_lvt_a8d6737197d542432f4ff4abc6e06384=1761056328,1762272672,1763015038; Hm_lpvt_a8d6737197d542432f4ff4abc6e06384=1763015038; HMACCOUNT=08D353962B94E89F; Session=smartlinkcode=U130026&smartlinklanguage=zh&SmartLinkKeyWord=&SmartLinkQuary=&SmartLinkHost=; Union=AllianceID=4897&SID=130026&OUID=&createtime=1763015039&Expires=1763619839172; MKT_Pagesource=PC; _ga_9BZF483VNQ=GS2.1.s1763015039$o32$g1$t1763015084$j15$l0$h0; _ga_5DVRDQD429=GS2.1.s1763015039$o33$g1$t1763015084$j15$l0$h786741158; _ga_B77BES1Z8Z=GS2.1.s1763015039$o33$g1$t1763015084$j15$l0$h0; Hm_lvt_4a51227696a44e11b0c61f6105dc4ee4=1761056523,1762272970,1763015084; ibu_hotel_search_date=%7B%22checkIn%22%3A%222025-11-13%22%2C%22checkOut%22%3A%222025-11-14%22%7D; ibu_hotel_search_target=%7B%22countryId%22%3A1%2C%22provinceId%22%3A-1%2C%22searchWord%22%3A%22%E9%A1%BA%E4%B9%89%E5%8C%BA%22%2C%22cityId%22%3A1%2C%22searchType%22%3A%22%22%2C%22searchValue%22%3A%22%22%7D; IBU_showtotalamt=2; intl_ht1=h4%3D1_81450535%2C1_429492%2C1_70490388%2C1_65394133%2C1_30006625%2C274_988507; ibusite=CN; ibugroup=ctrip; _jzqco=%7C%7C%7C%7C1763015039662%7C1.1777369495.1739016193598.1763019290432.1763019793449.1763019290432.1763019793449.undefined.0.0.669.669; _bfa=1.1739016193115.1e81spSBmcOH.1.1763019289468.1763019793065.61.25.10650171192; Hm_lpvt_4a51227696a44e11b0c61f6105dc4ee4=1763019795; ibulanguage=CN',
    }
    response = requests.get(zhu_url,headers=headers).text
    print(response)



def spider(page):

    url = 'https://m.ctrip.com/restapi/soa2/34951/fetchHotelList'

    cookies = {
        'UBT_VID': '1739016193115.1e81spSBmcOH',
        'GUID': '09031133216049249678',
        'MKT_CKID': '1739016193592.e04oj.ivp7',
        '_RSG': 'Dq430kpIcyB03Pej6sBal9',
        '_RDG': '28d066feee74c927280b98cfd6b4465ee7',
        '_RGUID': 'bf264b3b-800c-4d0d-9be4-2f61ada190c0',
        'nfes_isSupportWebP': '1',
        '_abtest_userid': 'e5774eeb-0fe0-4b55-b1cc-cc9a3c6e05f0',
        'nfes_isSupportWebP': '1',
        '_ga': 'GA1.1.22635546.1739016194',
        '_bfaStatusPVSend': '1',
        '_bfaStatus': 'send',
        '_ubtstatus': '%7B%22vid%22%3A%221739016193115.1e81spSBmcOH%22%2C%22sid%22%3A10%2C%22pvid%22%3A8%2C%22pid%22%3A290601%7D',
        'intl_ht1': 'h4=905_1738861,905_5247407,1048_1798254,1048_5377542,1047_28112330,1048_112008385',
        '_RF1': '60.222.157.220',
        'ibulocale': 'zh_cn',
        'cookiePricesDisplayed': 'CNY',
        'login_type': '0',
        'IsNonUser': 'F',
        'AHeadUserInfo': 'VipGrade=0&VipGradeName=%C6%D5%CD%A8%BB%E1%D4%B1&UserName=&NoReadMessageCount=0',
        '_udl': '708D70C2B179E2F91CC5ED1C2CCE362D',
        'Hm_lvt_a8d6737197d542432f4ff4abc6e06384': '1761056328,1762272672,1763015038',
        'Hm_lpvt_a8d6737197d542432f4ff4abc6e06384': '1763015038',
        'HMACCOUNT': '08D353962B94E89F',
        'MKT_Pagesource': 'PC',
        '_ga_9BZF483VNQ': 'GS2.1.s1763015039$o32$g1$t1763015084$j15$l0$h0',
        '_ga_5DVRDQD429': 'GS2.1.s1763015039$o33$g1$t1763015084$j15$l0$h786741158',
        '_ga_B77BES1Z8Z': 'GS2.1.s1763015039$o33$g1$t1763015084$j15$l0$h0',
        'IBU_showtotalamt': '2',
        'cticket': 'B4EDD07E97B6EEC5038A16CEF63DB808D0FC9D054B34696A4ED5CCCB64CD5B40',
        'login_uid': '9D36142E1CC9037F0339734637CB8E06D9DF4E7C727027EEE9DF66832C12620B',
        'DUID': 'u=1780B59FA468C6EEB8CED5B3AC11C994&v=0',
        'Session': 'smartlinkcode=U1535&smartlinklanguage=zh&SmartLinkKeyWord=&SmartLinkQuary=&SmartLinkHost=',
        'Union': 'AllianceID=1315&SID=1535&OUID=&createtime=1763025948&Expires=1763630748332',
        '_jzqco': '%7C%7C%7C%7C1763015039662%7C1.1777369495.1739016193598.1763025951557.1763025971506.1763025951557.1763025971506.undefined.0.0.677.677',
        '_bfa': '1.1739016193115.1e81spSBmcOH.1.1763025951628.1763025971108.63.4.10650171192',
        'ibulanguage': 'CN',
    }

    headers = {
        'accept': 'application/json',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'content-type': 'application/json',
        'cookieorigin': 'https://hotels.ctrip.com',
        'origin': 'https://hotels.ctrip.com',
        'phantom-token': '1004-common-QXES3ebbxpFRfgEGSwZcYNow6piSpjT3iUdRUpwZky4UwpNiLnEBhJz0i1cYSbwqXvbSEGtwBUySbYsGvpzyNPY1PjlaY0FYGcyg5ycFJqDxn7Yn5R7Y6mIP9WbzIdbRPzyAHwpdioDWqHYhNJlUvT5j1tjNQJL4iDUJNPJQzRldePY4ortgRgMjzhKTpjhbjTnEqmyXE3Xi7oYHEfAYS3yfEhOYdgyzDKqniozjgFj6XWNLynhIB6wDajfcw6QefFEO0I4hw5giSsRaEZ6Yp4y8FKsdiFPjbnj3GWUHypEP7YH9yXAWtDeU8ya6jgEOGipay1NwUqe08jXlIOzxNZygEHaifLJoMRUE1nYcBwFAE7QwfDi1Fxz4eOFYH3wzQj4BxzMyPEp5iZzJTzW5EPfYtnwcGw6giUmv36YHPjnQwDzI0OxmayqEB6iZTJUdRcEaXYoqwAQwdqeX5ja6ITgWd9EMoR4fjUE9PidFJsEQSYUaJPowdfJNElhY9BJ6cj4BEsEm0YGZJ5NvsdyoEBSYQqJU0wMqE5E8bYh0JalidoYZEcLYGMJUOY6GE4EZlYaTw1DyOsjtMyZBjS4Wt5E0QRPqjMEQniD0JkEPnYcDJ78w0oJXEdUY6SJl8jdmETEd1Yn3JlkvMQyZEsqYkPJLhwBDEUE39YNqJSBitfY0E56YsmJtnY3tEpE4sYA8wdnylqjNsEXmwsfwpDKt5vTni5mwh1ybEnPi67JpELkYScJkcwsTvmEQkYMlJ4gY6gRBENLYpZJzfi3zY7E0ZYNcJbHwZmEgE5NYMTJcnim9vqE3ZY70JH1jODvPE1PY74JkBwT0JZEq0Y6PJOzjd4EfEmzYDoJdqi0MYnEGpY9kwMgy6djtXEcbwT9wDtKH8w3hIzMEmljhEpTimSJAMJGEnZYFawdMymPjN9EkQwzqwMBKQojskEqzWl7vfzjSEzZicPJ5QvXENMYhXJloykzETSvfTjlvPLv3v9biDHIMgYzY00xMkioFR1XRPzyHbiGmv6cWNHRfLwLQRfOv0LiclRm8R8UJlpIq9RdgjlBjMaRh8yXPETbJ4mi8ZRm0wXNRp6vnXrQEnFE5YPJcNJs4KqLEQpwc5w85RQ9JHoEltjmfj95eQlwQHi0Ui4MikXelbEGDYSdyp4idceAmJnzJlQiNkvBPePzinGW1OEsFjqsEDQy8bJmcvf9wlFYn3i5PvHzJLFr6JHYADwN6W9Di74jdBEGBYMmw63jAhwFDYn6w85wg3EU1I4YOfElbwpFwLOY68ETmyAlRXajhYbnJznjo4JGPvhMelQYzGi1bY9hi9ord8WpYMzKtZwObR58eDtELTjO5WUJzse0sYFYOcwZkycnYcZr9pKZpebgEsGWPMvPtKksWNY98WfhiNsKDfYQ5JZdwANWaPet4Rl5E3nEZPWGovczKTFrgYmkJtHwp1y9aYdZJ6kw8fWPFeLpR4Qi1QvGhYUZeGHIP0YkYHNY0v3gjatEXdEaDEtPyfdrPTYDYtbR14eH7e4QY9DioBwd3R0LEalWspYo4epHwZYmQJHgr7EhZJ3vk1wq8KaYSOwNPiPBK4bjb7wafvlQjAsWTGrqSEsYcGJ4dxm5rhoYM0WzHvq0Y6YT1W1dehEa9jmqwtlvh6j7Becdvb0yFYMycgYcsrtoJB6WBfIkfEmkr8YGdxUQIGaJfUj89iDliPcxNoWp7jor5pxsfYOFw0DIFr1ya1x0NYMljnFjLMW9j8Dx0kjc8x5YzXI9zj84EtqRfzWUTwZLJLfWsnRXUyUkRP9RB6vlcYS1JXUJtq',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://hotels.ctrip.com/',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'x-ctx-country': 'CN',
        'x-ctx-currency': 'CNY',
        'x-ctx-locale': 'zh-CN',
        'x-ctx-ubt-pageid': '10650171192',
        'x-ctx-ubt-pvid': '4',
        'x-ctx-ubt-sid': '63',
        'x-ctx-ubt-vid': '1739016193115.1e81spSBmcOH',
        'x-ctx-wclient-req': 'e963ac5806aad1c709e7412fb1b5059f',
        # 'cookie': 'UBT_VID=1739016193115.1e81spSBmcOH; GUID=09031133216049249678; MKT_CKID=1739016193592.e04oj.ivp7; _RSG=Dq430kpIcyB03Pej6sBal9; _RDG=28d066feee74c927280b98cfd6b4465ee7; _RGUID=bf264b3b-800c-4d0d-9be4-2f61ada190c0; nfes_isSupportWebP=1; _abtest_userid=e5774eeb-0fe0-4b55-b1cc-cc9a3c6e05f0; nfes_isSupportWebP=1; _ga=GA1.1.22635546.1739016194; _bfaStatusPVSend=1; _bfaStatus=send; _ubtstatus=%7B%22vid%22%3A%221739016193115.1e81spSBmcOH%22%2C%22sid%22%3A10%2C%22pvid%22%3A8%2C%22pid%22%3A290601%7D; intl_ht1=h4=905_1738861,905_5247407,1048_1798254,1048_5377542,1047_28112330,1048_112008385; _RF1=60.222.157.220; ibulocale=zh_cn; cookiePricesDisplayed=CNY; login_type=0; IsNonUser=F; AHeadUserInfo=VipGrade=0&VipGradeName=%C6%D5%CD%A8%BB%E1%D4%B1&UserName=&NoReadMessageCount=0; _udl=708D70C2B179E2F91CC5ED1C2CCE362D; Hm_lvt_a8d6737197d542432f4ff4abc6e06384=1761056328,1762272672,1763015038; Hm_lpvt_a8d6737197d542432f4ff4abc6e06384=1763015038; HMACCOUNT=08D353962B94E89F; MKT_Pagesource=PC; _ga_9BZF483VNQ=GS2.1.s1763015039$o32$g1$t1763015084$j15$l0$h0; _ga_5DVRDQD429=GS2.1.s1763015039$o33$g1$t1763015084$j15$l0$h786741158; _ga_B77BES1Z8Z=GS2.1.s1763015039$o33$g1$t1763015084$j15$l0$h0; IBU_showtotalamt=2; cticket=B4EDD07E97B6EEC5038A16CEF63DB808D0FC9D054B34696A4ED5CCCB64CD5B40; login_uid=9D36142E1CC9037F0339734637CB8E06D9DF4E7C727027EEE9DF66832C12620B; DUID=u=1780B59FA468C6EEB8CED5B3AC11C994&v=0; Session=smartlinkcode=U1535&smartlinklanguage=zh&SmartLinkKeyWord=&SmartLinkQuary=&SmartLinkHost=; Union=AllianceID=1315&SID=1535&OUID=&createtime=1763025948&Expires=1763630748332; _jzqco=%7C%7C%7C%7C1763015039662%7C1.1777369495.1739016193598.1763025951557.1763025971506.1763025951557.1763025971506.undefined.0.0.677.677; _bfa=1.1739016193115.1e81spSBmcOH.1.1763025951628.1763025971108.63.4.10650171192; ibulanguage=CN',
    }

    json_data = {
        'date': {
            'dateType': 1,
            'dateInfo': {
                'checkInDate': '20251113',
                'checkOutDate': '20251114',
            },
        },
        'destination': {
            'type': 1,
            'geo': {
                'cityId': 1,
                'countryId': 1,
            },
            'keyword': {
                'word': '顺义区',
            },
        },
        'extraFilter': {
            'childInfoItems': [],
            'ctripMainLandBDCoordinate': True,
            'sessionId': 'd7cb724c11d34cf7a2d8cebf6578c68c',
            'extendableParams': {
                'tripWalkDriveSwitch': 'T',
                'isUgcSentenceB': '',
            },
        },
        'filters': [
            {
                'type': '16',
                'title': '4钻/星|高档',
                'value': '4',
                'filterId': '16|4',
            },
            {
                'type': '17',
                'title': '欢迎度排序',
                'value': '1',
                'filterId': '17|1',
            },
            {
                'type': '9',
                'title': '顺义区',
                'value': '98|40.1499038|116.66084543|2|顺义区',
                'filterId': '9|98',
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
            'pageIndex': page,
            'pageSize': 10,
            'pageCode': '10650171192',
        },
        'hotelIdFilter': {
            'hotelAldyShown': [
                '30006625',
                '65394133',
                '130928412',
                '44461848',
                '80920781',
                '54423619',
                '106144983',
                '123999311',
                '70490388',
                '56796268',
                '45899559',
                '101127560',
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
                    'value': '2025-11-13',
                },
                {
                    'name': 'checkOut',
                    'value': '2025-11-14',
                },
                {
                    'name': 'region',
                    'value': 'CN',
                },
            ],
        },
    }

    response = requests.post(url, headers=headers,cookies=cookies,json=json_data).json()
    print(response)
    print('\n\n\n\n')


    # response_xpath = etree.HTML(response)
    # divs = response_xpath.xpath('//div[@class="hotel-list"]/div[@class="list-item"]')
    # for div in divs:
    #     print(div)


def main():
    # spider_zhu()
    for page in range(1,5):
        spider(page)


if __name__ == '__main__':
    main()