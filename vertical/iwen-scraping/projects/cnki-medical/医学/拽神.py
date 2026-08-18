import time
import weakref
import pymysql
from DrissionPage import Chromium
import csv
import os

if not os.path.exists("./数据"):
    os.makedirs("./数据")


web = Chromium()


tab = web.latest_tab

# tab.get('https://kns.cnki.net/kns8s/defaultresult/index?crossids=YSTT4HG0%2CLSTPFY1C%2CJUP3MUPD%2CMPMFIG1A%2CWQ0UVIAA%2CBLZOG7CK%2CPWFIRAGL%2CEMRPGLPA%2CNLBO1Z6R%2CNN3FJMUV&korder=SU&kw=%E5%86%85%E7%A7%91%E5%AD%A6')
# tab.ele('@title=内科学').click()

with open(f"./数据/第页数据.csv", 'w', encoding='utf-8') as f:
    for pag in range(1,4):
        trs = tab.ele('xpath://table[@class="result-table-list"]/tbody[1]').children('t:tr')
        for tr in trs:
            # print(tr)
            try:
                new_tab = tr.ele('@color=red').click.for_new_tab()
                new_tab.wait.ele_displayed('.wx-tit', timeout=5)
                time.sleep(1)
                title = new_tab.ele('.wx-tit').child('t:h1').text.replace(' ', '').replace('\n', '').replace('\r', '')
                zuozhes = new_tab.ele('.wx-tit').child('t:h3').text.replace(' ', '').replace('\n', '').replace('\r', '')
                danwei = new_tab.ele('.wx-tit').child('t:h3', index=2).text.replace(' ', '').replace('\n', '').replace('\r', '')
                jianjie = new_tab.ele('@id=ChDivSummary').text.replace(' ', '').replace('\n', '').replace('\r', '')
                guanjianzi = new_tab.ele('.keywords').text.replace(' ', '').replace('\n', '').replace('\r', '')
                zhuanji = new_tab.ele('.top-space').text.replace(' ', '').replace('\n', '').replace('\r', '')
                shijian = new_tab.ele('.top-space', index=-1).text.replace(' ', '').replace('\n', '').replace('\r', '')

                f.write(f'分类：内科学       标题：{title}         作者：{zuozhes}         单位/学校：{danwei}         简介：{jianjie}          关键词：{guanjianzi}        专辑：{zhuanji}         发布时间：{shijian}\n')
                print(f'{title}已保存完成')
                new_tab.close()

                # time.sleep(1)


            except Exception as e:
                print(f"爬取程序运行出错: {str(e)}")
                continue

        tab.ele('@text()=下一页').click()


    print(f'第{pag}页爬取完成')


