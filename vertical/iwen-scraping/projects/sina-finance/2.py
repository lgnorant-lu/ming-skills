import time
import pandas as pd
from DrissionPage import Chromium

web = Chromium()

tab = web.latest_tab

arr_list = []
for u in range(2,21):
    tab.get(f'https://finance.sina.com.cn/roll/index.d.html?fid=&cid=56980&page={u}')

    tab.wait.ele_displayed('@id=listcontent', timeout=10)
    # lis = tab.ele('@id=listcontent').children("t:li")
    lis = tab.ele('@id=listcontent').child("t:li",index=19)
    # for i in lis:
    # print(i)
    title = tab.ele('xpath:./a').text
    # print(title,shijian)
    # 新标签页
    new_tab = tab.ele('xpath:./a').click.for_new_tab()
    time.sleep(5)
    new_tab.wait.ele_displayed('xpath://div[@id="artibody"]/p', timeout=10)
    # time.sleep(5)
    neirongs = new_tab.eles('xpath://div[@id="artibody"]/p')
    neirong_list = []
    shijian = new_tab.ele('xpath:.//div[@class="date-source"]/span').text
    for neirong in neirongs:
        txt = neirong.text
        # print(txt)
        neirong_list.append(txt)
    neirong2 = ''.join(neirong_list)
    if new_tab.ele('xpath:.//div[@class="date-source"]/a'):
        laiyuan = new_tab.ele('xpath:.//div[@class="date-source"]/a').text
        arr_list.append({
            '标题': title,
            '来源': laiyuan,
            '时间': shijian,
            '内容': neirong2
        })
        # # laiyuan = new_tab.ele('')
        print(title,shijian,laiyuan,neirong2)
        print('\n\n')
        new_tab.close()
    elif new_tab.ele('xpath:.//div[@class="date-source"]/span',index=2):
        laiyuan = new_tab.ele('xpath:.//div[@class="date-source"]/span',index=2).text
        arr_list.append({
            '标题': title,
            '来源': laiyuan,
            '时间': shijian,
            '内容': neirong2
        })
        # # laiyuan = new_tab.ele('')
        print(title, shijian, laiyuan, neirong2)
        print('\n\n')
        new_tab.close()
    else:
        new_tab.close()
        continue
    if arr_list:
        df = pd.DataFrame(arr_list)
        df.to_excel('新浪财经.xlsx', index=False)
        print(f"成功保存{len(arr_list)}条数据保存到——新浪财经.xlsx")
    else:
        print("未获取到有效数据")


        # break
