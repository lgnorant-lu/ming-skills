# https://www.maoyan.com/board/1
import re
from fontTools.ttLib import TTFont
import requests
from lxml import etree



def spider():

    url = 'https://www.maoyan.com/board/1'

    headers = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Cookie': '__mta=19307143.1746448400194.1762437342922.1762437974169.38; _lxsdk_cuid=196a06fbe5bc8-078d24992500c58-26011f51-fa000-196a06fbe5bc8; _ga=GA1.1.1245341055.1746448400; __mta=19307143.1746448400194.1746513959664.1746513964936.6; uuid_n_v=v1; uuid=5797BDF0BAD811F09C168FFA169684C63E751FC6A5DA4716A4747D0EB782D02F; _csrf=63693b0564644c4edd09865640fb755a6712a314676926e4c84e3ddbcf89630e; Hm_lvt_e0bacf12e04a7bd88ddbd9c74ef2b533=1762409880; HMACCOUNT=08D353962B94E89F; _lxsdk=5797BDF0BAD811F09C168FFA169684C63E751FC6A5DA4716A4747D0EB782D02F; Hm_lpvt_e0bacf12e04a7bd88ddbd9c74ef2b533=1762437972; _ga_WN80P4PSY7=GS2.1.s1762436765$o6$g1$t1762438105$j60$l0$h0; _lxsdk_s=19a59b1d5e7-aff-bca-117%7C%7C1',
    }

    response = requests.get(url, headers=headers).text
    # print(response)
    return response


def down_font_file(response):

    font_url = re.findall('edded-opentype"\),url\("(.*?)"\);',response)[0]
    font_url = 'https:' + font_url
    # print(font_url)

    headers = {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
    }
    font_resp = requests.get(font_url,headers=headers).content
    with open('2.woff','wb')as f:
        f.write(font_resp)
        print(f'{font_url}已下载完成')


def get_font_dic():
    biaozhun_1 = TTFont('1.woff')
    # biaozhun_1.saveXML('_1.xml')
    bianhua_2 = TTFont('2.woff')
    # bianhua_2.saveXML('_2.xml')
    symbol_list = bianhua_2.getGlyphOrder()[2::]
    # print(symbol_list)

    dic = {}
    dic_1 = {
        'uniF7B3': '0',
        'uniEDBA': '1',
        'uniF0F0': '2',
        'uniE85F': '3',
        'uniEFE9': '4',
        'uniED4F': '5',
        'uniF70E': '6',
        'uniE916': '7',
        'uniE83F': '8',
        'uniED98': '9',
    }
    for k, v in zip(dic_1.keys(), dic_1.values()):
        on_1 = biaozhun_1['glyf'][k].flags.replace(b'\x01', b'')
        # print(on_1)
        for symbol in symbol_list:
            on_2 = bianhua_2['glyf'][symbol].flags.replace(b'\x01', b'')
            if on_1 == on_2:
                dic[symbol.lower()] = v
                break
        else:
            dic[symbol.lower()] = v

    print(dic)
    return dic


    # 取两个文件中相同数字的轮廓相同点
    # on_1 = biaozhun_1['glyf']['uniED98'].flags.replace(b'\x01',b'')
    # print(on_1)
    # on_2 = bianhua_2['glyf']['uniEB19'].flags.replace(b'\x01',b'')
    # print(on_2)

def parse_resp(response,dic):
    response = response.replace('&#x','uni')
    # print(response)
    for key,val in zip(dic.keys(),dic.values()):
        response = response.replace(key+';',val)
    # print(response)
    html_xpath = etree.HTML(response)
    div_list = html_xpath.xpath('//dl[@class="board-wrapper"]/dd')
    # print(div_list)
    for div in div_list:
        # print(div)
        # 1.电影名：
        mz = ''.join(div.xpath('.//p[@class="name"]/a/text()')).replace(' ', '').replace('\n', '')
        # 2.主演：
        zy = ''.join(div.xpath('.//p[@class="star"]//text()')).replace(' ', '').replace('\n', '')
        # 3.上映时间：
        sj = ''.join(div.xpath('.//p[@class="releasetime"]//text()')).replace(' ', '').replace('\n', '')
        # 4.实时票房：
        sspf = ''.join(div.xpath('.//p[@class="realtime"]//text()')).replace(' ', '').replace('\n', '')
        # 5.总票房：
        zpf = ''.join(div.xpath('.//p[@class="total-boxoffice"]//text()')).replace(' ', '').replace('\n', '')
        print(mz, zy, sj, sspf, zpf, sep='|')


def main():
    response = spider()
    down_font_file(response)
    dic = get_font_dic()
    parse_resp(response,dic)


if __name__ == '__main__':
    main()