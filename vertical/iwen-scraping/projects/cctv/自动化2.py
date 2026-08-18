import time
from DrissionPage import Chromium
import pandas as pd


web = Chromium()

tab = web.latest_tab

arr_list = []
for i in range(27,47):
    tab.get(f'https://search.cctv.com/search.php?qtext=%E4%BA%BA%E6%B0%91%E5%B8%81%E6%B1%87%E7%8E%87&sort=relevance&type=web&vtime=&datepid=1&channel=&page={i}')
    tab.wait.ele_displayed('xpath://div[@class="outer"]/ul', timeout=10)
    lis = tab.ele('xpath://div[@class="outer"]/ul').children('t:li')
    # print(lis)
    for li in lis:
        title = li.ele('xpath://h3/span/a').text
        # title = li.ele('@id^web_content_').text
        laiyuan = li.ele('xpath://div/span').text
        shijian = li.ele('xpath://div/span', index=2).text
        # arr_list.append({
        #     '标题':title,
        #     '来源':laiyuan,
        #     '时间':shijian
        # })
        # 新标签页
        new_tab = li.ele('xpath://h3/span').click.for_new_tab()
        # new_tab.wait.ele_displayed('xpath://p', timeout=5)
        time.sleep(2)
        try:
            if new_tab.ele('.cnt_bd'):
                new_tab.wait.ele_displayed('.cnt_bd', timeout=5)
                txts = new_tab.ele('.cnt_bd').children('t:p')
                # print(txts)
                neirong = []
                for t in txts:
                    txt = t.text
                    print(txt)
                    neirong.append(txt)
                neirong2 = ''.join(neirong)
                arr_list.append({
                    '标题': title,
                    '来源': laiyuan,
                    '时间': shijian,
                    '内容': neirong2
                })
                new_tab.close()

            elif new_tab.ele('.content_area'):
                new_tab.wait.ele_displayed('.content_area', timeout=5)
                txts = new_tab.ele('.content_area').children('t:p')
                neirong = []
                for t in txts:
                    txt = t.text
                    print(txt)
                    neirong.append(txt)
                neirong2 = ''.join(neirong)
                arr_list.append({
                    '标题': title,
                    '来源': laiyuan,
                    '时间': shijian,
                    '内容': neirong2
                })
                new_tab.close()

            elif new_tab.ele('@id=content_body'):
                new_tab.wait.ele_displayed('@id=content_body', timeout=5)
                txts = new_tab.ele('@id=content_body').children('t:p')
                neirong = []
                for t in txts:
                    txt = t.text
                    print(txt)
                    neirong.append(txt)
                neirong2 = ''.join(neirong)
                arr_list.append({
                    '标题': title,
                    '来源': laiyuan,
                    '时间': shijian,
                    '内容': neirong2
                })
                new_tab.close()

        except Exception as e:
            print(f"程序运行出错: {str(e)}")
            continue

        if arr_list:
            df = pd.DataFrame(arr_list)
            df.to_excel('央视人民币汇率新闻2.xlsx', index=False)
            print(f"成功保存{len(arr_list)}条数据保存到——央视人民币汇率新闻.xlsx")
        else:
            print("未获取到有效数据")
        # break
        # print(title, laiyuan, shijian)

