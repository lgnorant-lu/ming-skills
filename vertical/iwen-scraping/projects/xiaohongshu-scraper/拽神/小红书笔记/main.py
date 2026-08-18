import time
from DrissionPage import ChromiumPage
from DataRecorder import Recorder  # 保存exel

r = Recorder('小红书数据.xlsx')
r.set.show_msg(False)  # 不打印日志


def find_first_key_value(data, target_key):
    # 处理字典
    if isinstance(data, dict):
        for key, val in data.items():
            if key == target_key:
                return val

            # 递归遍历子元素的值
            rrr = find_first_key_value(val, target_key)

            if rrr is not None:
                return rrr

    # 处理列表
    if isinstance(data, list):
        for i in data:
            rrr2 = find_first_key_value(i, target_key)
            if rrr2 is not None:
                return rrr2


def handler(web, key):
    web.get(f'https://www.xiaohongshu.com/search_result?keyword={key}&source=web_explore_feed')
    time.sleep(3)
    s = set()
    for j in range(1,51):
        try:
            cards = web.eles('@class=note-item')
            # 1.监听卡片详情接口
            web.listen.start('api/sns/web/v1/feed')
            for card in cards:
                # print(card)
                try:
                    # 去重卡片
                    index = card.attr('data-index')
                    if index in s:
                        continue
                    s.add(index)
                    # 点击卡片
                    aaa = card.ele('@target=_self')
                    aaa.ele('@tag()=img').click(by_js=True)
                    # 2.等待监听数据返回
                    res = web.listen.wait(count=1, timeout=1, fit_count=True)
                    # 3.获取数据
                    data = res.response.body
                    # print(data)

                    # 数据获取
                    title = find_first_key_value(data, 'title')
                    nick_name = find_first_key_value(data, 'nickname')
                    miao_shu = find_first_key_value(data, 'desc')
                    dian_zan = find_first_key_value(data, 'liked_count')
                    shou_cang = find_first_key_value(data, 'collected_count')
                    ping_lun = find_first_key_value(data, 'comment_count')
                    biao_qian = find_first_key_value(data, 'name')

                    # 写入表格
                    map = {
                        '博主昵称': nick_name,
                        '标题': title,
                        '笔记描述': miao_shu,
                        '点赞量': dian_zan,
                        '评论量': ping_lun,
                        '收藏量': shou_cang,
                        '标签': biao_qian,
                    }

                    r.add_data(map)
                    r.record()  # 保存

                    print(map,'保存完成')

                    # 关闭卡片并等待
                    close_btn = web.ele('@class=close close-mask-dark')
                    close_btn.click()
                    time.sleep(3)

                except Exception as e:
                    print('卡片出错',e)
                    continue

            web.listen.start('api/sns/web/v2/comment')

        except Exception as e:
            print('error', e)


        finally:
            # 滚动滚轮
            web.scroll.up(100)
            time.sleep(1)
            web.scroll.to_bottom()
            time.sleep(1)


def main():
    with open('关键词.txt', mode='r', encoding='utf8') as f:
        keywords = f.readlines()

    # 创建浏览器驱动
    web = ChromiumPage()
    web.get('https://www.xiaohongshu.com/explore')

    input('等待登录')

    for key in keywords:
        handler(web, key)


main()
