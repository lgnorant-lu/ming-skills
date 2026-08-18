import requests
from lxml import etree
import pandas as pd


arr_data = []


for i in range(1,7):

    url = f'https://bj.58.com/ershoufang/p{i}/?q=%E6%9C%9D%E9%98%B3%E5%85%AC%E5%9B%AD&PGTID=0d30000c-0000-1f75-6737-b91cff2ac51c&ClickID=1'

    headers = {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "zh-CN,zh;q=0.9",
        "cookie": "aQQ_ajkguid=E3B2B7A2-DBA8-45D7-879F-107C77577B85; sessid=ABB02AFE-071C-4879-9F46-5B47BACE8B4C; ajk-appVersion=; ctid=1; fzq_h=c701339f08ceb2d744906d325f97c6e5_1748684522541_0132f86732d94bd2bbfdda6b1f1092da_1984548994; id58=CkwANmg6zupsv6hMDMk5Ag==; 58tj_uuid=5c3f1f28-4380-4bce-b1ac-16b211c6f166; new_uv=1; utm_source=; spm=; als=0; xxzlclientid=20664bdb-e2b8-4fe7-b991-1748684528572; xxzlxxid=pfmx4JQb1PlWC9SzfI16pnkQl4NC/ji9tEpDU99PjDzNcP2X7t08HWN6AUqLMI3tavjH; new_session=0; init_refer=; xxzlbbid=pfmbM3wxMDM0NnwxLjEwLjB8MTc0ODY4NDcwMDUwMTY0NTk2OXxIbGMrTEYxemFTT3NheFJpVUlrWmdaWXlhZlQ0ZDMrZytUajl4VlU5Mzc4PXxlNDVlODIzNWIwYWExZmQzZjRlNWUyNTkxNjZkNmZhNF8xNzQ4Njg0Njk4NjUyXzRjZDlhY2ZkNGM2NzQ5NmM4MWNmNzlkMzk3Zjc5YjcxXzE5ODQ1NDg5OTR8YzZhOTk4YzIyMWQwYTVlOWNjZDc1N2MzODk5MjZhNzJfMTc0ODY4NDY5OTU2Ml8yNTU=",
        "priority": "u=0, i",
        "referer": "https://bj.58.com/ershoufang/p1/?q=%E6%9C%9D%E9%98%B3%E5%85%AC%E5%9B%AD&PGTID=0d30000c-0000-1f75-6737-b91cff2ac51c&ClickID=1",
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

    resp = requests.get(url,headers = headers)
    # print(resp.text)

    res = etree.HTML(resp.text)
    a = res.xpath('//section[@class="list"]/div/a')
    for d in a:
        # print(d)
        title = d.xpath('./div[2]/div/div/h3/@title')[0]
        qian = d.xpath('./div[2]/div[2]/p/text()')
        momea = qian[-1]
        momeay = momea.replace('\r','').replace('\n','').replace(' ','')
        # print(title,momeay)
        arr_data.append({
            "标题":title,
            "/平米":momeay
        })

    # print(arr_data)
    print(f'第{i}页数据已爬取完毕')
if arr_data:
    df = pd.DataFrame(arr_data)
    df.to_excel('二手房_jobs.xlsx', index=False)
    print(f"成功保存{len(arr_data)}条数据到二手房_jobs.xlsx")
else:
    print("未获取到有效数据")
