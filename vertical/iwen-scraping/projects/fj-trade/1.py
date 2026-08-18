# https://ggzyfw.fj.gov.cn/business/list/

# 参数：portal-sign (md5) /  返回数据加密 AES
import json
from openpyxl import Workbook
import requests,time,execjs



# 创建表 确定表  添加表格

wb = Workbook()
sheet = wb.active
sheet.append(['标题','平台','时间','地区','类型'])

def get_ming_resp(mi_resp):
    f = open('get_ming_resp.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    ming_resp = js.call('b',mi_resp)
    return ming_resp


def get_sign(ti,page):
    f = open('get_sign.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    sign = js.call('get_sign',ti,page)
    return sign


def spider(page):

    stamps = int(time.time()*1000)
    # print(stamps)
    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json;charset=UTF-8',
        'Origin': 'https://ggzyfw.fj.gov.cn',
        'Pragma': 'no-cache',
        'Referer': 'https://ggzyfw.fj.gov.cn/business/list/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'portal-sign': get_sign(stamps,page),
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
    }

    json_data = {
        'pageNo': page,
        'pageSize': 20,
        'total': 3227,
        'AREACODE': '',
        'M_PROJECT_TYPE': '',
        'KIND': 'GCJS',
        'GGTYPE': '1',
        'PROTYPE': '',
        'timeType': '6',
        'BeginTime': '2025-03-19 00:00:00',
        'EndTime': '2025-09-19 23:59:59',
        'createTime': '',
        'ts': stamps,
    }

    response = requests.post('https://ggzyfw.fj.gov.cn/FwPortalApi/Trade/TradeInfo', headers=headers, json=json_data).json()
    mi_resp = response['Data']
    # print(mi_resp)
    ming_resp = get_ming_resp(mi_resp)
    # print(ming_resp)
    if type(ming_resp) == str:
        ming_resp = json.loads(ming_resp)
        # print(type(ming_resp))

        for data in ming_resp['Table']:
            try:
                # print(data)
                # 标题
                bt = data['NAME']
                # 平台名称
                pt = data['PLATFORM_NAME']
                # 时间
                sj = data['TM1']
                # 地区
                dq = data['AREANAME']
                # 类型
                lx = data['PROTYPE_TEXT']
                # print(bt,pt,sj,dq,lx,sep='|')
                sheet.append([bt,pt,sj,dq,lx])
                print(f'{bt}       保存完成')
            except:
                continue


def mian():
    for page in range(1,21):
        spider(page)
    wb.save('福建公共资源交易数据.xlsx')
    print('*******************数据保存完成**************************')


if __name__ == '__main__':
    mian()