import time

import requests
from lxml import etree
from bs4 import BeautifulSoup

# for i in range(1,21):

# url = f'https://search.cctv.com/search.php?qtext=%E4%BA%BA%E5%90%8D%E5%B8%81%E6%B1%87%E7%8E%87&sort=relevance&type=web&vtime=&datepid=1&channel=&page={i}'
url = f'https://search.cctv.com/search.php?qtext=%E4%BA%BA%E6%B0%91%E5%B8%81%E6%B1%87%E7%8E%87&sort=relevance&type=web&vtime=&datepid=1&channel=&page=2'

headers = {
"accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
"accept-encoding": "gzip, deflate, br, zstd",
"accept-language": "zh-CN,zh;q=0.9",
"cache-control": "no-cache",
"connection": "keep-alive",
"cookie": "cna=sKTEIGRbhBcCAXjPqylE9fH5; sca=d0c556d8; atpsida=3ba24e90699a967726e0d334_1749138805_3",
"host": "search.cctv.com",
"pragma": "no-cache",
"referer": "https://search.cctv.com/search.php?qtext=%E4%BA%BA%E5%90%8D%E5%B8%81%E6%B1%87%E7%8E%87&sort=relevance&type=web&vtime=&datepid=1&channel=&page=2",
"sec-ch-ua": "\"Google Chrome\";v=\"137\", \"Chromium\";v=\"137\", \"Not/A)Brand\";v=\"24\"",
"sec-ch-ua-mobile": "?0",
"sec-ch-ua-platform": "\"Windows\"",
"sec-fetch-dest": "document",
"sec-fetch-mode": "navigate",
"sec-fetch-site": "same-origin",
"sec-fetch-user": "?1",
"upgrade-insecure-requests": "1",
"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
}

resp = requests.get(url,headers=headers)
resp.encoding='utf-8'

# print(resp.text)
html = resp.text

resp = etree.HTML(html)

lis = resp.xpath('//div[@class="outer"]/ul/li')
for li in lis:
    href = ''.join(li.xpath(".//h3/span/@lanmu1"))
    # print(href)

    title = ''.join(li.xpath(".//h3//text()")).replace(' ','').replace('\n','').replace('\r','')
    laiyuan = ''.join(li.xpath('.//div/span[1]/text()')).replace(' ','').replace('\n','').replace('\r','').replace('新闻','央视网')
    shijian = ''.join(li.xpath('.//div/span[2]/text()')).replace(' ','').replace('\n','').replace('\r','')
    # print(title,laiyuan,shijian)

    # 详情页内容
    headers2 = {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-encoding": "gzip, deflate",
        "accept-language": "zh-CN,zh;q=0.9",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "cookie": "cna=w2+kINf+x1oCAXjPqxw48Wkh; vjuids=6af6e18b.19743155bcb.0.b53ec2addd27d8; vjlast=1749177163.1749177163.30",
        "host": "jingji.cntv.cn",
        "pragma": "no-cache",
        "upgrade-insecure-requests": "1",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
    }

    xiang = requests.get(url=href,headers=headers2)
    # xiang.encoding='utf-8'
    # xiang_html = xiang.text
    # # print(xiang_html)
    # xiang_resp = etree.HTML(xiang_html)
    # txt = ''.join(xiang_resp.xpath('.//div[@class="content_area"]//text()'))
    # txt1 = ''.join(xiang_resp.xpath('.//div[@class="cnt_bd"]/p/text()')).replace(' ','').replace('\n','').replace('\r','')
    # # print(txt1)
    # print(title,laiyuan,shijian,txt1)
    #
    time.sleep(5)



# print(f'第{i}页网址完成')