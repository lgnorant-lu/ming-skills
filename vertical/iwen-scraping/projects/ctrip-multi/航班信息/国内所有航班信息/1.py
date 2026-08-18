# https://flights.ctrip.com/actualtime/search
import time
from DrissionPage import Chromium

web = Chromium()
tab = web.latest_tab

# url_list = {'A':{
#             '阿勒泰':[],
#             '阿克苏':[],
#             '鞍山':[],
#             '安庆':[],
#             '安顺':[],
#             '阿拉善左旗':[],
#             '中国澳门':[],
#             '阿里':[],
#             '阿拉善右旗':[],
#             '阿尔山':[]},
#
#             'B':{
#             '巴中':[],
#             '百色':[],
#             '包头':[],
#             '毕节':[],
#             '北海':[],
#             '北京':[],
#             '北京(大兴国际机场)':[],
#             '北京(首都国际机场)':[],
#             '博乐':[],
#             '保山':[],
#             '白城':[],
#             '布尔津':[],
#             '白山':[],
#             '巴彦淖尔':[]},
#
#             'C':{
#             '昌都':[],
#             '承德':[],
#             '常德':[],
#             '长春':[],
#             '朝阳':[],
#             '赤峰':[],
#             '长治':[],
#             '重庆':[],
#             '长沙':[],
#             '成都':[],
#             '沧源':[],
#             '常州':[],
#             '池州':[],},
#
#             'D'{
#             '大同':[],
#             '达州':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             '承德':[],
#             }
#             }


tab.get('https://flights.ctrip.com/actualtime/search')
# 确定始发地
tab.ele('@text()=搜起降地').click()

diqu_list = ['阿勒泰', '阿克苏', '鞍山', '安庆', '安顺', '阿拉善左旗', '中国澳门', '阿里', '阿拉善右旗', '阿尔山',
             '巴中', '百色', '包头', '毕节', '北海', '北京','北京(大兴国际机场)','北京(首都国际机场)','博乐','保山',
             '白城','布尔津,''白山','巴彦淖尔','昌都','承德','常德','长春','朝阳','赤峰','长治','重庆','长沙','成都',
             '沧源','常州','池州','大同','达州','稻城','丹东','迪庆','大连','大理','敦煌','东营','大庆',"德令哈",'鄂尔多斯',
             '额济纳旗','恩施','二连浩特','福州','阜阳','抚远','富蕴']


def didian(diqu_list):
    # tab.ele('@text()=出发城市').click()
    for i in diqu_list:
        tab.actions.move_to('@text()=出发城市').click().type(i+'')
        for j in diqu_list:
            tab.actions.move_to('@text()=到达城市').click().type(j+'')
            tab.actions.move_to('@text()=搜索').click()
            time.sleep(2)
            if tab.ele('.list-item-container'):
                datas = tab.ele('.list-item-container').children('t:div')
                for data in datas:
                    left = data.ele('@class$left').children('t:div')
                    right = data.ele('@class$right').children('t:div')
                    for dat1 in left:
                        gongsi = dat1.ele('.info').text
                        shifadi = dat1.ele('.airport').text
                        shi_tm = dat1.ele('.time').text
                        print(gongsi,shifadi,shi_tm)
                    for dat2 in right:
                        zhongdian = dat2.ele('airport').text
                        zhong_time = dat2.ele('.time').text
                        print(zhongdian,zhong_time)
            else:
                continue

    # kaitous = tab.ele('.tab-container').children('t:div')
    # for kaitou in kaitous:
    #     # kaitou.ele()
    #     kaitou.click()
    #     qdiqu1 = tab.ele('.city-content-container').children('t:div')
    #     for qdiv1 in qdiqu1:
    #         d = qdiv1.eles('@class^cityItem')
    #         for qdiv2 in d:
    #             qdiv2.click()
    #             tab.ele('@text()=到达城市').click()
    #             kaitous = tab.ele('.tab-container').children('t:div')
    #             for kaitou in kaitous:
    #                 # kaitou.ele()
    #                 kaitou.click()
    #                 ldiqu1 = tab.ele('.city-content-container').children('t:div')
    #                 for ldiv1 in ldiqu1:
    #                     d = ldiv1.eles('@class^cityItem')
    #                     for ldiv2 in d:
    #                         ldiv2.click()


if __name__ == '__main__':
    didian(diqu_list)
