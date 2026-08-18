# http://120.53.92.179/font/cp3/index.html




import requests
from fontTools.ttLib import TTFont
from lxml import etree


def spider():
    url = 'http://120.53.92.179/font/cp3/index.html'

    headers = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache',
        'Referer': 'http://120.53.92.179/',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    }

    response = requests.get(url, headers=headers, verify=False).text
    # print(response)
    return response


def down_font_file():
    # 下载字体文件
    font_url = 'http://120.53.92.179/static/font/cp3/font/zpwz.ttf'
    headers = {
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Origin': 'http://120.53.92.179',
        'Pragma': 'no-cache',
        'Referer': 'http://120.53.92.179/font/cp3/index.html',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    }

    response = requests.get(font_url, headers=headers, verify=False).content
    with open('3.ttf','wb')as f:
        f.write(response)


def constrct_dic(resp):
    # 分析字体文件 构建对照表  如果字体文件不一样 -- 把字体文件保存成XML文件
    # fort = TTFont('1.ttf')
    # fort.saveXML('test.xml')
    # symbol = fort.getGlyphOrder()
    # print(symbol)

    dic = {
        '&#x9f92':'0',
        '&#x9ea3':'1',
        '&#x993c':'2',
        '&#x958f':'3',
        '&#x9fa4':'4',
        '&#x9476':'5',
        '&#x9a4b':'6',
        '&#x9f64':'7',
        '&#x9fa5':'8',
        '&#x9e3a':'9',
    }
    for key,value in zip(dic.keys(),dic.values()):
        # print(key,value)
        resp = resp.replace(key+';',value)
        # print(resp)
    return resp


def parse_resp(resp):
    html_xpath = etree.HTML(resp)
    div_list = html_xpath.xpath('//div[@class="container"]//div[@class="col"]')
    # print(div_list)
    for div in div_list:
        # 标题
        mz = ''.join(div.xpath('.//h5[@class="card-title"]/text()')).replace('\n','').replace(' ','')
        # 薪资
        xz = ''.join(div.xpath('.//p[@class="float-right"]/text()')).replace('\n','').replace(' ','')
        # 招聘人数
        rs = ''.join(div.xpath('.//p[@class="card-titlecard-text text-muted"]/text()')).replace('\n','').replace(' ','')
        # 企业
        qy = ''.join(div.xpath('.//p[@class="card-text"]/text()')).replace('\n','').replace(' ','')
        print(mz,xz,rs,qy)


def main():
    resp = spider()
    down_font_file()
    resp = constrct_dic(resp)
    parse_resp(resp)



if __name__ == '__main__':
    main()