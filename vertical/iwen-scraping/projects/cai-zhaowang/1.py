# https://search.bidcenter.com.cn/search?keywords=%E5%88%80&mod=0

# 返回值解密  AES
import requests
import execjs,json
from openpyxl import Workbook


# 创建excel表格 + 确定表 + 添加表格
wb = Workbook()
sheet = wb.active
sheet.append(['标题','时间','省份','地址'])


def get_ming_resp(mi_response):

    f = open('get_resp.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    ming_res = js.call('o',mi_response)
    ming_resp = json.loads(ming_res)

    return ming_resp


def parse_resp(ming_resp):

    for data in ming_resp['other2']['listData']:
        # 标题
        bt = data['news_title_show']
        # 时间
        sj = data['news_star_time_show']
        # 省份
        sf = data['news_diqustr']
        # 地址
        dz = data['news_url']

        # print(bt,sj,sf,dz,sep='|')
        sheet.append([bt,sj,sf,dz])
        print('保存完成：'.format(bt))




def spider(page):

    headers = {
        'accept': 'text/plain, */*; q=0.01',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'origin': 'https://search.bidcenter.com.cn',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://search.bidcenter.com.cn/',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    }

    data = {
        'from': '6137',
        'guid': '65dc2692-a916-4561-a5de-3c6db8ebddf6',
        'location': '6138',
        'token': '',
        'next_token': '',
        'keywords': '%E5%88%80',
        'mod': '0',
        'page': '{}'.format(page),
    }

    mi_response = requests.post('https://interface.bidcenter.com.cn/search/GetSearchProHandler.ashx', headers=headers,
                             data=data).text
    # print(response)
    ming_resp = get_ming_resp(mi_response)
    # print(ming_resp)
    return ming_resp


def main():

    for page in range(1,6):
        ming_resp = spider(page)
        parse_resp(ming_resp)
    wb.save('采招网数据.xlsx')
    print('********************数据保存完成****************************')

if __name__ == '__main__':
    main()