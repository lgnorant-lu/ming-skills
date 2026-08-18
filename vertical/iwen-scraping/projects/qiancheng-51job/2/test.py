import uuid

import requests
import execjs
import time
from urllib.parse import urlencode, quote
import re



f = open('sign值2.js', mode='r', encoding='utf-8')
s = f.read()
f.close()
js_zhi = execjs.compile(s)

# 时间戳
ti = time.time()
tim = str(ti)[0:10]
# 关键字
wor = '道路'
word = quote(wor, encoding='utf-8')
# print(word)
# 页数
num = 1

# 构建的参数
params = {
    'api_key': '51job',
    'timestamp': str(tim),
    'keyword': str(wor),
    'searchType': '2',
    'function': '',
    'industry': '',
    'jobArea': '000000',
    'jobArea2': '',
    'landmark': '',
    'metro': '',
    'salary': '',
    'workYear': '',
    'degree': '',
    'companyType': '',
    'companySize': '',
    'jobType': '',
    'issueDate': '',
    'sortType': '0',
    'pageNum': str(num),
    'requestId': 'b201e3a2f2baea3c746beef7ecab2407',
    'pageSize': '20',
    'source': '1',
    'accountId': '266821509',
    'pageCode': 'sou|sou|soulb',
    'scene': '7',
}
# dizhi = f'/api/job/search-pc?api_key=51job&timestamp={tim}&keyword={word}&searchType=2&function=&industry=&jobArea=000000&jobArea2=&landmark=&metro=&salary=&workYear=&degree=&companyType=&companySize=&jobType=&issueDate=&sortType=0&pageNum={num}&requestId=b201e3a2f2baea3c746beef7ecab2407&pageSize=20&source=1&accountId=266821509&pageCode=sou%7Csou%7Csoulb&scene=7'
dizhi = '/api/job/search-pc?' + urlencode(params)

sign_str = js_zhi.call('fn1', dizhi)
sign = sign_str['headers']['sign']
# print(sign)

