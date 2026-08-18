# http://120.53.92.179/font/cp1/index.html


import requests
from fontTools.ttLib import TTFont
from lxml import etree


def spider():
    start_url = 'http://120.53.92.179/font/cp1/index.html'

    headers = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache',
        'Referer': 'http://120.53.92.179/',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    }

    response = requests.get(start_url, headers=headers, verify=False).text
    response = response.replace('&#x', 'uni')
    # print(response)
    return response


def down_font_file():
    # 下载字体文件
    font_url = "http://120.53.92.179/static/font/cp1/font/ae0f8407.woff"

    headers = {
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Origin': 'http://120.53.92.179',
        'Pragma': 'no-cache',
        'Referer': 'http://120.53.92.179/static/font/cp1/css/style.css',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    }
    response = requests.get(font_url, headers=headers, verify=False).content
    with open('1.woff', 'wb') as f:
        f.write(response)


def constrct_dic(response):
    # 分析字体文件
    font = TTFont('1.woff')
    # print(font)
    # 1. 取符号
    symbol = font.getGlyphOrder()[2::]
    # 2. 取文本
    data = '1234567890店中美家馆小车大市公酒行国品发电金心业商司超生装园场食有新限天面工服海华水房饰城乐汽香部利子老艺花专东肉菜学福饭人百餐茶务通味所山区门药银农龙停尚安广鑫一容动南具源兴鲜记时机烤' \
           '文康信果阳理锅宝达地儿衣特产西批坊州牛佳化五米修爱北养卖建材三会鸡室红站德王光名丽油院堂烧江社合星货型村自科快便日民营和活童明器烟育宾精屋经居庄石顺林尔县手厅销用好客火雅盛体旅之鞋辣作粉包楼校鱼平彩上' \
           '吧保永万物教吃设医正造丰健点汤网庆技斯洗料配汇木缘加麻联卫川泰色世方寓风幼羊烫来高厂兰阿贝皮全女拉成云维贸道术运都口博河瑞宏京际路祥青镇厨培力惠连马鸿钢训影甲助窗布富牌头四多妆吉苑沙恒隆春干饼氏里二管' \
           '诚制售嘉长轩杂副清计黄讯太鸭号街交与叉附近层旁对巷栋环省桥湖段乡厦府铺内侧元购前幢滨处向座下県风港开关景泉塘放昌线湾政步宁解白田町溪十八古双胜本单同九迎第台玉锦底后七斜期武岭松角纪朝峰六振珠局岗洲横边' \
           '济井办汉代临弄团外塔杨铁浦字年岛陵原梅进荣友虹央桂沿事津凯莲丁秀柳集紫旗张谷的是不了很还个也这我就在以可到错没去过感次要比觉看得说常真们但最喜哈么别位能较境非为欢然他挺着价那意种想出员两推做排实分间甜' \
           '度起满给热完格荐喝等其再几只现朋候样直而买于般豆量选奶打每评少算又因情找些份置适什蛋师气你姐棒试总定啊足级整带虾如态且尝主话强当更板知己无酸让入啦式笑赞片酱差像提队走嫩才刚午接重串回晚微周值费性桌拍跟块调糕'
    # print(len(symbol))
    # print(len(data))
    for key, value in zip(symbol, data):
        # print(key,value)
        response = response.replace(key+';', value)
    # print(response)
    return response


def parse_response(ming_resp):
    html_xpath = etree.HTML(ming_resp)
    ming_ = ''.join(html_xpath.xpath('//div[@class="wrapper"]//text()')).replace(' ','').replace('\n','')
    print(ming_)


def main():
    mi_response = spider()
    down_font_file()
    ming_resp = constrct_dic(mi_response)
    parse_response(ming_resp)


if __name__ == '__main__':
    main()
