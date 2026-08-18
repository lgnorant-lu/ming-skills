from DrissionPage import Chromium

web = Chromium()

tab = web.latest_tab

tab.get('https://music.163.com/#/login?targetUrl=http%3A%2F%2Fmusic.163.com%2Fmusician%2Fartist%2Fhome')

tab.wait.ele_displayed('@text()=选择其他登录模式')  # 等待元素加载
tab.ele('@text()=选择其他登录模式').click()

tab.ele('@id=j-official-terms').click()
tab.ele('@text()=网易邮箱账号登录').click()
tab.ele('@data-loginname=loginEmail').input('xiaoheng@com')

tab.ele('@data-placeholder=请输入邮箱登录密码').input('wgh051120...')
tab.ele('#dologin').click()
