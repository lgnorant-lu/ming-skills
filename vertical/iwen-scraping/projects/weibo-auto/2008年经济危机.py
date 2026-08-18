import time

import requests
from lxml import etree
import pandas as pd

all_data = []

for i in range(1,45):
    url = f'https://s.weibo.com/weibo?q=%E4%B8%AD%E5%85%B1%E4%BA%8C%E5%8D%81%E5%A4%A7&page={i}'

    headers = {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "zh-CN,zh;q=0.9",
        "cache-control": "no-cache",
        "cookie": "SINAGLOBAL=7676747775477.517.1733732192309; SCF=An79xs1skEZ_biKT8RJTwigCB35oFLMcuZuElEhAq9gDWoa_UHZSxXEeHCLOHF5upoaoM3q1BtdS5ctWxroH0yI.; PC_TOKEN=83e5d641c5; SUB=_2A25FVr4wDeRhGeFH71QV8yrFwjuIHXVmLb_4rDV8PUNbmtANLRn7kW9NeznLuoB31Ggrz1zjO8lguLk4JxMi0VEb; SUBP=0033WrSXqPxfM725Ws9jqgMF55529P9D9WhYR.7.Sl_efeJeDcCRl7Np5JpX5KzhUgL.FoM4ShqXe0B41KM2dJLoIX.LxKqL12-LBK-LxKML1hnLB-eLxKnL1K.LB-zLxK-L12BL1KHki--ciKLhiKn4i--4iKLhiKn7i--ci-zpiKnEi--Ni-2NiKnp; ALF=02_1752849248; _s_tentry=weibo.com; Apache=642267541296.0887.1750257288231; ULV=1750257288232:4:2:1:642267541296.0887.1750257288231:1748875510066",
        "pragma": "no-cache",
        "priority": "u=0, i",
        "referer": "https://s.weibo.com/weibo?q=2008%E5%B9%B4%E9%87%91%E8%9E%8D%E5%8D%B1%E6%9C%BA&page=2",
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


    r = requests.get(url,headers=headers)
    # print(r.text)

    resp = etree.HTML(r.text)
    divs = resp.xpath('//div[@id="pl_feedlist_index"]/div[2]/div')
    for div in divs:
        # print(div)
        if div.xpath('.//p[@node-type="feed_list_content_full"]//text()'):
            txt = "".join(div.xpath('.//p[@node-type="feed_list_content_full"]//text()')).replace(' ','').replace('\n','').replace('\t','')
            shijian = "".join(div.xpath('.//div[@class="from"]/a/text()')).replace(' ', '').replace('\n', '').replace('\t','')
            wangzhi = "".join(div.xpath('.//div[@class="from"]/a/@href')).replace(' ', '').replace('\n', '').replace('\t','')
            print(txt, shijian, wangzhi)

            all_data.append({
                '内容': txt,
                '时间': shijian,
                '网址': wangzhi
            })

            if all_data:
                df = pd.DataFrame(all_data)
                df.to_excel('经济危机.xlsx', index=False)
                print(f"成功保存{len(all_data)}条数据到经济危机.xlsx")
            else:
                print("未获取到有效数据")
        elif div.xpath('.//p[@node-type="feed_list_content"]//text()'):
            txt = "".join(div.xpath('.//p[@node-type="feed_list_content"]//text()')).replace(' ', '').replace('\n','').replace('\t', '')
            shijian = "".join(div.xpath('.//div[@class="from"]/a/text()')).replace(' ', '').replace('\n', '').replace('\t','')
            wangzhi = "".join(div.xpath('.//div[@class="from"]/a/@href')).replace(' ', '').replace('\n', '').replace('\t','')
            print(txt, shijian, wangzhi)

            all_data.append({
                '内容': txt,
                '时间': shijian,
                '网址': wangzhi
            })

            if all_data:
                df = pd.DataFrame(all_data)
                df.to_excel('经济危机.xlsx', index=False)
                print(f"成功保存{len(all_data)}条数据到经济危机.xlsx")
            else:
                print("未获取到有效数据")

        else:
            continue
    time.sleep(3)
    print(f'第{i}页已经爬取完成')