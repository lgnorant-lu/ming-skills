# https://ac.qq.com/


import img2pdf
import requests,re,execjs


def spider():
    url = 'https://ac.qq.com/ComicView/index/id/648399/cid/7858'

    headers = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'priority': 'u=0, i',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        # 'cookie': '__AC__=1; RK=0fPdHjSrvO; ptcz=22a0f77b6d9e78b9951e39811a45e7c3993de20a36db09c0ab941a71103ab7eb; Hm_lvt_49dc6cdf5e8f60db40f921e1d9ba2218=1762821182; HMACCOUNT=08D353962B94E89F; __BEACON_deviceId=Z0E9ZJQpMRFGKwhJpi0WDBRMjRHiJnJ4; theme=white; roastState=2; readLastRecord=%5B%5D; pgv_pvid=5134440857; readRecord=%5B%5B648399%2C%22%E7%8E%8B%E7%89%8C%E5%86%B0%E9%94%8B%22%2C7858%2C%22%E7%AC%AC67%E8%AF%9D%20%E6%88%91%E5%8F%AA%E6%9C%89%E4%B8%80%E4%B8%AA%E8%AF%B7%E6%B1%82%22%2C73%5D%2C%5B645248%2C%22%E9%AC%BC%E7%81%AD%E4%B9%8B%E5%88%83%22%2C187%2C%22%E7%AC%AC187%E8%AF%9D%20%E6%97%A0%E5%9E%A2%E4%B9%8B%E4%BA%BA%22%2C187%5D%5D; Hm_lpvt_49dc6cdf5e8f60db40f921e1d9ba2218=1762828439',
    }

    response = requests.get(url, headers=headers).text
    # print(response)
    DATA = re.findall("var DATA = '(.*?)',",response)[0]
    nonce1 = re.findall("<!--宝珠 end-->(.*?)<!-- 对页引导 -->",response,re.S)[0].replace('\n','').strip()
    nonce2 = re.findall('<script>(.*?)</script>',nonce1)[0].strip()
    nonce = nonce2.split('=')[-1]     # 有可能有环境值  如果出现环境值 js报错  重新执行
    # print(DATA)
    # print(nonce)
    try:
        img_resp = get_img_url(DATA,nonce)
        # print(img_resp)
        parse_img_url(img_resp)
    except:
        print('密钥有环境 -- 解析错误~~~')
        return spider()


def get_img_url(DATA,nonce):
    f = open('get_url.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    img_resp = js.call('get_ming_data',DATA,nonce)
    # print(img_resp)
    return img_resp


def parse_img_url(img_urls):
    img_url_list = [img_url['url'] for img_url in img_urls['picture']]
    print(img_url_list)
    return img_url_list


def img_to_pdf(img_url_list):
    # 图片保存pdf
    img_content_list = [requests.get(url).content for url in img_url_list]
    # 1.设置pdf文件尺寸
    pdf_size = (img2pdf.mm_to_pt(720),img2pdf.mm_to_pt(1000))
    # 2.应用尺寸
    pdf_app = img2pdf.get_layout_fun(pdf_size)
    # 3.准备数据
    pdf_data = img2pdf.convert(img_content_list,layout_fun=pdf_app)
    # 4.保存数据
    with open('./漫画.pdf','wb')as f:
        f.write(pdf_data)
    print('保存完成')


def main():
    img_urls = spider()
    img_url_list = parse_img_url(img_urls)
    img_to_pdf(img_url_list)

if __name__ == '__main__':
    main()