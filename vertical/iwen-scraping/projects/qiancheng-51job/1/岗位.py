import execjs
import requests
from urllib.parse import urlencode
import time
import json

f = open('sign值.js', mode='r', encoding='utf-8')
sign_ = f.read()
f.close()
sign_s = execjs.compile(sign_)

# 密码登录
# login_url = 'https://vapi.51job.com/open.php?apiversion=400&clientid=000011&module=initgeetest'

# 获取时间戳
ti = time.time()
tim = str(ti)[0:10]
# print(tim)


cookies = {
    'sajssdk_2015_cross_new_user': '1',
    'guid': '0becb2948aa3f23b7992d58bd8bf53e4',
    'sensorsdata2015jssdkcross': '%7B%22distinct_id%22%3A%220becb2948aa3f23b7992d58bd8bf53e4%22%2C%22first_id%22%3A%22197cf373f844bc-05f11c4dd181708-26011e51-3686400-197cf373f851c10%22%2C%22props%22%3A%7B%22%24latest_traffic_source_type%22%3A%22%E7%9B%B4%E6%8E%A5%E6%B5%81%E9%87%8F%22%2C%22%24latest_search_keyword%22%3A%22%E6%9C%AA%E5%8F%96%E5%88%B0%E5%80%BC_%E7%9B%B4%E6%8E%A5%E6%89%93%E5%BC%80%22%2C%22%24latest_referrer%22%3A%22%22%7D%2C%22identities%22%3A%22eyIkaWRlbnRpdHlfY29va2llX2lkIjoiMTk3Y2YzNzNmODQ0YmMtMDVmMTFjNGRkMTgxNzA4LTI2MDExZTUxLTM2ODY0MDAtMTk3Y2YzNzNmODUxYzEwIiwiJGlkZW50aXR5X2xvZ2luX2lkIjoiMGJlY2IyOTQ4YWEzZjIzYjc5OTJkNThiZDhiZjUzZTQifQ%3D%3D%22%2C%22history_login_id%22%3A%7B%22name%22%3A%22%24identity_login_id%22%2C%22value%22%3A%220becb2948aa3f23b7992d58bd8bf53e4%22%7D%2C%22%24device_id%22%3A%22197cf373f844bc-05f11c4dd181708-26011e51-3686400-197cf373f851c10%22%7D',
    'Hm_lvt_1370a11171bd6f2d9b1fe98951541941': '1751528578',
    'Hm_lpvt_1370a11171bd6f2d9b1fe98951541941': '1751528578',
    'HMACCOUNT': 'F4037280F82AFFB1',
    'acw_tc': 'ac11000117515343304866939e0093019feb0dba6817acd271e5999c9e05f5',
    'acw_sc__v2': '6867974915dbe0169bc80cd2c7f5cc3ee0151b81',
    'JSESSIONID': '9D4F02178C6DFDB50826DD0CD0705A15',
    'ssxmod_itna': 'QqGxgDBDyWuAG0D27WG2DIZKD2DmODBP01Dp2xQv508D6DYqGdq23zhb3DcYENDiw+H3AAYnd4BD0HXiDnqD86DQeDv4cS5+mbD7w44lB2CAxo5ccpDusVFk7GxReaUzZLnLpn/zzI2sgAiDB3DbqDyKYio4eGGf4GwDGoD34DiDDPDbSiDALeD7qDFjmuNxPTDm4GWjeGfDDoDYRbYxitYDDtA3n4WRmDD0wD+oBvU8CGFp6ikd2+t5iFom0bDjqPD/bvjo0RCcIk4YaFEEzapGeGyW5GuD6mbNn+7RnniHZAsWSps4oEHGGiAwVYxe7DyQGUBXxGDeAwHlD1l0wmDKcp5l+PZNC0rDne5gbH42NlbYFvMGvlAHYe7HfqQ6TYRA8bu4e2+9rND4qnhxf0DVg4P4e2xD=GDD',
    'ssxmod_itna2': 'QqGxgDBDyWuAG0D27WG2DIZKD2DmODBP01Dp2xQv508D6DYqGdq23zhb3DcYENDiw+H3AAYnd4hDnWAm=qcQY44DBT4DkQip0LP8oDnfiLH6fMpaneWA0fe4apQ7MLhF=AM/94AEQDya5hwGg0wNx=GtKW2TopndBYD',
}

# 参数
params = {
    'api_key': '51job',
    'timestamp': tim,
    'keyword': '爬虫',
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
    'pageNum': '4',
    'requestId': '',
    'pageSize': '20',
    'source': '1',
    'accountId': '',
    'pageCode': 'sou|sou|soulb',
    'scene': '7',
}


dizhi = '/api/job/search-pc?' + urlencode(params)
sign_str = sign_s.call('fn',dizhi)
sign = sign_str['headers']['sign']
# print(sign)

headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'account-id': '',
    'cache-control': 'no-cache',
    'from-domain': '51job_web',
    'partner': '',
    'pragma': 'no-cache',
    'priority': 'u=1, i',
    'property': '%7B%22partner%22%3A%22%22%2C%22webId%22%3A2%2C%22fromdomain%22%3A%2251job_web%22%2C%22frompageUrl%22%3A%22https%3A%2F%2Fwe.51job.com%2F%22%2C%22pageUrl%22%3A%22https%3A%2F%2Fwe.51job.com%2Fpc%2Fsearch%22%2C%22identityType%22%3A%22%22%2C%22userType%22%3A%22%22%2C%22isLogin%22%3A%22%E5%90%A6%22%2C%22accountid%22%3A%22%22%2C%22keywordType%22%3A%22%E7%9B%B4%E6%8E%A5%E8%BE%93%E5%85%A5%22%7D',
    'referer': 'https://we.51job.com/pc/search',
    'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'sign': sign,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'user-token': '',
    'uuid': '0becb2948aa3f23b7992d58bd8bf53e4',
    # 'cookie': 'sajssdk_2015_cross_new_user=1; guid=0becb2948aa3f23b7992d58bd8bf53e4; sensorsdata2015jssdkcross=%7B%22distinct_id%22%3A%220becb2948aa3f23b7992d58bd8bf53e4%22%2C%22first_id%22%3A%22197cf373f844bc-05f11c4dd181708-26011e51-3686400-197cf373f851c10%22%2C%22props%22%3A%7B%22%24latest_traffic_source_type%22%3A%22%E7%9B%B4%E6%8E%A5%E6%B5%81%E9%87%8F%22%2C%22%24latest_search_keyword%22%3A%22%E6%9C%AA%E5%8F%96%E5%88%B0%E5%80%BC_%E7%9B%B4%E6%8E%A5%E6%89%93%E5%BC%80%22%2C%22%24latest_referrer%22%3A%22%22%7D%2C%22identities%22%3A%22eyIkaWRlbnRpdHlfY29va2llX2lkIjoiMTk3Y2YzNzNmODQ0YmMtMDVmMTFjNGRkMTgxNzA4LTI2MDExZTUxLTM2ODY0MDAtMTk3Y2YzNzNmODUxYzEwIiwiJGlkZW50aXR5X2xvZ2luX2lkIjoiMGJlY2IyOTQ4YWEzZjIzYjc5OTJkNThiZDhiZjUzZTQifQ%3D%3D%22%2C%22history_login_id%22%3A%7B%22name%22%3A%22%24identity_login_id%22%2C%22value%22%3A%220becb2948aa3f23b7992d58bd8bf53e4%22%7D%2C%22%24device_id%22%3A%22197cf373f844bc-05f11c4dd181708-26011e51-3686400-197cf373f851c10%22%7D; Hm_lvt_1370a11171bd6f2d9b1fe98951541941=1751528578; Hm_lpvt_1370a11171bd6f2d9b1fe98951541941=1751528578; HMACCOUNT=F4037280F82AFFB1; acw_tc=ac11000117515343304866939e0093019feb0dba6817acd271e5999c9e05f5; acw_sc__v2=68664afa74738fb1dd80298859bafe6dc78e5781; JSESSIONID=9D4F02178C6DFDB50826DD0CD0705A15; ssxmod_itna=QqGxgDBDyWuAG0D27WG2DIZKD2DmODBP01Dp2xQv508D6DYqGdq23zhb3DcYENDiw+H3AAYnd4BD0HXiDnqD86DQeDv4cS5+mbD7w44lB2CAxo5ccpDusVFk7GxReaUzZLnLpn/zzI2sgAiDB3DbqDyKYio4eGGf4GwDGoD34DiDDPDbSiDALeD7qDFjmuNxPTDm4GWjeGfDDoDYRbYxitYDDtA3n4WRmDD0wD+oBvU8CGFp6ikd2+t5iFom0bDjqPD/bvjo0RCcIk4YaFEEzapGeGyW5GuD6mbNn+7RnniHZAsWSps4oEHGGiAwVYxe7DyQGUBXxGDeAwHlD1l0wmDKcp5l+PZNC0rDne5gbH42NlbYFvMGvlAHYe7HfqQ6TYRA8bu4e2+9rND4qnhxf0DVg4P4e2xD=GDD; ssxmod_itna2=QqGxgDBDyWuAG0D27WG2DIZKD2DmODBP01Dp2xQv508D6DYqGdq23zhb3DcYENDiw+H3AAYnd4hDnWAm=qcQY44DBT4DkQip0LP8oDnfiLH6fMpaneWA0fe4apQ7MLhF=AM/94AEQDya5hwGg0wNx=GtKW2TopndBYD',
}

response = requests.get('https://we.51job.com/api/job/search-pc', params=params, cookies=cookies, headers=headers)
print(response.text)
# print(sign)