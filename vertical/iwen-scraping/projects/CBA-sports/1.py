# http://cbaleague.com/data/#/teams

# AES 返回数据加密
import requests
import execjs
import os.path
from copy import copy
import xlrd
import xlwt


class spider(object):
    def __init__(self):
        # 初始化部分
        self.players_url = 'https://data-server.cbaleague.com/api/teams/{}/seasons/2024/players'
        self.teamlist_url = 'https://data-server.cbaleague.com/api/teams/teamList'
        self.headers = {
            "accept": "application/json, text/plain, */*",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "zh-CN,zh;q=0.9",
            "cache-control": "no-cache",
            "isencrypt": "encrypt",
            "origin": "http://cbaleague.com",
            "pragma": "no-cache",
            "priority": "u=1, i",
            "referer": "http://cbaleague.com/",
            "sec-ch-ua": "\"Chromium\";v=\"140\", \"Not=A?Brand\";v=\"24\", \"Google Chrome\";v=\"140\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "cross-site",
            "sec-fetch-storage-access": "active",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
        }


    def get_teamlist_ming(self,teamlist_resp):
        # 解密球队/球员列表信息
        f = open('get_ming_data.js','r',encoding='utf-8')
        js_code = f.read()
        f.close()
        js = execjs.compile(js_code)

        ming_teamlist = js.call('a5e',teamlist_resp)
        return ming_teamlist


    def request_teamlist_url(self):
        # 发送球队列表页请求
        teamlist_resp = requests.get(self.teamlist_url,headers=self.headers).text
        # 去掉密文两端引号
        teamlist_resp = teamlist_resp[1:-1]
        # print(teamlist_resp)
        ming_teamlist = self.get_teamlist_ming(teamlist_resp)
        # print(ming_teamlist)
        # 解析列表页数据
        for team in ming_teamlist:
            team_name = team['club']
            team_id = team['teamId']
            # print(team_name,team_id)
            self.request_team_mi_data(team_name,team_id)

    def request_team_mi_data(self,team_name,team_id):
        # 请求每个球队的球员信息
        playser_data_resp = requests.get(self.players_url.format(team_id),headers=self.headers).json()
        # print(playser_data_resp)
        resp_ming_playser = self.get_teamlist_ming(playser_data_resp)
        # print(resp_ming_playser)
        # 解析球员信息
        for playser in resp_ming_playser:
            # 球队名称
            qd = playser['teamCnName']
            # 球衣号
            hm = playser['number']
            # 姓名
            mz = playser['cnName']
            # 年龄
            nl = playser['age']
            # 生日
            sr = playser['birthDate']
            # 身高
            sg = playser['height']
            # 体重
            tz = playser['weight']
            # 位置
            wz = playser['position']
            # 国家
            gj = playser['nationality']
            # print(qd,hm,mz,nl,sr,sg,tz,wz,gj,sep='|')

            """
                使用模板 保存到excel
                1.构造一个字典
                2.调用保存函数
                3.表明 = 键名
                4.修改表头
                5.修改打印
            """
            item = {
                team_name:[qd,hm,mz,nl,sr,sg,tz,wz,gj]
            }
            self.save_data(item,team_name,mz)

    def save_data(self,item,team_name,mz):
        # 保存函数
        sheet_name = team_name
        if not os.path.exists(r'./CBA球员数据.xls'):
            # 1.创建Excel文件
            wb = xlwt.Workbook()
            # 2.创建新的Sheet表
            sheet = wb.add_sheet(sheet_name, cell_overwrite_ok=True)
            # 3.设置表头信息，遍历写入数据，保存数据
            header = ('球队名称', '球衣号', '姓名', '年龄', '生日', '身高', '体重', '位置', '国家')
            for i in range(0, len(header)):
                sheet.col(i).width = 2560 * 3
                #          行 列 内容
                sheet.write(0, i, header[i])
            wb.save(r'./CBA球员数据.xls')
        wb = xlrd.open_workbook(r'./CBA球员数据.xls')
        # 获取工作簿所有表的名称
        sheets_list = wb.sheet_names()
        # 如果表名称：字典的key值不在工作簿的表明列表中
        if sheet_name not in sheets_list:
            # 复制先有的工作簿名称
            work = copy(wb)
            # 通过复制过来的工作簿对象，创建新表--保留原有表结构
            sh = work.add_sheet(sheet_name)
            # 给新表设置表头
            header_new = ('球队名称', '球衣号', '姓名', '年龄', '生日', '身高', '体重', '位置', '国家')
            for index in range(0, len(header_new)):
                sh.col(index).width = 2560 * 3
                #        行  列    内容
                sh.write(0, index, header_new[index])
            work.save(r'./CBA球员数据.xls')
        # 判断工作表是否存在
        if os.path.exists(r'./CBA球员数据.xls'):
            # 打开工作簿
            wb = xlrd.open_workbook(r'./CBA球员数据.xls')
            # 获取工作簿中所有表的个数
            sheets = wb.sheet_names()
            for i in range(len(sheets)):
                for name in item.keys():
                    worksheet = wb.sheet_by_name(sheets[i])
                    # 获取工作薄中所有表中的表名与数据名对比
                    if worksheet.name == name:
                        # 获取表中已存在的行数
                        rows_old = worksheet.nrows
                        # 将xlrd对象拷贝转化为xlwt对象
                        new_workbook = copy(wb)
                        # 获取转化后的工作薄中的第i张表
                        new_worksheet = new_workbook.get_sheet(i)
                        for num in range(0, len(item[name])):
                            new_worksheet.write(rows_old, num, item[name][num])
                        new_workbook.save(r'./CBA球员数据.xls')
        print(r'***正在保存:第{}条电影信息数据:{}'.format(team_name, mz))


    def main(self):
        # 控制逻辑
        self.request_teamlist_url()

if __name__ == '__main__':
    cba = spider()
    cba.main()