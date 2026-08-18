import time
import pandas as pd
from DrissionPage import Chromium

web = Chromium()
try:
    tab = web.latest_tab

    arr_list = ['香港','澳门','广州','珠海','深圳','佛山','惠州','东莞市','中山','江门']

    # tab.get('https://hotels.ctrip.com/hotels/list?countryId=1&city=552&provinceId=0&checkin=2025/05/16&checkout=2025/05/17&optionId=552&optionType=City&directSearch=0&display=%E8%82%87%E5%BA%86%2C%20%E5%B9%BF%E4%B8%9C%2C%20%E4%B8%AD%E5%9B%BD&crn=1&adult=1&children=0&searchBoxArg=t&travelPurpose=0&ctm_ref=ix_sb_dl&domestic=1&&lowPrice=700&highPrice=100000&barCurr=CNY&sort=3&starlist=5')

    # tab.actions.move_to('@id=hotels-destination').click().type('广州')
    # tab.scroll(delta_y=1)
    jiu_list = []
    li_list = tab.ele('@role=product').children('t:li')[4:-1]
    for li in li_list:
        # print(li)
        # new_tab = li.ele('.hotelName').click.for_new_tab()
        # name = new_tab.ele('.detail-headline_title ').text
        name = li.ele('.hotelName').text
        money = li.ele('.sale').text
        print(f'酒店{name},价格{money}')
        jiu_list.append({
            '酒店名称': name,
            '价格': money,
        })
        time.sleep(2)

        if jiu_list:
            df = pd.DataFrame(jiu_list)
            df.to_excel('boss_zhipin_jobs.xlsx', index=False)
            print(f"成功保存{len(jiu_list)}条数据到boss_zhipin_jobs.xlsx")
        else:
            print("未获取到有效数据")
except Exception as e:
    print(f"程序运行出错: {str(e)}")