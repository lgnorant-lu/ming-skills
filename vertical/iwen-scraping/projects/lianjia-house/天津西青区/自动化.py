from DrissionPage import Chromium
import os

web = Chromium()

tab = web.latest_tab  # 只要浏览器不关 就可以注释接着写

if not os.path.exists("./西青区"):
    os.makedirs("./19")
tab.get('https://tj.lianjia.com/ershoufang/xiqing/pg3')

csv_path = os.path.join('数据1.csv')

while 1:
    lis = tab.ele('.sellListContent').children('t:li')
    # print(lis)
    f = open('./数据1.csv','a',encoding='utf-8-sig')
    for li in lis:
        title = li.ele('.title').text
        s = li.ele('.address').text
        j1 = li.ele('.priceInfo').text
        j = j1.replace(' ','').replace('\n','').replace('\r','')
        print(title,s,j)
        f.write(f"{title},{s},{j}\n",)
    f.close()

    dianji = tab.ele('@text()=下一页').click()