cookies = {
    'guid': '0becb2948aa3f23b7992d58bd8bf53e4',
    'tfstk': 'gzVri-Zmp_Crrvm-ESGe0CLoINh-9XS_KWiI-y4nP0mkNae2i2ZSVwUh2kPEmkoQPb2QYvo0J8_-dgLUgyELYvQ-ADmUAy25l11_yzhKtXS111OYiOvzaDxItbhcKW_wd11_yzcKtGs11WtF-RkxxXDoEsfmD2RntDqnmx0i53c3xkb4om3ntDqntZzmDjggxudq0Ybdmv4Cl80rUc4omza7i4-sjzm2tBbIzY7brmRHtSyUl8mrqOLjvbi8u4rd6QhoLJVSi7jctf2T0Wki_9_-Eyy4vbNc-LmgFuG0ZR8Htrlr0vgrh3Sqj7U06jDfsNz0Mua8gyThtqZsmzFoT1btabmogqFCDQmUnJVSeXKlYDF4o72F42KKoN_L98-HLY0xuc_VuXGaYRStypaJppHVHqo1WNpppY0xuc_VuppK3S3qfNQO.',
    'Hm_lvt_1370a11171bd6f2d9b1fe98951541941': '1757755054',
    'HMACCOUNT': 'F4037280F82AFFB1',
    'ps': 'needv%3D0',
    '51job': 'cuid%3D266821509%26%7C%26cusername%3DG745x5m8zTn2bOrAb7Q3Gtecq5IDSsbNg2ZTgP%252BEvRg%253D%26%7C%26cpassword%3D%26%7C%26cname%3D%26%7C%26cemail%3D%26%7C%26cemailstatus%3D0%26%7C%26cnickname%3D%26%7C%26ccry%3D.0Cw3J6oaXGE2%26%7C%26cconfirmkey%3D%25241%2524hRqwXhIq%2524Frm.Wvf8Zt8%252FwEe%252FNr6w9%252F%26%7C%26cautologin%3D1%26%7C%26cenglish%3D0%26%7C%26sex%3D%26%7C%26cnamekey%3D%25241%2524PZw%252Fkv1W%2524z45%252Fys8S9jgFvNDxIQs7H1%26%7C%26to%3Dd413055f65dd28767f454a28a3ae87ea68c5841e%26%7C%26',
    'sensor': 'createDate%3D2025-09-13%26%7C%26identityType%3D1',
    'slife': 'lowbrowser%3Dnot%26%7C%26lastlogindate%3D20250913%26%7C%26securetime%3DUGxXYwNgVzQCZw82DzAJagY9BTI%253D',
    'sensorsdata2015jssdkcross': '%7B%22distinct_id%22%3A%22266821509%22%2C%22first_id%22%3A%22197cf373f844bc-05f11c4dd181708-26011e51-3686400-197cf373f851c10%22%2C%22props%22%3A%7B%22%24latest_traffic_source_type%22%3A%22%E7%9B%B4%E6%8E%A5%E6%B5%81%E9%87%8F%22%2C%22%24latest_search_keyword%22%3A%22%E6%9C%AA%E5%8F%96%E5%88%B0%E5%80%BC_%E7%9B%B4%E6%8E%A5%E6%89%93%E5%BC%80%22%2C%22%24latest_referrer%22%3A%22%22%7D%2C%22identities%22%3A%22eyIkaWRlbnRpdHlfY29va2llX2lkIjoiMTk3Y2YzNzNmODQ0YmMtMDVmMTFjNGRkMTgxNzA4LTI2MDExZTUxLTM2ODY0MDAtMTk3Y2YzNzNmODUxYzEwIiwiJGlkZW50aXR5X2xvZ2luX2lkIjoiMjY2ODIxNTA5In0%3D%22%2C%22history_login_id%22%3A%7B%22name%22%3A%22%24identity_login_id%22%2C%22value%22%3A%22266821509%22%7D%2C%22%24device_id%22%3A%22197cf373f844bc-05f11c4dd181708-26011e51-3686400-197cf373f851c10%22%7D',
    'partner': 'www_baidu_com',
    'seo_refer_info_2023': '%7B%22referUrl%22%3A%22https%3A%5C%2F%5C%2Fwww.baidu.com%5C%2Flink%3Furl%3DtxTWdUwgHwpk1VFT9aUknOA-dw2OcDll5C-YCh_Hbtr3Qr1_s7XaQ2m8qj0twbdX%26wd%3D%26eqid%3Dc45b2b7b000068ac0000000368c582f5%22%2C%22referHost%22%3A%22www.baidu.com%22%2C%22landUrl%22%3A%22%5C%2F%22%2C%22landHost%22%3A%22jobs.51job.com%22%2C%22partner%22%3Anull%7D',
    'Hm_lpvt_1370a11171bd6f2d9b1fe98951541941': '1757774911',
    'acw_tc': 'ac11000117577772986888370e0098db571e52cd1eccc5e688a9ac302b248c',
    'acw_sc__v2': '34BB5169AC9A605B8DBD28669CC5C5D5CA800E1D',
    'JSESSIONID': '6477364AFFFB01F6B1CB890043323A19',
    'ssxmod_itna': '1-QqGxgDBDyWuAG0D27WG2DIZKD2DmODBP01Dp2xQv508D6DYqGdq2bqzhb3DcABqiwxqtKGYnLxbRxGNoM4xiNDAc40iDC3WLsYYmqG=3YjuEmIXW7igL1sonlyXy4=CFhgyXOMKUlpMsuKqzOoZ/85wzoeDU4GnD06xWW4PxYALDBYD74G_DDeDixGmzeDS3xD9DGPNoZWWxPDEDYPNxA3Di4D_leTDmq4DGTfK6DpioDDlYGO4/gL35AF1knybjAnxna4oleDMixGX9oC4lQ72ovDFcakUv1oQxB=gxBQWdEc56YIi1=cO1mslvse4Xl4wjwImee7DgQGXW0YRKRiDKe_5GAMGD57epiEC70iDGIegxq2Nm0H42lj5/n5V4h52ThfEHz0dCTkFGYAiNghNlx4/2tzr3q2tebeaDkInx=GDD',
    'ssxmod_itna2': '1-QqGxgDBDyWuAG0D27WG2DIZKD2DmODBP01Dp2xQv508D6DYqGdq2bqzhb3DcABqiwxqtKGYnLxb4xAEie4ge3x_SD0veD9GZ7nvWeELvNPY/6McNpNH58vTxD',
}

headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'account-id': '266821509',
    'cache-control': 'no-cache',
    'from-domain': '51job_web',
    'partner': 'sem_pcbaidupz_2',
    'pragma': 'no-cache',
    'priority': 'u=1, i',
    'property': '%7B%22partner%22%3A%22sem_pcbaidupz_2%22%2C%22webId%22%3A2%2C%22fromdomain%22%3A%2251job_web%22%2C%22frompageUrl%22%3A%22https%3A%2F%2Fwe.51job.com%2F%22%2C%22pageUrl%22%3A%22https%3A%2F%2Fwe.51job.com%2Fpc%2Fsearch%3Fkeyword%3D%25E9%2581%2593%25E8%25B7%25AF%26searchType%3D2%26sortType%3D0%26metro%3D%22%2C%22identityType%22%3A%22%E8%81%8C%E5%9C%BA%E4%BA%BA%22%2C%22userType%22%3A%22%E6%96%B0%E7%94%A8%E6%88%B7%22%2C%22isLogin%22%3A%22%E6%98%AF%22%2C%22accountid%22%3A%22266821509%22%7D',
    'referer': 'https://we.51job.com/pc/search?keyword=%E9%81%93%E8%B7%AF&searchType=2&sortType=0&metro=',
    'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'sign': str(sign),
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'user-token': 'd413055f65dd28767f454a28a3ae87ea68c5841e',
    'uuid': '0becb2948aa3f23b7992d58bd8bf53e4',
    # 'cookie': 'guid=0becb2948aa3f23b7992d58bd8bf53e4; tfstk=gzVri-Zmp_Crrvm-ESGe0CLoINh-9XS_KWiI-y4nP0mkNae2i2ZSVwUh2kPEmkoQPb2QYvo0J8_-dgLUgyELYvQ-ADmUAy25l11_yzhKtXS111OYiOvzaDxItbhcKW_wd11_yzcKtGs11WtF-RkxxXDoEsfmD2RntDqnmx0i53c3xkb4om3ntDqntZzmDjggxudq0Ybdmv4Cl80rUc4omza7i4-sjzm2tBbIzY7brmRHtSyUl8mrqOLjvbi8u4rd6QhoLJVSi7jctf2T0Wki_9_-Eyy4vbNc-LmgFuG0ZR8Htrlr0vgrh3Sqj7U06jDfsNz0Mua8gyThtqZsmzFoT1btabmogqFCDQmUnJVSeXKlYDF4o72F42KKoN_L98-HLY0xuc_VuXGaYRStypaJppHVHqo1WNpppY0xuc_VuppK3S3qfNQO.; Hm_lvt_1370a11171bd6f2d9b1fe98951541941=1757755054; HMACCOUNT=F4037280F82AFFB1; ps=needv%3D0; 51job=cuid%3D266821509%26%7C%26cusername%3DG745x5m8zTn2bOrAb7Q3Gtecq5IDSsbNg2ZTgP%252BEvRg%253D%26%7C%26cpassword%3D%26%7C%26cname%3D%26%7C%26cemail%3D%26%7C%26cemailstatus%3D0%26%7C%26cnickname%3D%26%7C%26ccry%3D.0Cw3J6oaXGE2%26%7C%26cconfirmkey%3D%25241%2524hRqwXhIq%2524Frm.Wvf8Zt8%252FwEe%252FNr6w9%252F%26%7C%26cautologin%3D1%26%7C%26cenglish%3D0%26%7C%26sex%3D%26%7C%26cnamekey%3D%25241%2524PZw%252Fkv1W%2524z45%252Fys8S9jgFvNDxIQs7H1%26%7C%26to%3Dd413055f65dd28767f454a28a3ae87ea68c5841e%26%7C%26; sensor=createDate%3D2025-09-13%26%7C%26identityType%3D1; slife=lowbrowser%3Dnot%26%7C%26lastlogindate%3D20250913%26%7C%26securetime%3DUGxXYwNgVzQCZw82DzAJagY9BTI%253D; sensorsdata2015jssdkcross=%7B%22distinct_id%22%3A%22266821509%22%2C%22first_id%22%3A%22197cf373f844bc-05f11c4dd181708-26011e51-3686400-197cf373f851c10%22%2C%22props%22%3A%7B%22%24latest_traffic_source_type%22%3A%22%E7%9B%B4%E6%8E%A5%E6%B5%81%E9%87%8F%22%2C%22%24latest_search_keyword%22%3A%22%E6%9C%AA%E5%8F%96%E5%88%B0%E5%80%BC_%E7%9B%B4%E6%8E%A5%E6%89%93%E5%BC%80%22%2C%22%24latest_referrer%22%3A%22%22%7D%2C%22identities%22%3A%22eyIkaWRlbnRpdHlfY29va2llX2lkIjoiMTk3Y2YzNzNmODQ0YmMtMDVmMTFjNGRkMTgxNzA4LTI2MDExZTUxLTM2ODY0MDAtMTk3Y2YzNzNmODUxYzEwIiwiJGlkZW50aXR5X2xvZ2luX2lkIjoiMjY2ODIxNTA5In0%3D%22%2C%22history_login_id%22%3A%7B%22name%22%3A%22%24identity_login_id%22%2C%22value%22%3A%22266821509%22%7D%2C%22%24device_id%22%3A%22197cf373f844bc-05f11c4dd181708-26011e51-3686400-197cf373f851c10%22%7D; partner=www_baidu_com; seo_refer_info_2023=%7B%22referUrl%22%3A%22https%3A%5C%2F%5C%2Fwww.baidu.com%5C%2Flink%3Furl%3DtxTWdUwgHwpk1VFT9aUknOA-dw2OcDll5C-YCh_Hbtr3Qr1_s7XaQ2m8qj0twbdX%26wd%3D%26eqid%3Dc45b2b7b000068ac0000000368c582f5%22%2C%22referHost%22%3A%22www.baidu.com%22%2C%22landUrl%22%3A%22%5C%2F%22%2C%22landHost%22%3A%22jobs.51job.com%22%2C%22partner%22%3Anull%7D; Hm_lpvt_1370a11171bd6f2d9b1fe98951541941=1757774911; acw_tc=ac11000117577772986888370e0098db571e52cd1eccc5e688a9ac302b248c; acw_sc__v2=68c58d92111d186a9a86d5c125da66bc2af73673; JSESSIONID=6477364AFFFB01F6B1CB890043323A19; ssxmod_itna=1-QqGxgDBDyWuAG0D27WG2DIZKD2DmODBP01Dp2xQv508D6DYqGdq2bqzhb3DcABqiwxqtKGYnLxbRxGNoM4xiNDAc40iDC3WLsYYmqG=3YjuEmIXW7igL1sonlyXy4=CFhgyXOMKUlpMsuKqzOoZ/85wzoeDU4GnD06xWW4PxYALDBYD74G_DDeDixGmzeDS3xD9DGPNoZWWxPDEDYPNxA3Di4D_leTDmq4DGTfK6DpioDDlYGO4/gL35AF1knybjAnxna4oleDMixGX9oC4lQ72ovDFcakUv1oQxB=gxBQWdEc56YIi1=cO1mslvse4Xl4wjwImee7DgQGXW0YRKRiDKe_5GAMGD57epiEC70iDGIegxq2Nm0H42lj5/n5V4h52ThfEHz0dCTkFGYAiNghNlx4/2tzr3q2tebeaDkInx=GDD; ssxmod_itna2=1-QqGxgDBDyWuAG0D27WG2DIZKD2DmODBP01Dp2xQv508D6DYqGdq2bqzhb3DcABqiwxqtKGYnLxb4xAEie4ge3x_SD0veD9GZ7nvWeELvNPY/6McNpNH58vTxD',
}





response = requests.get('https://we.51job.com/api/job/search-pc', params=params, cookies=cookies, headers=headers)
print(response.text)
