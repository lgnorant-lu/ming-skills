from DrissionPage import Chromium
from lxml import etree
import json
from urllib.parse import quote

web = Chromium()
tab = web.latest_tab

# tab.get('https://qikan.cqvip.com/Qikan/Search/Index?from=index')
#


def gat_data(page):
    # 开启监听
    tab.listen.start('Search/SearchList')
    # 准备参数
    form_data = {"ObjectType": 1, "SearchKeyList": [], "SearchExpression": '', "BeginYear": '', "EndYear": '',
                 "UpdateTimeType": '', "JournalRange": '', "DomainRange": '', "ClusterFilter": "", "ClusterLimit": 0,
                 "ClusterUseType": "Article", "UrlParam": "", "Sort": "0", "SortField": '', "UserID": "0",
                 "PageNum": page,
                 "PageSize": 20, "SType": '', "StrIds": '', "IsRefOrBy": 0, "ShowRules": "", "IsNoteHistory": 0,
                 "AdvShowTitle": '', "ObjectId": '', "ObjectSearchType": 0, "ChineseEnglishExtend": 0,
                 "SynonymExtend": 0, "ShowTotalCount": 78206819, "AdvTabGuid": ""}

    # 参数 -> json -> urlencode
    form_data_str = json.dumps(form_data, separators=(',', ':'))

    # 进行urlencode
    form_data_str = quote(form_data_str)

    # 运行js
    tab.run_js(f'''
    heng_xhr = new XMLHttpRequest();
    heng_xhr.open('post','https://qikan.cqvip.com/Search/SearchList')
    heng_xhr.setRequestHeader('content-type','application/x-www-form-urlencoded; charset=UTF-8')
    // js发送ajax的时候
    // form data ->xxx=xxx&xxx=xxx
    // request payload ->{{xxx:xxx,xxx:xxx}}
    heng_xhr.send('searchParamModel={form_data_str}');
    ''')

    # 当请求完成后，可以获取到返回信息，并且只有一个响应
    for item in tab.listen.steps(1):
        resp_text = item.response.body
        # 对文本进行解析
        tree = etree.HTML(resp_text)
        dls = tree.xpath('//div[@class="simple-list"]/dl')
        for dl in dls:
            title = dl.xpath('./dt/a/text()')
            print(title)
    tab.listen.stop()


for i in range(1,11):
    gat_data(i)
