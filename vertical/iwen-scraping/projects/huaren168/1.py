# https://us168.com/shop-for-transfer?page=2&industryId=1932059931226767361


# 参数： request
        # resp  AES解密

import requests
import execjs,json
from openpyxl import Workbook


wb = Workbook()
sheet = wb.active
sheet.append(['标题','简介','类型','地区'])


def get_ming_resp(mi_resp):
    f = open('get_ming_resp.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    ming_resp = js.call('get_ming',mi_resp)
    return ming_resp


def spider():

    headers = {
        'accept': 'application/json',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'content-type': 'application/json;charset=UTF-8',
        'origin': 'https://us168.com',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://us168.com/',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'x-application-name': 'wf-classify-web',
        'x-device-code': '92978e8adc0e711579d565533666db14',
        'x-source': 'pc',
        'x-timezone': 'GMT+0800',
        'x-version': '6.0.0',
    }

    data = '6c89b51e3af1f732b7a0c420dc668eacc39ba12f5aa77a0c3013aaf1144c818e7926a8da57401d7f895e94a92beef441ba93064ebaca90e74091536559e241ab5416dd54d2279eb2c43e140342cb8d6fc1691af552210d56bf3846f63560fe15'

    response = requests.post(
        'https://p-gateway.us168168.com/wf-classify-web/transferBusiness/query/page',
        headers=headers,
        data=data,
    ).json()
    mi_resp = response['data']
    ming_resp = get_ming_resp(mi_resp)
    # print(ming_resp)
    for data in ming_resp['records']:
        try:
            # print(data)
            # 标题
            bt = data['title'].replace('\n','').replace('\r','').replace(' ','')
            # 简介
            jj = data['description'].replace('\n','').replace('\r','').replace(' ','')
            # 类型
            lx = data['industryName'].replace('\n','').replace('\r','').replace(' ','')
            # 地址
            dz = data['areaName'].replace('\n','').replace('\r','').replace(' ','')
            # print(bt,jj,lx,dz,sep='|')
            sheet.append([bt,jj,lx,dz])
            print(f'{bt}       已保存完成')
        except:
            continue


def main():
    spider()
    wb.save('186数据.xlsx')
    print('*************************全部数据已保存完成*********************************')

if __name__ == '__main__':
    main()