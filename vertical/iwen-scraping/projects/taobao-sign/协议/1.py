# https://uland.taobao.com/sem/tbsearch?bc_fl_src=tbsite_NOX36458&bd_vid=10217743283295858288&channelSrp=baiduSomama&clk1=4aedd185dde2dc9abdb80b8f0938a611&commend=all&ie=utf8&initiative_id=tbindexz_20170306&keyword=%E6%AF%9B%E7%BB%92%E7%8E%A9%E5%85%B7&localImgKey=&page=3&preLoadOrigin=https%3A%2F%2Fwww.taobao.com&q=%E6%AF%9B%E7%BB%92%E7%8E%A9%E5%85%B7&refpid=mm_26632258_3504122_32538762&search_type=item&sourceId=tb.index&spm=tbpc.pc_sem_alimama%2Fa.search_manual.0&ssid=s5-e&tab=all



# 参数:sign     方式：md5
import time
import random
import requests
import execjs

def get_sign(u,data):
    f = open('get_sign.js','r',encoding='utf-8')
    js_code = f.read()
    f.close()
    js = execjs.compile(js_code)
    dic = js.call('get_sign',u,data)
    # print(dic)
    return dic


def spider():
    # 添加随机延迟，模拟真实用户行为
    time.sleep(random.uniform(1, 3))

    url = 'https://h5api.m.taobao.com/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/'
    # Cookie可能过期，建议定期更新
    cookies = {
        'thw': 'cn',
        'cna': 'aTahIPqeOHMCAXjPqiowBZ/9',
        '_m_h5_tk': '22690abcbe2eaa9ec5239f4b454f9076_1764037634351',
        '_m_h5_tk_enc': '7e6805d10b29b30d97ae1ce2e99b172c',
        '_tb_token_': 'f3e6131785ae7',
        'isg': 'BKOjtYGCzq6b3IxrS_cpjN7lMudNmDfaiBcTitUERIdoFMc2S2qDK_4CD-Qago_S',
    }

    u = int(time.time()*1000)
    data = '{"appId":"43356","params":"{\\"device\\":\\"HMA-AL00\\",\\"isBeta\\":\\"false\\",\\"grayHair\\":\\"false\\",\\"from\\":\\"nt_history\\",\\"brand\\":\\"HUAWEI\\",\\"info\\":\\"wifi\\",\\"index\\":\\"4\\",\\"rainbow\\":\\"\\",\\"schemaType\\":\\"auction\\",\\"elderHome\\":\\"false\\",\\"isEnterSrpSearch\\":\\"true\\",\\"newSearch\\":\\"false\\",\\"network\\":\\"wifi\\",\\"subtype\\":\\"\\",\\"hasPreposeFilter\\":\\"false\\",\\"prepositionVersion\\":\\"v2\\",\\"client_os\\":\\"Android\\",\\"gpsEnabled\\":\\"false\\",\\"searchDoorFrom\\":\\"srp\\",\\"debug_rerankNewOpenCard\\":\\"false\\",\\"homePageVersion\\":\\"v7\\",\\"searchElderHomeOpen\\":\\"false\\",\\"search_action\\":\\"initiative\\",\\"sugg\\":\\"_4_1\\",\\"sversion\\":\\"13.6\\",\\"style\\":\\"list\\",\\"ttid\\":\\"600000@taobao_pc_10.7.0\\",\\"needTabs\\":\\"true\\",\\"areaCode\\":\\"CN\\",\\"vm\\":\\"nw\\",\\"countryNum\\":\\"156\\",\\"m\\":\\"pc_sem\\",\\"page\\":4,\\"n\\":48,\\"q\\":\\"%E6%AF%9B%E7%BB%92%E7%8E%A9%E5%85%B7\\",\\"qSource\\":\\"manual\\",\\"pageSource\\":\\"tbpc.pc_sem_alimama/a.search_manual.0\\",\\"tab\\":\\"all\\",\\"pageSize\\":\\"48\\",\\"totalPage\\":\\"100\\",\\"totalResults\\":\\"5000\\",\\"sourceS\\":\\"192\\",\\"sort\\":\\"_coefp\\",\\"filterTag\\":\\"\\",\\"service\\":\\"\\",\\"prop\\":\\"\\",\\"loc\\":\\"\\",\\"start_price\\":null,\\"end_price\\":null,\\"startPrice\\":null,\\"endPrice\\":null,\\"p4pIds\\":\\"769207094813,990059841604,820190715445,990176455770,934002053062,745027688607,649956736833,846959601955,908724985062,986535371728,988408666413,991198243203,667966471595,936489247243,714066346129,850853197509,948536756530,825918780142,983498706859,651028056388,626526514409,870780461926,926899469065,837664621080,969192444306,901843494772,858062874999,966787906242,799327022265,898943073090,770876296882,957731837519,637995060336,669143546206,982180456978,891643639658,639213446688,859345916781,938052824928,709052928524,750274353792,922302965922,859138565119,746231728461,676662340942,672700321848,979287138460,898355948671\\",\\"categoryp\\":\\"\\",\\"myCNA\\":\\"aTahIPqeOHMCAXjPqiowBZ/9\\",\\"clk1\\":\\"4aedd185dde2dc9abdb80b8f0938a611\\",\\"refpid\\":\\"mm_26632258_3504122_32538762\\"}"}'
    params = {
        'jsv': '2.7.2',
        'appKey': '12574478',
        't': str(u),
        'sign': get_sign(u,data)['sign'],
        'api': 'mtop.relationrecommend.wirelessrecommend.recommend',
        'v': '2.0',
        'type': 'jsonp',
        'dataType': 'jsonp',
        'callback': 'mtopjsonp20',
        'data': data,
    }

    # print(params)

    # 优化请求头，添加更多浏览器特征
    headers = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'max-age=0',
        'pragma': 'no-cache',
        'upgrade-insecure-requests': '1',
        'referer': 'https://www.taobao.com/',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }


    # 添加重试机制
    max_retries = 3
    retry_count = 0
    
    while retry_count < max_retries:
        try:
            # 添加超时设置
            response = requests.get(url, params=params, cookies=cookies, headers=headers, timeout=10, verify=False).text
            print(f"第{retry_count+1}次请求成功:")
            print(response)
            # 检查是否是错误响应
            if 'FAIL_SYS_USER_VALIDATE' in response or 'RGV587_ERROR' in response:
                print("遇到反爬机制，准备重试...")
                retry_count += 1
                time.sleep(random.uniform(3, 5))
                # 更新时间戳和签名
                u = int(time.time()*1000)
                params['t'] = str(u)
                params['sign'] = get_sign(u, data)['sign']
                continue
            break
        except Exception as e:
            print(f"请求出错: {e}")
            retry_count += 1
            time.sleep(random.uniform(2, 4))
    
    if retry_count >= max_retries:
        print("达到最大重试次数，请求失败")


def main():
    spider()


if __name__ == '__main__':
    main()