import time
import pandas as pd
from DrissionPage import Chromium

web = Chromium()


try:
    tab = web.latest_tab

    # tab.get('https://www.zhipin.com/web/geek/jobs?city=101120200&industry=100012&query=%E7%BA%BF%E4%B8%8A%E6%95%99%E8%82%B2')

    all_data = []  # 存储所有公司数据
    div_list = tab.ele('.rec-job-list').children('t:div')
    # print(len(div_list))
    for div in div_list:
        tab.wait.ele_displayed('.job-name')
        div.ele('.job-name').click()
        time.sleep(2)
        tab.wait.ele_displayed('@text()=查看更多信息')
        new_tab = tab.ele('@text()=查看更多信息').click.for_new_tab()
        # time.sleep(1)
        # 名称
        try:
            new_tab.wait.ele_displayed('.level-list')
            txt = new_tab.ele('.level-list').child('t:li').text
            name = txt[4:]
            all_data.append({
                '公司名称':name
            })
            new_tab.close()
            time.sleep(2)
            print(name)
        # if new_tab.ele('.level-list') not in new_tab:
        #     # new_tab.close()
        #     continue
        except Exception as e:
            print(f"未找到该元素{str(e)}")
            continue
        if all_data:
            df = pd.DataFrame(all_data)
            df.to_excel('boss_zhipin_jobs.xlsx', index=False)
            print(f"成功保存{len(all_data)}条数据到boss_zhipin_jobs.xlsx")
        else:
            print("未获取到有效数据")
    # print(all_data)
except Exception as e:
    print(f"程序运行出错: {str(e)}")
