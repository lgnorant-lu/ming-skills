# https://www.ouyeel.com/xhb/

import requests,execjs,json,time,pymysql
from lxml import etree
from loguru import logger


# 初始化
list_url = 'https://www.ouyeel.com/search-ng/xhb/xhbSearch/queryAllResult'
headers = {
'Accept': 'application/json, text/plain, */*',
"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
'Origin': 'https://www.ouyeel.com',
'Referer': 'https://www.ouyeel.com/search-ng/exchange/search/?categorySummary=C8',
'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
}
sission = requests.session()
# 建立数据库
coon = pymysql.connect(
    host='localhost',
    user='root',
    password='123456',
    port=3306,
    database='数据1',
    charset='utf8mb4'
)

# 游标
cursor = coon.cursor()
# 创建表
table_sql = """
create table if not exists 欧冶_data(
    id int primary key auto_increment,
    标题 varchar(255),
    竞价模式 varchar(50),
    计费方式 varchar(50),
    材质 text,
    规格 varchar(255),
    数量 varchar(100),
    保证金 varchar(100),
    当前价 varchar(100),
    商铺 varchar(255),
    存放地 varchar(255)
)
"""
cursor.execute(table_sql)

def fetch1(list_url,headers):
    response = sission.post(list_url, headers=headers, )
    # print(response)
    html = etree.HTML(response.text)
    content_str = html.xpath('//meta[2]/@content')[0]
    ts_js = html.xpath('//script/text()')[0]
    auto_url = 'https://www.ouyeel.com' + html.xpath('//script[2]/@src')[0]
    # print(content_str)
    # print(ts_js)
    # print(auto_url)
    auto_js = sission.get(auto_url, headers=headers).text
    # print(auto_js)
    return content_str, ts_js, auto_js


def get_cookie2(content_str, ts_js, auto_js):
    with open(r'E:\爬虫\web\AAA_王总的web项目\欧冶\协议\2\最终动态环境.js','r',encoding='utf-8')as f:
        js_code = f.read()
    js_code = js_code.replace('meta_content',content_str).replace("'ts_js'",ts_js).replace("'auto_js'",auto_js)
    js_compile = execjs.compile(js_code)
    cookie2 = js_compile.call('get_cookie2')
    # print(cookie2)
    cookie2_key_value = cookie2.split(';')[0].split('=')
    sission.cookies.update({cookie2_key_value[0]:cookie2_key_value[1]})


def fetch2(page):
    data = {
        'criteriaJson': '{"jsonParam":{"boundleType":"10","bidBeginDate":"2026-04-27"},"pageIndex":%d,"pageSize":50}' % page}
    response2 = sission.post(list_url, headers=headers, data=data)
    # print(response2)
    resultList_str = response2.json().get('resultList')
    rest_lise = json.loads(resultList_str)
    try:
        for rest_a in rest_lise:
            title = rest_a['specComment']
            jin_jia_mo_shi = '公开增价'
            ji_fei_fang_shi = '重量计价'
            cai_zhi = rest_a['orinSpecComment']
            gui_ge = rest_a['spec']
            shu_laing = str(rest_a['boundleTotalWeight'])+rest_a['weightUnit']
            bao_zheng_jin = str(rest_a['boundleEarnestAmt'])+'元'
            dang_qian_jia = str(rest_a['boundleStartingPrice'])+'元/吨'
            shang_pu = rest_a['providerName']
            cun_fang_di = rest_a['storeCityName']
            # 日志打印
            logger.info('标题：{}，竞价模式：{}，计费方式：{}，材质：{}，规格：{}，数量：{}，保证金：{}，当前价：{}，商铺：{}，存放地：{}',title,jin_jia_mo_shi,ji_fei_fang_shi,cai_zhi,gui_ge,shu_laing,bao_zheng_jin,dang_qian_jia,shang_pu,cun_fang_di)

            # 写进数据库
            sql = '''
            insert into 欧冶_data(
            标题,
            竞价模式,
            计费方式,
            材质,
            规格,
            数量,
            保证金,
            当前价,
            商铺,
            存放地
            )
            values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            '''
            values = (
                title,
                jin_jia_mo_shi,
                ji_fei_fang_shi,
                cai_zhi,
                gui_ge,
                shu_laing,
                bao_zheng_jin,
                dang_qian_jia,
                shang_pu,
                cun_fang_di)
            # 执行sql
            cursor.execute(sql, values)
        # 提交
        coon.commit()
        logger.success(f'第{page}页保存成功')
    except Exception as e:
        logger.error(e)
        # 回滚
        coon.rollback()


def main():
    for page in range(1,20):
        # 第一次请求
        content_str, ts_js, auto_js = fetch1(list_url,headers)
        # 拿到3个动态值生成动态cookie
        get_cookie2(content_str, ts_js, auto_js)
        # 第二次请求拿数据
        logger.error(f'正在爬取第{page}页数据')
        time.sleep(3)
        fetch2(page)


if __name__ == '__main__':
    main()
    cursor.close()
    coon.close()
