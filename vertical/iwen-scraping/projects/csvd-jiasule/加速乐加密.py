# https://www.cnvd.org.cn/webinfo/list?type=2&max=20&offset=0


# 参数：cookie       方式：加速乐cookie加密


import requests,re,execjs
from lxml import etree

session = requests.session()


def requests_1():

    requ_url = 'https://www.cnvd.org.cn/webinfo/list'
    headers = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'priority': 'u=0, i',
        'referer': 'https://www.cnvd.org.cn/webinfo/list?type=2&max=20&offset=0',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    }

    params = {
        'type': '2',
        'max': '20',
        'offset': '20',
    }

    response = session.get(requ_url, params=params, headers=headers).text
    cookie_1 = re.findall('cookie=(.*?);location.',response)[0]
    cookie_1 = execjs.eval(cookie_1)
    cookie_1 = re.findall('__jsl_clearance_s=(.*?); Max-age',cookie_1)[0]
    print(cookie_1)
    return cookie_1


def requests_2(cookie_1):

    requ_2 = 'https://www.cnvd.org.cn/webinfo/list'
    cookies = {
        '__jsluid_s': '1ff29f17ef0f7ccdcdffd670f0da1c8b',
        '__jsl_clearance_s': cookie_1,
    }

    headers = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'priority': 'u=0, i',
        'referer': 'https://www.cnvd.org.cn/webinfo/list?type=2&max=20&offset=20',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    }

    params = {
        'type': '2',
        'max': '20',
        'offset': '20',
    }

    response = session.get(requ_2, params=params, cookies=cookies, headers=headers).text
    print(response)


def spider():

    url = 'https://www.cnvd.org.cn/webinfo/list'
    cookies = {
        '__jsluid_s': '31aee4c5351709cc3d6bbfa17577c94c',
        'JSESSIONID': '72D452C8EA2B8349687FB0F66BBB68EE',
        '__jsl_clearance_s': '1763563052.445|0|gb546zep2FCTcSYYKTQSRWtj6Rc%3D',
    }

    headers = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'priority': 'u=0, i',
        'referer': 'https://www.cnvd.org.cn/webinfo/list?type=2',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        # 'cookie': '__jsluid_s=31aee4c5351709cc3d6bbfa17577c94c; __jsl_clearance_s=1763558355.925|0|07qDSHA0RuIrfKS2GwDTWQN0Vgk%3D; JSESSIONID=72D452C8EA2B8349687FB0F66BBB68EE',
    }

    params = {
        'type': '2',
        'max': '20',
        'offset': '20',
    }

    response = requests.get(url, params=params, cookies=cookies, headers=headers).text
    # print(response)
    return response


def jiexi(resp):
    # print(resp)
    xpath_resp = etree.HTML(resp)
    tr_list = xpath_resp.xpath('//table[@class="tlist"]//tr')[1::]
    # print(tr_list)
    for tr in tr_list:
        herf = ''.join(tr.xpath('./td[1]/a/@href'))
        title = ''.join(tr.xpath('./td[1]/a/text()')).replace(' ','').replace('\n','').replace('\r','').replace('\t','')
        sj = ''.join(tr.xpath('./td[2]/text()')).replace(' ','').replace('\n','').replace('\r','').replace('\t','')
        dz = 'https://www.cnvd.org.cn'+herf
        print(title,sj,dz)


def main():
    cookie_1 = requests_1()
    requests_2(cookie_1)
    # resp = spider()
    # jiexi(resp)


if __name__ == '__main__':
    main()