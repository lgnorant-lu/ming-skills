import requests



def spider():
    index_url = 'https://cdn.ryplay12.com/20250610/18782_0d5e6252/2000k/hls/index.m3u8'
    a = index_url.split('/')[3]
    b = index_url.split('/')[4]
    print(a)
    headers = {
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'priority': 'i',
        'range': 'bytes=0-',
        'referer': 'https://www.jsard.com/',
        'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'video',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'cross-site',
        'sec-fetch-storage-access': 'active',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    }

    response = requests.get(index_url, headers=headers).text
    # print(response)
    return [a,b,response]


def get_ts(a,b,response):
    data_list = response.split('\n')
    # print(data_list)
    ts_list = [data for data in data_list if '.ts' in data]
    # print(ts_list)
    for ts in ts_list:
        headers1 = {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        }
        ts_url = 'https://cdn.ryplay12.com/{}/{}/2000k/hls/{}'.format(a,b,ts)
        print(ts_url)
        shiping_data = requests.get(url=ts_url,headers=headers1).content
        print(shiping_data)
        with open('视频2.mp4','ab')as f:
            f.write(shiping_data)
            print(f'{ts_url},下载成功')


def main():
    a,b,response = spider()
    get_ts(a,b,response)


if __name__ == '__main__':
    main()