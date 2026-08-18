import requests
from lxml import etree
import json

cookies = {
    '_xsrf': 'cL1zDNbvPJwI6F38bkPtGSuEwhXZY1Fs',
    '__zse_ck': '004_1l8J=xdFrb7Td/pXjTfVH5bIeVdLZNk8Arxo=sPOcZhGblcRgwjugNaNzrhMsQpu4lVAokdgs7zWcil4DxzYwYbaq9gQfOEMRxL/GMuj5s/k3GNLJb4BESPziHR=RCQc-nQFdaGfDUZ9L/VuY3oELWxw4u0MK7Yg/X2YMcPg01k1C+uoOwLhYsbjy8XSbmudTkyJcyDNUbyNCCe8fArJahW0VLN6ocZ8QnpCmvDnECgMEkdl0f6B8P5DaSATwLQ2e',
    '_zap': 'e345c2fe-8a7f-46a5-922f-977a54681de9',
    'd_c0': 'QoMTY7YKoxqPTn2gMkIhQ9ndkV6zEpQ9uIg=|1750398151',
    'captcha_session_v2': '2|1:0|10:1750398152|18:captcha_session_v2|88:Ui94M1NmWEVYWXhML1RZMk9TTTIxU0JTeTN5b2syZ25SNnhWQkJLb3pvcmQ4UjZsK3phQU9UVCtNODhqL2ZIKw==|b26fd3485205bafba181c90226adc70c0b5a00abbf6605813cca972fb77a3cb5',
    '__snaker__id': '2mj281pq29PthbSY',
    'gdxidpyhxdE': 'EsjB3W%2BZWghd6L%2F%2F2AHCscJXx96DTg1K7fdxi5n6wap63ARHGfT5pnOXXu%5Ctz6DxXmhyKj9GB7RCsN4ctS8Hqdh4qwXfDDvJ0CcB7eJtaIgiGTpB%2F8LhqDN8c43Hlh2Y1L90ISjgDq2bZjH%2F7C3q40Q0smDMeGZuxBcnZs%5CgXJA9vS%5CI%3A1750399054617',
    'q_c1': '6123b55cbebd4451b571d9a4c81420d2|1750398183000|1750398183000',
    'tst': 'r',
    'z_c0': '2|1:0|10:1750398185|4:z_c0|92:Mi4xNVp5RVFBQUFBQUJDZ3hOanRncWpHaGNBQUFCZ0FsVk41MEpDYVFEOGE5TTZmNDR5MWJUOFN1VGxkclhZQm1OUmFB|42471ecab94d6a33a0bcddbacba6fbaae99824e41f254f918ccebbc4db334432',
    'Hm_lvt_98beee57fd2ef70ccdd5ca52b9740c49': '1750398151,1750398199,1750398374',
    'HMACCOUNT': 'DFAFD3DF56213E61',
    'SESSIONID': 'LH9bEoRxk0CzkmWgPutOKnV2Qw2pE5SEq7LEvQQzkSB',
    'JOID': 'W18cC0058d35LGPtMKxGzimVaE8qe7fllWYCsUldz5CCSQG0WZ4LhpAtY-I_vJHgNo7WbDGAEwyulDg_Rz1z8HM=',
    'osd': 'VlEVCkk0_9T4KG7jOa1CwyecaUsndb7kkWsMuEhZwp6LSAW5V5cKgp0jauM7sZ_pN4rbYjiBFwGgnTk7SjN68Xc=',
    'BEC': '92a0fca0e2e4d1109c446d0a990ad863',
    'Hm_lpvt_98beee57fd2ef70ccdd5ca52b9740c49': '1750401905',
}

