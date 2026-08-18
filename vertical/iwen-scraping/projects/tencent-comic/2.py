# https://ac.qq.com/
import img2pdf
import requests, re, execjs


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
    }

    response = requests.get(url, headers=headers).text
    # print(response)
    DATA = re.findall("var DATA = '(.*?)',", response)[0]
    nonce1 = re.findall("<!--宝珠 end-->(.*?)<!-- 对页引导 -->", response, re.S)[0].replace('\n', '').strip()
    nonce2 = re.findall('<script>(.*?)</script>', nonce1)[0].strip()
    nonce = nonce2.split('=')[-1]  # 有可能有环境值  如果出现环境值 js报错  重新执行
    # print(DATA)
    # print(nonce)
    try:
        img_resp = get_img_url(DATA, nonce)
        # print(img_resp)
        return img_resp  # 添加return
    except Exception as e:
        print(f'密钥有环境 -- 解析错误~~~ 错误信息: {e}')
        return spider()  # 递归调用时也要返回结果


def get_img_url(DATA, nonce):
    f = open('get_url.js', 'r', encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)

    img_resp = js.call('get_ming_data', DATA, nonce)
    # print(img_resp)
    return img_resp


def parse_img_url(img_urls):
    if img_urls and 'picture' in img_urls:
        img_url_list = [img_url['url'] for img_url in img_urls['picture']]
        print(f"成功解析到 {len(img_url_list)} 张图片")
        return img_url_list
    else:
        print("解析图片URL失败")
        return []


def img_to_pdf(img_url_list):
    if not img_url_list:
        print("没有图片可下载")
        return

    print("开始下载图片...")
    img_content_list = []

    for i, url in enumerate(img_url_list):
        try:
            print(f"下载第 {i + 1}/{len(img_url_list)} 张图片")
            response = requests.get(url, timeout=30)
            if response.status_code == 200:
                img_content_list.append(response.content)
            else:
                print(f"下载失败: {url}, 状态码: {response.status_code}")
        except Exception as e:
            print(f"下载图片时出错: {e}")

    if not img_content_list:
        print("没有成功下载任何图片")
        return

    print("开始生成PDF...")
    try:
        # 1.设置pdf文件尺寸
        pdf_size = (img2pdf.mm_to_pt(720), img2pdf.mm_to_pt(1000))
        # 2.应用尺寸
        pdf_app = img2pdf.get_layout_fun(pdf_size)
        # 3.准备数据
        pdf_data = img2pdf.convert(img_content_list, layout_fun=pdf_app)
        # 4.保存数据
        with open('./漫画.pdf', 'wb') as f:
            f.write(pdf_data)
        print('保存完成')
    except Exception as e:
        print(f"生成PDF时出错: {e}")


def main():
    try:
        img_resp = spider()  # 获取响应数据
        if img_resp:
            img_url_list = parse_img_url(img_resp)  # 解析图片URL
            if img_url_list:
                img_to_pdf(img_url_list)  # 下载并生成PDF
            else:
                print("没有解析到图片URL")
        else:
            print("获取图片数据失败")
    except Exception as e:
        print(f"程序执行出错: {e}")


if __name__ == '__main__':
    main()