import time
import pandas as pd
from DrissionPage import Chromium


data_list = []

web = Chromium()
# try:
tab = web.latest_tab


tab.get('https://hotels.ctrip.com/hotels/list?countryId=1&city=1232&provinceId=0&checkin=2025/07/19&checkout=2025/07/20&optionId=1232&optionType=City&directSearch=0&display=%E6%BF%AE%E9%98%B3%2C%20%E6%B2%B3%E5%8D%97%2C%20%E4%B8%AD%E5%9B%BD&crn=1&adult=1&children=0&searchBoxArg=t&travelPurpose=0&ctm_ref=ix_sb_dl&domestic=1&')

uls = tab.ele('@role=product').children('t:li')[4:-1]

for ul in uls:
    print(ul)
#     # if uls.ele('@text()=搜索更多酒店'):
#     #     uls.ele('@text()=搜索更多酒店').click()
#     # else:
#     #     continue
#     try:
#         chengshi = '濮阳'
#         ull = ul.ele('@text()=查看详情').click.for_new_tab(timeout=10)
#         ull.wait.ele_displayed('xpath://ul[@class="basic-sub clearfix"]',timeout=10,raise_err=None)
#         title = ull.ele('.detail-headline_name  ').text
#         kefangshu = ull.ele('xpath://ul[@class="basic-sub clearfix"]').text
#         dianhua = ull.ele('xpath://div[@class="basic-sub flex"]').text
#         print(title,kefangshu,dianhua)
#         data_list.append({
#             '城市': chengshi,
#             '酒店名称': title,
#             '客房数': kefangshu,
#             '电话':dianhua
#         })
#         ull.close()
#         time.sleep(2)
#
#         if data_list:
#             df = pd.DataFrame(data_list)
#             df.to_excel('酒店.xlsx', index=False)
#             print(f"成功保存{len(data_list)}条数据到酒店.xlsx")
#         else:
#             print("未获取到有效数据")
#         # break
#
#     except Exception as e:
#         print(f"程序运行出错: {str(e)}")
#
#     # finally:
#     #     # 滚动滚轮
#     #     web.scroll.up(100)
#     #     time.sleep(1)
#     #     web.scroll.to_bottom()
#     #     time.sleep(1)