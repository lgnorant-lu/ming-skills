import time
import os
import pandas as pd
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
                        time_str = datetime.datetime.fromtimestamp(int(timestamp/1000))
                    elif isinstance(timestamp, str) and timestamp.isdigit():
                        time_str = datetime.datetime.fromtimestamp(int(int(timestamp)/1000))
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
                                sub_time_str = datetime.datetime.fromtimestamp(int(sub_timestamp/1000))
                            elif isinstance(sub_timestamp, str) and sub_timestamp.isdigit():
                                sub_time_str = datetime.datetime.fromtimestamp(int(int(sub_timestamp)/1000))
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


def get_a_key(tab,key):
    try:
        # 清理关键词中的换行符和空格
        key = key.strip()
        print(f"\n开始抓取关键词: {key}")
        
        tab.ele('#search-input').input(key)
        tab.actions.key_down('ENTER')
        tab.actions.key_up('ENTER')
        tab.wait(3)  # 等待搜索结果加载

        items = tab.eles('.note-item')
        print(f"找到 {len(items)} 个笔记项目")

        # 为每个卡片单独创建监听器
        for idx, item in enumerate(items, 1):
            # 为每个笔记创建一个单独的评论列表
            note_comments = []
            print(f"\n处理第 {idx} 个笔记")
            try:
                # 清除之前的监听器
                tab.listen.clear()
                # 启动评论接口监听
                tab.listen.start('api/sns/web/v2/comment/page')
                
                # 点击卡片
                item.ele('tag:img').click(by_js=True)
                tab.wait(2)  # 等待页面加载
                
                # 提取笔记标题作为标识
                try:
                    note_title = tab.ele('.title').text if tab.ele('.title', timeout=1) else f"笔记{idx}"
                    print(f"正在处理笔记: {note_title}")
                except:
                    note_title = f"笔记{idx}"
                
                # 滚动并抓取评论的循环
                scroll_count = 4
                for scroll_idx in range(scroll_count):
                    try:
                        # 等待评论数据
                        resp = tab.listen.wait(count=1, timeout=3, fit_count=True)
                        data = resp.response.body
                        
                        # 提取评论详细信息
                        comments_with_details = extract_comments_with_details(data)
                        
                        # 为每条评论添加来源信息
                        for comment in comments_with_details:
                            comment['关键词'] = key
                            comment['笔记标题'] = note_title
                            comment['笔记序号'] = idx
                            comment['滚动次数'] = scroll_idx + 1
                        
                        # 将当前获取的评论添加到笔记评论列表
                        note_comments.extend(comments_with_details)
                        
                        print(f"  第{scroll_idx+1}次滚动，提取到 {len(comments_with_details)} 条评论")
                        
                        # 清除已处理的响应
                        tab.listen.clear()
                        tab.listen.start('api/sns/web/v2/comment/page')
                    except Exception as e:
                        print(f"  获取评论数据时出错: {e}")
                    
                    # 执行滚动操作
                    scrypt = """
                        ele = document.getElementsByClassName('list-container');
                        if (ele.length > 0) {
                            ele[0].scrollIntoView({behavior:"smooth",block:"end",inline:"nearest"});
                        }
                    """
                    tab.run_js(scrypt)
                    tab.wait(2)  # 增加等待时间
                
                # 每处理完一个笔记就保存一次
                if note_comments:
                    print(f"\n正在保存第 {idx} 个笔记的评论数据...")
                    save_comments_to_excel(note_comments, key, idx, note_title)
                else:
                    print(f"第 {idx} 个笔记未收集到任何评论数据")
                
                # 关闭当前小卡片
                close_btn = tab.ele('.close close-mask-dark')
                close_btn.click()
                tab.wait(3)
                
            except Exception as e:
                print(f"处理卡片时出错: {e}")
                # 即使处理出错也尝试保存已收集的评论
                if note_comments:
                    print(f"尝试保存第 {idx} 个笔记已收集的评论数据...")
                    save_comments_to_excel(note_comments, key, idx, note_title)
                # 尝试关闭卡片继续下一个
                try:
                    close_btn = tab.ele('.close close-mask-dark')
                    close_btn.click()
                    tab.wait(2)
                except:
                    pass

    except Exception as e:
        print(f"主要错误: {e}")
    
    input(f'关键词 "{key}" 抓取完成')
    tab.back(1)

def save_comments_to_excel(comments, keyword, note_idx, note_title):
    """
    将单个笔记的评论数据保存到Excel文件
    """
    try:
        # 确保保存目录存在
        save_dir = "e:\爬虫13期专用\AAA_王总的web项目\小红书\拽神\小红书笔记\评论数据"
        if not os.path.exists(save_dir):
            os.makedirs(save_dir)
        
        # 准备Excel文件路径，使用关键词、笔记序号、笔记标题和时间戳作为文件名
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        # 清理文件名，移除不允许的字符
        safe_note_title = "".join(x for x in note_title if x not in ('/', '\\', ':', '*', '?', '"', '<', '>', '|'))[:20]  # 限制长度
        filename = f"{keyword}_{note_idx}_{safe_note_title}_{timestamp}.xlsx"
        filepath = os.path.join(save_dir, filename)
        
        # 过滤出需要的列
        df_data = []
        for comment in comments:
            # 确保所有必要的字段都存在
            row = {
                '关键词': comment.get('关键词', ''),
                '笔记序号': comment.get('笔记序号', ''),
                '笔记标题': comment.get('笔记标题', ''),
                '滚动次数': comment.get('滚动次数', ''),
                '用户昵称': comment.get('user', ''),
                '评论内容': comment.get('content', ''),
                '评论时间': comment.get('time', ''),
                'IP地址': comment.get('ip', ''),
                '点赞数': comment.get('likes', ''),
                '子评论数': comment.get('sub_comment_count', '')
            }
            df_data.append(row)
        
        # 创建DataFrame
        df = pd.DataFrame(df_data)
        
        # 保存到Excel
        with pd.ExcelWriter(filepath, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='评论数据')
        
        print(f"成功将 {len(comments)} 条评论数据保存到: {filepath}")
        
    except Exception as e:
        print(f"保存评论到Excel时出错: {e}")
        # 尝试保存为CSV作为备选
        try:
            # 确保filepath已定义
            if 'filepath' in locals():
                csv_filepath = filepath.replace('.xlsx', '.csv')
                df.to_csv(csv_filepath, index=False, encoding='utf-8-sig')
                print(f"已尝试保存为CSV格式: {csv_filepath}")
        except Exception as csv_error:
            print(f"保存为CSV也失败: {csv_error}")


if __name__ == '__main__':
    # 读关键词
    with open('E:\爬虫13期专用\AAA_王总的web项目\小红书\拽神\小红书笔记\关键词.txt','r',encoding='utf8') as f:
        keyword = f.readlines()
    # 创建浏览器对象
    web = Chromium()
    # 创建标签
    tab = web.latest_tab
    tab.get('https://www.xiaohongshu.com/explore')
    # 等待登录
    input('等待登录')
    for key in keyword:
        get_a_key(tab,key)
        break

        # ele = document.getElementsByClassName('list-container')