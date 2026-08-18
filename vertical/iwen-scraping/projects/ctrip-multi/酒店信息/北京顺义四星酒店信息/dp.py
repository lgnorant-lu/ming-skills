from DrissionPage import Chromium
import time


web = Chromium()

tab = web.latest_tab

# tab.get('https://hotels.ctrip.com/hotels/list?cityId=1&provinceId=0&countryId=1&cityName=%E5%8C%97%E4%BA%AC&destName=%E5%8C%97%E4%BA%AC&searchWord=%E9%A1%BA%E4%B9%89%E5%8C%BA&searchType=D&searchValue=9%7C98*9*98%7C40.1499038%7C116.66084543%7C2%7C%E9%A1%BA%E4%B9%89%E5%8C%BA&checkin=2025-11-13&checkout=2025-11-14&crn=1&listFilters=29~1*29*1~1*2%2C16~4*16*4%2C17~1*17*1%2C80~2*80*2&curr=CNY&locale=zh-CN&old=1&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E&v2_mod=45&v2_version=E')

div_list = tab.ele('.hotel-list').children('t:div')[0:-11]
for div in div_list:
    div.ele_displayed()
    div.ele('hotelName').click()
    time.sleep(2)

    # print(div)
# print(div_list)