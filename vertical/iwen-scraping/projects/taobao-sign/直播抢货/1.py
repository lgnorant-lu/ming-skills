import time

from DrissionPage import Chromium

web = Chromium()

tab = web.latest_tab

# tab.get('https://www.taobao.com/')

qiang_name = '格兰仕微波炉家用小型迷你机械式转盘多功能全自动一体官方旗舰D4'


# 登录
def log_in():
    tab.ele('@text()=亲，请登录').click()
    time.sleep(1)
    tab.ele('@name=fm-login-id').input('15603578082')
    time.sleep(1)
    tab.ele('@name=fm-login-password').input('wgh051120...')
    time.sleep(1)
    tab.ele('@type=submit').click()


# 进直播
def zhibo(q):
    time.sleep(1)
    new_tab1 = tab.ele('@text()=淘宝直播').click.for_new_tab()
    time.sleep(1)
    new_tab1.ele('@text()=手机数码').click()
    time.sleep(1)
    new_tab2 = new_tab1.ele('@text()=请看新款潮壳').click.for_new_tab()
    time.sleep(1)
    # 点开全部商品
    new_tab2.ele('@class^allGoodsWrapper--').click()
    # if new_tab2.ele('@text()=登录查看全部商品'):
    #     new_tab2.ele('@text()=登录查看全部商品').click()
    #     log_in()
    time.sleep(2)
    # 开始获取商品信息
    div_list = new_tab2.ele('.ReactVirtualized__Grid__innerScrollContainer').children('t:div')
    for div in div_list:
        title_name = div.ele('@class^titleText--').text
        print(title_name)
        time.sleep(2)
        if qiang_name in title_name:  # 要抢的东西上架了
            time.sleep(2)
            new_tab3 = new_tab2.ele('@class^buyText--').click.for_new_tab()
            time.sleep(2)
            new_tab3.ele('@text()=领券购买').click()


if __name__ == '__main__':
    log_in()
    zhibo(qiang_name)