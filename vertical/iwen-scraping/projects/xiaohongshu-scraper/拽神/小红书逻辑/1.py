from DrissionPage import Chromium

web = Chromium()
tab = web.latest_tab

tab.get('https://www.xiaohongshu.com/explore')

# 不断向下滚  借助js代码
# window.scrollBy(0,2000)
js_code = """
for (let i=0; i<999; i++) clearInterval(i);
setInterval (function (){
    window.scrollBy(0,2000);
}, 500);
"""
# 执行js代码
tab.run_js(js_code)

# 如何获取数据  监听网络数据包
tab.listen.start('api/sns/web/v1/homefeed')

page = 0
# 当有这个请求出现的时候，才能拿到数据
for item in tab.listen.steps():  # 程序会阻塞在这里
    # 在这里可以拿到数据
    print(item.response.body)
    if page == 10:
        break
    page += 1