headers = {
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'priority': 'u=1, i',
    'referer': 'https://www.zhihu.com/search?type=content&q=2008%E5%B9%B4%E9%87%91%E8%9E%8D%E5%8D%B1%E6%9C%BA',
    'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'x-api-version': '3.0.91',
    'x-app-za': 'OS=Web',
    'x-requested-with': 'fetch',
    'x-zse-93': '101_3_3.0',
    'x-zse-96': '2.0_edaNkuoyVqmWFWupz1CZa8UHemWfDI3W6HAQ0pXrGrPmgVJ/G7YkJighge13Ykxm',
    'x-zst-81': '3_2.0aR_sn77yn6O92wOB8hPZnQr0EMYxc4f18wNBUgpTQ6nxERFZG0Y0-4Lm-h3_tufIwJS8gcxTgJS_AuPZNcXCTwxI78YxEM20s4PGDwN8gGcYAupMWufIeQuK7AFpS6O1vukyQ_R0rRnsyukMGvxBEqeCiRnxEL2ZZrxmDucmqhPXnXFMTAoTF6RhRuLPF_NGkgOmiqCyocSpc0NC3vLypUoYNqC1Q93M2he0eJOGjupY9vx1bqH1zcoTv0NM68FYRqcqWb3m3GLVxhL1Rgg8kbUYQvwM2GYYswN1QicBZqSpOC2CWqwYSicG1USmcceMvJS1o7XBEqosUqOBYGo_rAeYaGYmZ9tCY4w0Wwe_OCH9Oqfz2bS8zhSBQweVTUV8qrXKbhVKwqc8ohYB2UoLWJO19qFMIgCYBMYLS4r_EreYT9XCGw282hUMWbLYTbHK3gcLuq91ZUeLgDeBKRYyohpCqwtBQ0e8WwFC',
    # 'cookie': '_xsrf=cL1zDNbvPJwI6F38bkPtGSuEwhXZY1Fs; __zse_ck=004_1l8J=xdFrb7Td/pXjTfVH5bIeVdLZNk8Arxo=sPOcZhGblcRgwjugNaNzrhMsQpu4lVAokdgs7zWcil4DxzYwYbaq9gQfOEMRxL/GMuj5s/k3GNLJb4BESPziHR=RCQc-nQFdaGfDUZ9L/VuY3oELWxw4u0MK7Yg/X2YMcPg01k1C+uoOwLhYsbjy8XSbmudTkyJcyDNUbyNCCe8fArJahW0VLN6ocZ8QnpCmvDnECgMEkdl0f6B8P5DaSATwLQ2e; _zap=e345c2fe-8a7f-46a5-922f-977a54681de9; d_c0=QoMTY7YKoxqPTn2gMkIhQ9ndkV6zEpQ9uIg=|1750398151; captcha_session_v2=2|1:0|10:1750398152|18:captcha_session_v2|88:Ui94M1NmWEVYWXhML1RZMk9TTTIxU0JTeTN5b2syZ25SNnhWQkJLb3pvcmQ4UjZsK3phQU9UVCtNODhqL2ZIKw==|b26fd3485205bafba181c90226adc70c0b5a00abbf6605813cca972fb77a3cb5; __snaker__id=2mj281pq29PthbSY; gdxidpyhxdE=EsjB3W%2BZWghd6L%2F%2F2AHCscJXx96DTg1K7fdxi5n6wap63ARHGfT5pnOXXu%5Ctz6DxXmhyKj9GB7RCsN4ctS8Hqdh4qwXfDDvJ0CcB7eJtaIgiGTpB%2F8LhqDN8c43Hlh2Y1L90ISjgDq2bZjH%2F7C3q40Q0smDMeGZuxBcnZs%5CgXJA9vS%5CI%3A1750399054617; q_c1=6123b55cbebd4451b571d9a4c81420d2|1750398183000|1750398183000; tst=r; z_c0=2|1:0|10:1750398185|4:z_c0|92:Mi4xNVp5RVFBQUFBQUJDZ3hOanRncWpHaGNBQUFCZ0FsVk41MEpDYVFEOGE5TTZmNDR5MWJUOFN1VGxkclhZQm1OUmFB|42471ecab94d6a33a0bcddbacba6fbaae99824e41f254f918ccebbc4db334432; Hm_lvt_98beee57fd2ef70ccdd5ca52b9740c49=1750398151,1750398199,1750398374; HMACCOUNT=DFAFD3DF56213E61; SESSIONID=LH9bEoRxk0CzkmWgPutOKnV2Qw2pE5SEq7LEvQQzkSB; JOID=W18cC0058d35LGPtMKxGzimVaE8qe7fllWYCsUldz5CCSQG0WZ4LhpAtY-I_vJHgNo7WbDGAEwyulDg_Rz1z8HM=; osd=VlEVCkk0_9T4KG7jOa1CwyecaUsndb7kkWsMuEhZwp6LSAW5V5cKgp0jauM7sZ_pN4rbYjiBFwGgnTk7SjN68Xc=; BEC=92a0fca0e2e4d1109c446d0a990ad863; Hm_lpvt_98beee57fd2ef70ccdd5ca52b9740c49=1750401905',
}

params = {
    'gk_version': 'gz-gaokao',
    't': 'general',
    'q': '2008年金融危机',
    'correction': '1',
    'offset': '20',
    'limit': '20',
    'filter_fields': '',
    'lc_idx': '19',
    'show_all_topics': '0',
    'search_hash_id': 'd2987c1b667be65564a8cfd74088c69e',
    'search_source': 'Normal',
    'vertical_info': '0,0,0,0,0,0,0,0,0,2,0,0',
}

r = requests.get('https://www.zhihu.com/api/v4/search_v3', params=params, cookies=cookies, headers=headers)
# print(r.text)

resp = r.text

try:
    parsed_data = json.loads(resp)
except json.JSONDecodeError as e:
    print("JSON 解析错误:", e)
    parsed_data = None

# 提取 title 和 content
if parsed_data and "data" in parsed_data:
    for item in parsed_data["data"]:
        if "object" in item and "title" in item["object"] and "content" in item["object"]:
            title = item["object"]["title"]
            content = item["object"]["content"]
            print("标题:", title)
            print("内容:", content)
            print("-" * 50)
else:
    print("数据格式不正确或没有找到 'data' 键")

