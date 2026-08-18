# https://www.xiaohongshu.com/explore?channel_id=homefeed.fashion_v3
import json
import requests


def spider():

    cookies = {
        'gid': 'yjKiJDWy0Dl8yjKiJDW84fyJ2q0ylv6dCyxh63u3S2EKd8283AV3vy888J22qK88qqiJdSYW',
        'xsecappid': 'xhs-pc-web',
        'abRequestId': '9bc1ed11-4c08-5dc1-95c5-ed78b20519f6',
        'ets': '1780053426256',
        'a1': '19e7373c0c0yp3pqnp6yuptpix4jo8eil72dmrk1e50000391232',
        'webId': '6a6bddd86a9ede51994852884bd7f677',
        'web_session': '040069b70d010a4e1b458b3d2c384b8e090895',
        'id_token': 'VjEAAHKIUuuK7wc1eFsTIz4CJIwgXi4b1w1V9bzgDl6wVlMKq3QhHxcV/BBYN335tS29UrgF1TLPhHXrnROIgioTYBivRUQ7tRpRrN5KXNweT8m7M8+BxWwaBfsw6JWC+POl2XUr',
        'x-rednote-datactry': 'CN',
        'x-rednote-holderctry': 'CN',
        'webBuild': '6.13.7',
        'loadts': '1780129627222',
        'acw_tc': '0a4a661017801296276195899eb773192cad1e20ab65a7e45aabdc76402016',
        'websectiga': '29098a4cf41f76ee3f8db19051aaa60c0fc7c5e305572fec762da32d457d76ae',
        'sec_poison_id': '20d86247-7dba-4506-9bc4-92205a45072e',
        'unread': '{%22ub%22:%226a007b0d000000000803250e%22%2C%22ue%22:%226a112a220000000035024e43%22%2C%22uc%22:14}',
    }

    headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'no-cache',
        'content-type': 'application/json;charset=UTF-8',
        'origin': 'https://www.xiaohongshu.com',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://www.xiaohongshu.com/',
        'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'x-b3-traceid': 'f4c2df2205101121',
        'x-rap-param': 'ByQBBQAAAAEAAAAUAAABVFxhZCwAACg8AAAAMwAAAAAAAAAAMWJ4YnL62Ve9Py12DCF1et1vPOfKAAAAEAvmp3VtIxD6Xym6KEnumeg2OwFsKhfToWf2QAJuCcU3Wcd9a3VJPoGzTVeg/1g/vHYsHRDg9FcO9JUtVAu4NpyLlWPToBEyN+qiuy/SB9FcHI/bJ5E8ccrvUzMGGP8+b9T7PuKU6eyfW31STK7Pz9d9BXIN23rzjtDZZYEX/C3ey3kJ5+QKnMSF4wt6Of/Xu3bRowfhGWDaIkQScTFyUoi4REQsNeUAM4bMS8rUUD09lHN0Dc/OeCV4OYB7z88vtnqI+hEuOUlaO7FSXaewxRu8HrE5LOuYy8orv9zTA+fvhtsnt0UC8PFvXCRHJwbgLSl9wuQbhOSwA50CINX8XvpEZQDRtGDgB17ph0U+9aLKiAqG48pTtcTNWeaYYUKqUoTl7RQGfForuSUjpE4EUmGLZmbBbuOXFP4XH9QgbN/5Y7aZPrqTkjD86IYOAo1wPwAAAUM=',
        'x-s': 'XYS_2UQhPsHCH0c1PUhMHjIj2erjwjQhyoPTqBPT49pjHjIj2eHjwjQgynEDJ74AHjIj2ePjwjQTJdPIPAZlg94aGLTlqdY8a0+twrl6PBSbzemk8BRyqURkagQawepncFTx2bSoyFDUyfEf+7iF8eY1aFkxLrkH4b8jLgSI+sTFnoPAJgbYaobnJFlEL/Sn8gpyJnRhnnL7JMkotFEGPpzCyrWFwbiF2p8wLpzN4nYLNMmmPrkHaMY/+FTP4pclPn8+c9EIqMQCLDkcpnbLP9lQ/LT/Jfznnfl0yLLIaSQQyAmOarEaLSz+GDSIz0zxy74O8gql4MbkwgclJ7mA/UHVHdWFH0ijJ9Qx8n+FHdF=',
        'x-s-common': '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',
        'x-t': '1780129659526',
        'x-xray-traceid': 'cf3bff7d2f2386939de0821506b493a6',
        'xy-direction': '19',
        # 'cookie': 'gid=yjKiJDWy0Dl8yjKiJDW84fyJ2q0ylv6dCyxh63u3S2EKd8283AV3vy888J22qK88qqiJdSYW; xsecappid=xhs-pc-web; abRequestId=9bc1ed11-4c08-5dc1-95c5-ed78b20519f6; ets=1780053426256; a1=19e7373c0c0yp3pqnp6yuptpix4jo8eil72dmrk1e50000391232; webId=6a6bddd86a9ede51994852884bd7f677; web_session=040069b70d010a4e1b458b3d2c384b8e090895; id_token=VjEAAHKIUuuK7wc1eFsTIz4CJIwgXi4b1w1V9bzgDl6wVlMKq3QhHxcV/BBYN335tS29UrgF1TLPhHXrnROIgioTYBivRUQ7tRpRrN5KXNweT8m7M8+BxWwaBfsw6JWC+POl2XUr; x-rednote-datactry=CN; x-rednote-holderctry=CN; webBuild=6.13.7; loadts=1780129627222; acw_tc=0a4a661017801296276195899eb773192cad1e20ab65a7e45aabdc76402016; websectiga=29098a4cf41f76ee3f8db19051aaa60c0fc7c5e305572fec762da32d457d76ae; sec_poison_id=20d86247-7dba-4506-9bc4-92205a45072e; unread={%22ub%22:%226a007b0d000000000803250e%22%2C%22ue%22:%226a112a220000000035024e43%22%2C%22uc%22:14}',
    }

    json_data = {
        'cursor_score': '',
        'num': 18,
        'refresh_type': 1,
        'note_index': 18,
        'unread_begin_note_id': '',
        'unread_end_note_id': '',
        'unread_note_count': 0,
        'category': 'homefeed.fashion_v3',
        'search_key': '',
        'need_num': 8,
        'image_formats': [
            'jpg',
            'webp',
            'avif',
        ],
        'need_filter_image': False,
    }

    response = requests.post('https://edith.xiaohongshu.com/api/sns/web/v1/homefeed', cookies=cookies, headers=headers,data=json.dumps(json_data,separators=(',',':')))
    print(response.json())


def main():
    spider()

if __name__ == '__main__':
    main()