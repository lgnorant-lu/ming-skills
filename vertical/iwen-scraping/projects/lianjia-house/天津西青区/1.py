import requests
from lxml import etree

cookies = {
    'lianjia_uuid': '0cf52ef0-8cc4-4d66-a2e2-3744054239a3',
    '_ga': 'GA1.2.940265959.1748678716',
    '_ga_NKBFZ7NGRV': 'GS2.2.s1748678717$o1$g1$t1748679805$j22$l0$h0',
    '_ga_XLL3Z3LPTW': 'GS2.2.s1748678717$o1$g1$t1748679805$j22$l0$h0',
    'digv_extends': '%7B%22utmTrackId%22%3A%22107203856%22%7D',
    'Hm_lvt_46bf127ac9b856df503ec2dbf942b67e': '1751711341',
    'HMACCOUNT': 'F4037280F82AFFB1',
    '_jzqa': '1.1758849429708644400.1748678706.1748678706.1751711341.2',
    '_jzqc': '1',
    '_jzqckmp': '1',
    '_gid': 'GA1.2.359320661.1751711363',
    'crosSdkDT2019DeviceId': '7eyok9--lq585y-j6ij29aggtjfsa2-zu0gggafe',
    'login_ucid': '2000000483506626',
    'lianjia_token': '2.0015b831da40f0e5f4041518eb46e01734',
    'lianjia_token_secure': '2.0015b831da40f0e5f4041518eb46e01734',
    'security_ticket': 'iK5qP2UNFrqlonuQObmg9n/5XRggszqYkedWjQ2ObAxxBZali7TnD+yrQIwHZH7EhEBStWhnid9KbKFEVdiQFxMUY/eQQv0dpK+stMjTpk+0NekecJ8Xgi+o6GqkCq0paELNZ1GS+fF4AnS0W2F8kfGXsWQb4mHROEXI1NxhkqQ=',
    'lfrc_': 'a4adb039-8e48-412d-97d6-ab95ff5b941b',
    'select_city': '120000',
    'lianjia_ssid': 'c213c503-6dec-4855-ae50-ceae1fbc75fa',
    '_qzjc': '1',
    '_jzqy': '1.1748678706.1751711460.5.jzqsr=baidu.jzqsr=baidu',
    'sensorsdata2015jssdkcross': '%7B%22distinct_id%22%3A%22197255f82c523d9-08bc83bcd8dcc5-26011e51-1024000-197255f82c627a8%22%2C%22%24device_id%22%3A%22197255f82c523d9-08bc83bcd8dcc5-26011e51-1024000-197255f82c627a8%22%2C%22props%22%3A%7B%22%24latest_traffic_source_type%22%3A%22%E8%87%AA%E7%84%B6%E6%90%9C%E7%B4%A2%E6%B5%81%E9%87%8F%22%2C%22%24latest_referrer%22%3A%22https%3A%2F%2Fwww.baidu.com%2Flink%22%2C%22%24latest_referrer_host%22%3A%22www.baidu.com%22%2C%22%24latest_search_keyword%22%3A%22%E6%9C%AA%E5%8F%96%E5%88%B0%E5%80%BC%22%2C%22%24latest_utm_source%22%3A%22baidu%22%2C%22%24latest_utm_medium%22%3A%22pinzhuan%22%2C%22%24latest_utm_campaign%22%3A%22wybeijing%22%2C%22%24latest_utm_content%22%3A%22biaotimiaoshu%22%2C%22%24latest_utm_term%22%3A%22biaoti%22%7D%7D',
    'Hm_lpvt_46bf127ac9b856df503ec2dbf942b67e': '1751711512',
    '_qzja': '1.1310116441.1751711460243.1751711460243.1751711460244.1751711476676.1751711512696.0.0.0.3.1',
    '_qzjb': '1.1751711460243.3.0.0.0',
    '_qzjto': '3.1.0',
    '_jzqb': '1.7.10.1751711341.1',
    'srcid': 'eyJ0Ijoie1wiZGF0YVwiOlwiMWU4NzQ0OTZjMmRmZTU3ZWY3ZDRiNTEwNjNlZGZlZTkwNjkwYTQ5YjE1ZTJiNzZkMTdjOWI4MDIwYTcyOTg1ODY4NDZmOTRlYzYwOWU1OWFjY2EzNmI2ZDhmZDNmNjAzMmM2NGZlMmE5YmUyZTI0NTE3NjgwOTc4YjJmYjNiNDlkYWMzZjUyOTY3YTA4YTg3MDUzYjIxNjgwYjlhZjM2NDRjOTVjMzc1MTI0YWVlMzg1M2Y0OGQyODE5YTk5OWVlMzhlZDRhYjc5ZTYzMDU4ZGI4OTQxYjU3YmYzODI4YzIzMzZhODczZWNmNDc5YWM5MGFjZTU4ZWViOTdmMDJhMlwiLFwia2V5X2lkXCI6XCIxXCIsXCJzaWduXCI6XCJkMDMzZTQ5Y1wifSIsInIiOiJodHRwczovL3RqLmxpYW5qaWEuY29tL2Vyc2hvdWZhbmcveGlxaW5nL3BnMi8/c3VnPSVFOCVBNSVCRiVFOSU5RCU5MiIsIm9zIjoid2ViIiwidiI6IjAuMSJ9',
    '_ga_B3G62E46BE': 'GS2.2.s1751711471$o1$g1$t1751711523$j8$l0$h0',
    '_ga_049GGDBYWQ': 'GS2.2.s1751711471$o1$g1$t1751711523$j8$l0$h0',
}

headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
    'Referer': 'https://tj.lianjia.com/ershoufang/xiqing/pg2/?sug=%E8%A5%BF%E9%9D%92',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    # 'Cookie': 'lianjia_uuid=0cf52ef0-8cc4-4d66-a2e2-3744054239a3; _ga=GA1.2.940265959.1748678716; _ga_NKBFZ7NGRV=GS2.2.s1748678717$o1$g1$t1748679805$j22$l0$h0; _ga_XLL3Z3LPTW=GS2.2.s1748678717$o1$g1$t1748679805$j22$l0$h0; digv_extends=%7B%22utmTrackId%22%3A%22107203856%22%7D; Hm_lvt_46bf127ac9b856df503ec2dbf942b67e=1751711341; HMACCOUNT=F4037280F82AFFB1; _jzqa=1.1758849429708644400.1748678706.1748678706.1751711341.2; _jzqc=1; _jzqckmp=1; _gid=GA1.2.359320661.1751711363; crosSdkDT2019DeviceId=7eyok9--lq585y-j6ij29aggtjfsa2-zu0gggafe; login_ucid=2000000483506626; lianjia_token=2.0015b831da40f0e5f4041518eb46e01734; lianjia_token_secure=2.0015b831da40f0e5f4041518eb46e01734; security_ticket=iK5qP2UNFrqlonuQObmg9n/5XRggszqYkedWjQ2ObAxxBZali7TnD+yrQIwHZH7EhEBStWhnid9KbKFEVdiQFxMUY/eQQv0dpK+stMjTpk+0NekecJ8Xgi+o6GqkCq0paELNZ1GS+fF4AnS0W2F8kfGXsWQb4mHROEXI1NxhkqQ=; lfrc_=a4adb039-8e48-412d-97d6-ab95ff5b941b; select_city=120000; lianjia_ssid=c213c503-6dec-4855-ae50-ceae1fbc75fa; _qzjc=1; _jzqy=1.1748678706.1751711460.5.jzqsr=baidu.jzqsr=baidu; sensorsdata2015jssdkcross=%7B%22distinct_id%22%3A%22197255f82c523d9-08bc83bcd8dcc5-26011e51-1024000-197255f82c627a8%22%2C%22%24device_id%22%3A%22197255f82c523d9-08bc83bcd8dcc5-26011e51-1024000-197255f82c627a8%22%2C%22props%22%3A%7B%22%24latest_traffic_source_type%22%3A%22%E8%87%AA%E7%84%B6%E6%90%9C%E7%B4%A2%E6%B5%81%E9%87%8F%22%2C%22%24latest_referrer%22%3A%22https%3A%2F%2Fwww.baidu.com%2Flink%22%2C%22%24latest_referrer_host%22%3A%22www.baidu.com%22%2C%22%24latest_search_keyword%22%3A%22%E6%9C%AA%E5%8F%96%E5%88%B0%E5%80%BC%22%2C%22%24latest_utm_source%22%3A%22baidu%22%2C%22%24latest_utm_medium%22%3A%22pinzhuan%22%2C%22%24latest_utm_campaign%22%3A%22wybeijing%22%2C%22%24latest_utm_content%22%3A%22biaotimiaoshu%22%2C%22%24latest_utm_term%22%3A%22biaoti%22%7D%7D; Hm_lpvt_46bf127ac9b856df503ec2dbf942b67e=1751711512; _qzja=1.1310116441.1751711460243.1751711460243.1751711460244.1751711476676.1751711512696.0.0.0.3.1; _qzjb=1.1751711460243.3.0.0.0; _qzjto=3.1.0; _jzqb=1.7.10.1751711341.1; srcid=eyJ0Ijoie1wiZGF0YVwiOlwiMWU4NzQ0OTZjMmRmZTU3ZWY3ZDRiNTEwNjNlZGZlZTkwNjkwYTQ5YjE1ZTJiNzZkMTdjOWI4MDIwYTcyOTg1ODY4NDZmOTRlYzYwOWU1OWFjY2EzNmI2ZDhmZDNmNjAzMmM2NGZlMmE5YmUyZTI0NTE3NjgwOTc4YjJmYjNiNDlkYWMzZjUyOTY3YTA4YTg3MDUzYjIxNjgwYjlhZjM2NDRjOTVjMzc1MTI0YWVlMzg1M2Y0OGQyODE5YTk5OWVlMzhlZDRhYjc5ZTYzMDU4ZGI4OTQxYjU3YmYzODI4YzIzMzZhODczZWNmNDc5YWM5MGFjZTU4ZWViOTdmMDJhMlwiLFwia2V5X2lkXCI6XCIxXCIsXCJzaWduXCI6XCJkMDMzZTQ5Y1wifSIsInIiOiJodHRwczovL3RqLmxpYW5qaWEuY29tL2Vyc2hvdWZhbmcveGlxaW5nL3BnMi8/c3VnPSVFOCVBNSVCRiVFOSU5RCU5MiIsIm9zIjoid2ViIiwidiI6IjAuMSJ9; _ga_B3G62E46BE=GS2.2.s1751711471$o1$g1$t1751711523$j8$l0$h0; _ga_049GGDBYWQ=GS2.2.s1751711471$o1$g1$t1751711523$j8$l0$h0',
}

params = {
    'sug': '西青',
}

res = requests.get('https://tj.lianjia.com/ershoufang/xiqing/pg3/', params=params, cookies=cookies, headers=headers)
# print(response.text)
resp = etree.HTML(res.text)
lis = resp.xpath('//ul[@class="sellListContent"]/li')
for li in lis:
    # print(li)
    title = li.xpath('//div[@class="title"]//text()')
    print(title)
