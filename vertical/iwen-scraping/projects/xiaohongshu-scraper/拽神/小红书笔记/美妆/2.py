import time

from DrissionPage import Chromium
import datetime


# 提取评论数据
def extract_comments_with_details(data):
    """
    提取评论的详细信息，包括评论内容、时间、IP地址、点赞数、子评论数和用户昵称
    返回格式: [{"content": "评论内容", "time": "时间", "ip": "IP地址", "likes": "点赞数", "sub_comment_count": "子评论数", "user": "用户名"}]
    """
    comments_details = []

    # 处理主评论
    if 'data' in data and 'comments' in data['data']:
        for comment in data['data']['comments']:
            # 获取时间戳并转换
            timestamp = comment.get('create_time', comment.get('time', ''))
            time_str = timestamp
            if timestamp:
                try:
                    # 尝试将时间戳转换为可读格式
                    if isinstance(timestamp, (int, float)):
                        time_str = datetime.datetime.fromtimestamp(int(timestamp / 1000))
                    elif isinstance(timestamp, str) and timestamp.isdigit():
                        time_str = datetime.datetime.fromtimestamp(int(int(timestamp) / 1000))
                except:
                    pass  # 如果转换失败，保留原始时间戳

            # 提取用户昵称
            nickname = ''
            user_info = comment.get('user_info', {})
            if isinstance(user_info, dict):
                nickname = user_info.get('nickname', '')

            # 创建主评论的详细信息字典
            comment_info = {
                "content": comment.get('content', ''),
                "time": time_str,
                "ip": comment.get('ip_location', ''),
                "likes": comment.get('like_count', '0'),  # 使用like_count作为点赞数
                "sub_comment_count": comment.get('sub_comment_count', '0'),  # 添加子评论数字段
                "user": nickname  # 用户昵称
            }
            comments_details.append(comment_info)

            # 处理子评论
            if 'sub_comments' in comment:
                for sub_comment in comment['sub_comments']:
                    # 获取子评论时间戳并转换
                    sub_timestamp = sub_comment.get('create_time', sub_comment.get('time', ''))
                    sub_time_str = sub_timestamp
                    if sub_timestamp:
                        try:
                            # 尝试将时间戳转换为可读格式
                            if isinstance(sub_timestamp, (int, float)):
                                sub_time_str = datetime.datetime.fromtimestamp(int(sub_timestamp / 1000))
                            elif isinstance(sub_timestamp, str) and sub_timestamp.isdigit():
                                sub_time_str = datetime.datetime.fromtimestamp(int(int(sub_timestamp) / 1000))
                        except:
                            pass  # 如果转换失败，保留原始时间戳

                    # 提取子评论用户昵称
                    sub_nickname = ''
                    sub_user_info = sub_comment.get('user_info', {})
                    if isinstance(sub_user_info, dict):
                        sub_nickname = sub_user_info.get('nickname', '')

                    # 创建子评论的详细信息字典，添加点赞字段和用户昵称
                    sub_comment_info = {
                        "content": sub_comment.get('content', ''),
                        "time": sub_time_str,
                        "ip": sub_comment.get('ip_location', ''),
                        "likes": sub_comment.get('like_count', '0'),  # 使用like_count作为点赞数
                        "user": sub_nickname  # 用户昵称
                    }
                    comments_details.append(sub_comment_info)

    return comments_details


# 提取视频数据
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


def get_a_key(tab, key):
    try:
        tab.ele('#search-input').input(key)
        tab.actions.key_down('ENTER')
        tab.actions.key_up('ENTER')

        items = tab.eles('.note-item')

        for item in items:
            try:
                # 先清除之前的监听器，确保新的监听不受干扰
                tab.listen.clear()
                # 启动新的评论接口监听
                tab.listen.start('api/sns/web/v2/comment/page')

                # 点击卡片打开详情页
                item.ele('tag:img').click(by_js=True)
                # 等待页面加载完成
                tab.wait(2)

                # 滚动并抓取评论的循环  评论滚动几次
                scroll_count = 4
                for scroll_idx in range(scroll_count):
                    try:
                        # 确保监听器正在工作并等待评论数据
                        resp = tab.listen.wait(count=1, timeout=3, fit_count=True)
                        data = resp.response.body

                        # 提取并输出评论详细信息
                        comments_with_details = extract_comments_with_details(data)
                        print(f"\n=== 第{scroll_idx + 1}次滚动后的评论信息 ===")
                        for idx, comment_info in enumerate(comments_with_details, 1):
                            print(f"   {idx}. 用户: {comment_info.get('user', '')}")
                            print(f"      内容: {comment_info['content']}")
                            print(f"      时间: {comment_info['time']}")
                            print(f"      IP: {comment_info['ip']}")
                            print(f"      点赞数: {comment_info['likes']}")
                            if 'sub_comment_count' in comment_info:
                                print(f"      子评论数: {comment_info['sub_comment_count']}")
                            print()  # 添加空行分隔评论
                        print(f"本次共提取到 {len(comments_with_details)} 条评论")

                        # 清除已处理的响应，为下一次监听做准备
                        tab.listen.clear()
                    except Exception as e:
                        print(f"获取评论数据时出错: {e}")

                    # 执行滚动操作加载更多评论
                    scrypt = """
                        ele = document.getElementsByClassName('list-container');
                        if (ele.length > 0) {
                            ele[0].scrollIntoView({behavior:"smooth",block:"end",inline:"nearest"});
                        }
                    """
                    tab.run_js(scrypt)
                    tab.wait(2)  # 增加等待时间确保新评论加载完成

                # 关闭当前小卡片并等待
                close_btn = tab.ele('.close close-mask-dark')
                close_btn.click()
                # 硬等待防止被检测到
                tab.wait(3)

            except Exception as e:
                print(f"处理卡片时出错: {e}")
                # 尝试关闭卡片继续处理下一个
                try:
                    close_btn = tab.ele('.close close-mask-dark')
                    close_btn.click()
                    tab.wait(2)
                except:
                    pass

    except Exception as e:
        print(f"主要错误: {e}")
    input('抓取{}'.format(key))

    tab.back(1)


if __name__ == '__main__':
    # 读关键词
    with open('E:\爬虫13期专用\AAA_王总的web项目\小红书\拽神\小红书笔记\关键词.txt', 'r', encoding='utf8') as f:
        keyword = f.readlines()
    # 创建浏览器对象
    web = Chromium()
    # 创建标签
    tab = web.latest_tab
    tab.get('https://www.xiaohongshu.com/explore')
    # 等待登录
    input('等待登录')
    for key in keyword:
        get_a_key(tab, key)
        break

        # ele = document.getElementsByClassName('list-container')