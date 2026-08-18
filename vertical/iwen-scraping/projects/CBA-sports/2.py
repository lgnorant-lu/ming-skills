# http://cbaleague.com/data/#/teams

# AES 返回数据加密
import requests
import execjs
import os.path
from xlutils.copy import copy
import xlrd
import xlwt
import time
import logging
from typing import Dict, List, Any, Optional

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("cba_spider.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class Spider(object):
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
        self.max_retries = 3
        self.retry_delay = 2  # 秒

    def safe_request(self, url: str, method: str = 'GET', **kwargs) -> Optional[requests.Response]:
        """安全的网络请求，包含重试机制"""
        for attempt in range(self.max_retries):
            try:
                response = requests.request(method, url, headers=self.headers, timeout=30, **kwargs)
                response.raise_for_status()  # 如果状态码不是200，抛出异常
                return response
            except requests.exceptions.RequestException as e:
                logger.warning(f"请求失败 (尝试 {attempt + 1}/{self.max_retries}): {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(self.retry_delay * (attempt + 1))  # 递增延迟
                else:
                    logger.error(f"请求 {url} 失败，已达到最大重试次数")
                    return None
        return None

    def get_teamlist_ming(self, teamlist_resp: str) -> Optional[Any]:
        """解密球队/球员列表信息"""
        try:
            with open('get_ming_data.js', 'r', encoding='utf-8') as f:
                js_code = f.read()

            js = execjs.compile(js_code)
            ming_teamlist = js.call('a5e', teamlist_resp)
            return ming_teamlist
        except FileNotFoundError:
            logger.error("JavaScript解密文件 'get_ming_data.js' 未找到")
            return None
        except execjs.RuntimeError as e:
            logger.error(f"JavaScript执行错误: {e}")
            return None
        except Exception as e:
            logger.error(f"解密过程中发生未知错误: {e}")
            return None

    def request_teamlist_url(self) -> bool:
        """发送球队列表页请求"""
        try:
            response = self.safe_request(self.teamlist_url)
            if response is None:
                return False

            teamlist_resp = response.text
            # 去掉密文两端引号
            teamlist_resp = teamlist_resp[1:-1]

            ming_teamlist = self.get_teamlist_ming(teamlist_resp)
            if ming_teamlist is None:
                return False

            # 解析列表页数据
            for team in ming_teamlist:
                team_name = team.get('club', '未知球队')
                team_id = team.get('teamId')

                if team_id is None:
                    logger.warning(f"跳过球队 {team_name}，缺少teamId")
                    continue

                logger.info(f"开始处理球队: {team_name} (ID: {team_id})")
                self.request_team_mi_data(team_name, team_id)

            return True
        except Exception as e:
            logger.error(f"处理球队列表时发生错误: {e}")
            return False

    def request_team_mi_data(self, team_name: str, team_id: str) -> None:
        """请求每个球队的球员信息"""
        try:
            response = self.safe_request(self.players_url.format(team_id))
            if response is None:
                return

            playser_data_resp = response.json()
            resp_ming_playser = self.get_teamlist_ming(playser_data_resp)

            if resp_ming_playser is None:
                logger.warning(f"球队 {team_name} 的解密数据为空")
                return

            # 解析球员信息
            for player in resp_ming_playser:
                try:
                    # 使用get方法避免KeyError
                    qd = player.get('teamCnName', '')
                    hm = player.get('number', '')
                    mz = player.get('cnName', '未知球员')
                    nl = player.get('age', '')
                    sr = player.get('birthDate', '')
                    sg = player.get('height', '')
                    tz = player.get('weight', '')
                    wz = player.get('position', '')
                    gj = player.get('nationality', '')

                    # 跳过无效数据
                    if not mz or mz == '未知球员':
                        continue

                    item = {
                        team_name: [qd, hm, mz, nl, sr, sg, tz, wz, gj]
                    }
                    self.save_data(item, team_name, mz)
                except Exception as e:
                    logger.error(f"处理球员数据时发生错误: {e}, 数据: {player}")
                    continue

        except Exception as e:
            logger.error(f"请求球队 {team_name} 数据时发生错误: {e}")

    def save_data(self, item: Dict, team_name: str, mz: str) -> bool:
        """保存函数"""
        try:
            sheet_name = team_name
            file_path = r'./CBA球员数据.xls'

            if not os.path.exists(file_path):
                try:
                    # 1.创建Excel文件
                    wb = xlwt.Workbook()
                    # 2.创建新的Sheet表
                    sheet = wb.add_sheet(sheet_name, cell_overwrite_ok=True)
                    # 3.设置表头信息，遍历写入数据，保存数据
                    header = ('球队名称', '球衣号', '姓名', '年龄', '生日', '身高', '体重', '位置', '国家')
                    for i in range(0, len(header)):
                        sheet.col(i).width = 2560 * 3
                        sheet.write(0, i, header[i])
                    wb.save(file_path)
                    logger.info(f'创建新文件并保存{team_name}球队数据')
                except Exception as e:
                    logger.error(f"创建Excel文件失败: {e}")
                    return False

            # 打开已存在的工作簿
            try:
                rb = xlrd.open_workbook(file_path, formatting_info=True)
            except Exception as e:
                logger.error(f"打开工作簿失败: {e}")
                return False

            sheets_list = rb.sheet_names()

            # 如果工作表不存在，添加新工作表
            if sheet_name not in sheets_list:
                try:
                    wb = copy(rb)
                    sheet = wb.add_sheet(sheet_name)
                    header = ('球队名称', '球衣号', '姓名', '年龄', '生日', '身高', '体重', '位置', '国家')
                    for i in range(0, len(header)):
                        sheet.col(i).width = 2560 * 3
                        sheet.write(0, i, header[i])
                    wb.save(file_path)
                    logger.info(f'添加新工作表{sheet_name}')
                    # 重新打开工作簿以获取更新后的工作表列表
                    rb = xlrd.open_workbook(file_path, formatting_info=True)
                    sheets_list = rb.sheet_names()
                except Exception as e:
                    logger.error(f"添加新工作表失败: {e}")
                    return False

            # 找到对应的工作表并写入数据
            for i, name in enumerate(sheets_list):
                if name == sheet_name:
                    try:
                        worksheet = rb.sheet_by_index(i)
                        rows_old = worksheet.nrows

                        # 使用xlutils.copy复制工作簿
                        wb = copy(rb)
                        ws = wb.get_sheet(i)

                        # 写入数据
                        for col, value in enumerate(item[team_name]):
                            ws.write(rows_old, col, value)

                        wb.save(file_path)
                        logger.info(f'正在保存:第{team_name}条球员信息数据:{mz}')
                        return True
                    except Exception as e:
                        logger.error(f"写入数据失败: {e}")
                        return False
            return True
        except Exception as e:
            logger.error(f"保存数据时发生未知错误: {e}")
            return False

    def main(self):
        """控制逻辑"""
        logger.info("CBA数据爬虫开始运行")
        try:
            success = self.request_teamlist_url()
            if success:
                logger.info("CBA数据爬虫运行完成")
            else:
                logger.error("CBA数据爬虫运行失败")
        except KeyboardInterrupt:
            logger.info("用户中断了程序运行")
        except Exception as e:
            logger.error(f"程序运行过程中发生未预期错误: {e}")
        finally:
            logger.info("CBA数据爬虫运行结束")


if __name__ == '__main__':
    cba = Spider()
    cba.main()