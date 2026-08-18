# https://www.kaogujia.com/darenSquare/darenList

# 返回解密


import requests,execjs,json,pymysql


class DrSpider(object):

    def __init__(self):
        # 初始化
        self.url = 'https://service.kaogujia.com/api/author/search'
        # -------------------连接mysql+创建游标+创建数据库------------------------
        # 连接数据库
        self.db = pymysql.connect(
            host='localhost',
            port=3306,
            user='root',
            password='123456',
            db = '练习',
            charset='utf8'
        )
        # 创建游标
        self.cursor = self.db.cursor()
        table_sql = \
        """
            create table if not exists 达人表(
                达人   varchar (50),
                粉丝数   varchar (50),
                新增粉丝   varchar (50),
                销售额   varchar (50),
                平均单价   varchar (50),
                平均观看人次   varchar (50),
                平均播放量   varchar (50),
                直播销量   varchar (50),
                RPM  varchar (50)
            )
        """
        self.cursor.execute(table_sql)

    def spider(self,page):
        headers = {
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Authorization': 'Bearer eyJhbGciOiJIUzUxMiJ9.eyJhdWQiOiIxMDAwIiwiaXNzIjoia2FvZ3VqaWEuY29tIiwianRpIjoiNmQ4NTljNzFlZGUyNDQ1ZGE5Y2M3MDBiOGQ0YTI4ODQiLCJzaWQiOjg2MjIzMzksImlhdCI6MTc2Mjc1NDMzNywiZXhwIjoxNzYzMzU5MTM3LCJid2UiOjAsInR5cCI6MSwicF9id2UiOjB9.N_oHt7a0EUg0DiKfVbTnMiqPLqRFgU6De8zafreFDDMrPeCkoSPWAN8DRC5PCll3RmHbAAQQ_aGETEVi-ugWLA',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Content-Type': 'application/json',
            'Origin': 'https://www.kaogujia.com',
            'Pragma': 'no-cache',
            'Referer': 'https://www.kaogujia.com/',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-site',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'version_code': '3.1',
        }
        params = {
            'limit': '50',
            'page': page,
            'sort_field': 'gmv',
            'sort': '0',
        }

        json_data = {
            'keyword': '',
            'author_type': 0,
        }

        response = requests.post(self.url, params=params, headers=headers,json=json_data).json()
        response = response['data']
        # print(response)
        ming = self.get_resp_data(response)
        # print(ming)
        self.jiexi(ming)


    def get_resp_data(self,response):
        f = open('get_ming.js','r',encoding='utf-8')
        js_code = f.read()
        f.close()
        js = execjs.compile(js_code)

        ming = js.call('get_ming_data',response)
        # print(ming)
        ming = json.loads(ming)
        return ming

    def jiexi(self,ming):
        items = ming['items']
        for item in items:
            # 达人
            dr = item['nick_name']
            # 粉丝数
            fss = item['fans']
            # 新增粉丝
            xzfs = item['inc_fans']
            # 销售额
            xse = item['gmv']
            # 平均单价
            dj = item['aup']
            # 平均观看人次
            rc = item['avg_total_users']
            # 平均播放量
            bfl = item['avg_play_count']
            # 直播销量
            xl = item['live_sales']
            # RPM
            rpm = item['rpm']
            print(dr,fss,xzfs,xse,dj,rc,bfl,xl,rpm)
            self.insert_data(dr,fss,xzfs,xse,dj,rc,bfl,xl,rpm)

    def insert_data(self,dr,fss,xzfs,xse,dj,rc,bfl,xl,rpm):
        insert_sql = \
        """
            insert into 达人表 values ("{}", "{}", "{}", "{}", "{}", "{}", "{}", "{}", "{}")
        """.format(dr,fss,xzfs,xse,dj,rc,bfl,xl,rpm)

        try:
            self.cursor.execute(insert_sql)
            print('插入完成')
        except Exception as e:
            print('这个数据插入失败：{}'.format(dr),e)

    def confrim_mysql(self):
        # 数据库的提交关闭
        self.cursor.close()
        self.db.commit()
        self.db.close()

    def main(self):
        # 控制逻辑
        for page in range(1,11):
            self.spider(page)
            print(f'第{page}页提交完成!!!')
        self.confrim_mysql()


if __name__ == '__main__':
    dr = DrSpider()
    dr.main()