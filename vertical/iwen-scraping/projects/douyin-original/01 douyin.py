import requests
import execjs
import urllib.parse

headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'cache-control': 'no-cache',
    'cookie': '__ac_nonce=0664c8d89002603581f68; __ac_signature=_02B4Z6wo00f01l89V-wAAIDBDcJ39lxqIS5fHVNAAPGS9f; ttwid=1%7CwfnWDGJLs-229lYw8BtYA7-zTGr1QaSVrFfWymsXaM8%7C1716293001%7C3a295830326baf30599f501e37228ee1d358339db034809f3d68cbc59e88b961; s_v_web_id=verify_lwgcjh0e_udGDRuN5_9fTy_4qTG_BH8Q_HDyjHdPb890q; douyin.com; device_web_cpu_core=10; device_web_memory_size=8; home_can_add_dy_2_desktop=%220%22; dy_swidth=1496; dy_sheight=967; csrf_session_id=155d40fe6bfff40296ac37c28a96311b; FORCE_LOGIN=%7B%22videoConsumedRemainSeconds%22%3A180%7D; strategyABtestKey=%221716293004.705%22; volume_info=%7B%22isUserMute%22%3Afalse%2C%22isMute%22%3Afalse%2C%22volume%22%3A0.5%7D; passport_csrf_token=8ba98015fc1f052daa87ecb8fde6c1d2; passport_csrf_token_default=8ba98015fc1f052daa87ecb8fde6c1d2; bd_ticket_guard_client_web_domain=2; stream_player_status_params=%22%7B%5C%22is_auto_play%5C%22%3A0%2C%5C%22is_full_screen%5C%22%3A0%2C%5C%22is_full_webscreen%5C%22%3A0%2C%5C%22is_mute%5C%22%3A0%2C%5C%22is_speed%5C%22%3A1%2C%5C%22is_visible%5C%22%3A0%7D%22; SEARCH_RESULT_LIST_TYPE=%22single%22; bd_ticket_guard_client_data=eyJiZC10aWNrZXQtZ3VhcmQtdmVyc2lvbiI6MiwiYmQtdGlja2V0LWd1YXJkLWl0ZXJhdGlvbi12ZXJzaW9uIjoxLCJiZC10aWNrZXQtZ3VhcmQtcmVlLXB1YmxpYy1rZXkiOiJCSFF4QVdTckdsWXZQNExzQ0NiNldTN1NUR0lYUFEyZC82L2x1ZFRkSXdjK1dxWjBITU01bm5rblIwN2Fjbk54NkRQbUw4TUllYmVJM3hOMVc4MkNNKzg9IiwiYmQtdGlja2V0LWd1YXJkLXdlYi12ZXJzaW9uIjoxfQ%3D%3D; msToken=eaPC2AzAcOjLW7PxsKtB_ppodj4U4Z9gtbxg1kdfrkZV3pIU6w5FG2hHgOmprLwKs-ZVpxmSdIdfYhW2MIoDvlOvsa22Fu9I8Lokuofa0u2agEhHSYEDupl2pVYjQg==; download_guide=%221%2F20240521%2F0%22; IsDouyinActive=true; stream_recommend_feed_params=%22%7B%5C%22cookie_enabled%5C%22%3Atrue%2C%5C%22screen_width%5C%22%3A1496%2C%5C%22screen_height%5C%22%3A967%2C%5C%22browser_online%5C%22%3Atrue%2C%5C%22cpu_core_num%5C%22%3A10%2C%5C%22device_memory%5C%22%3A8%2C%5C%22downlink%5C%22%3A10%2C%5C%22effective_type%5C%22%3A%5C%224g%5C%22%2C%5C%22round_trip_time%5C%22%3A50%7D%22',
    'pragma': 'no-cache',
    'priority': 'u=1, i',
    'referer': 'https://www.douyin.com/user/MS4wLjABAAAAQERLUS1XLl1qZMZDkibRWUdHGBAoG0pJq_5hAj3XjIZXnxgtW_CcE17nuHHfikpQ',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

params = {
    'device_platform': 'webapp',
    'aid': '6383',
    'channel': 'channel_pc_web',
    'sec_user_id': 'MS4wLjABAAAAQERLUS1XLl1qZMZDkibRWUdHGBAoG0pJq_5hAj3XjIZXnxgtW_CcE17nuHHfikpQ',
    # 'sec_user_id': 'MS4wLjABAAAAMbqnWxzUfZegt9vrNBDz7zyqwhvG6vXiKTDxVm2wUD0',
    'max_cursor': '0',
    'locate_query': 'false',
    'show_live_replay_strategy': '1',
    'need_time_list': '1',
    'time_list_query': '0',
    'whale_cut_token': '',
    'cut_version': '1',
    'count': '18',
    'publish_video_strategy_type': '2',
    'update_version_code': '170400',
    'pc_client_type': '1',
    'version_code': '290100',
    'version_name': '29.1.0',
    'cookie_enabled': 'true',
    'screen_width': '1496',
    'screen_height': '967',
    'browser_language': 'zh-CN',
    'browser_platform': 'MacIntel',
    'browser_name': 'Chrome',
    'browser_version': '124.0.0.0',
    'browser_online': 'true',
    'engine_name': 'Blink',
    'engine_version': '124.0.0.0',
    'os_name': 'Mac OS',
    'os_version': '10.15.7',
    'cpu_core_num': '10',
    'device_memory': '8',
    'platform': 'PC',
    'downlink': '10',
    'effective_type': '4g',
    'round_trip_time': '50',
    'webid': '7371422219199055371',
    'msToken': '3s-LccsXn3fiNZBEu8RgmcE78rsgt_xKGDeRt-cvsDB9eUfzkDyRASgLECmUrcQxsv_FpKMP1t5N8F2Vifpw1OqQIb_8sVAxP5rW6yjOO0LgceRM0rnOmZ9Xf_AXjQ==',
    'verifyFp': 'verify_lwgcjh0e_udGDRuN5_9fTy_4qTG_BH8Q_HDyjHdPb890q',
    'fp': 'verify_lwgcjh0e_udGDRuN5_9fTy_4qTG_BH8Q_HDyjHdPb890q',
}

params_str = urllib.parse.urlencode(params)
print(params_str)
a_bogus = execjs.compile(open("douyin.js").read()).call("get_a_bogus", params_str)
print("a_bogus:::",a_bogus)

params["a_bogus"] = a_bogus

response = requests.get('https://www.douyin.com/aweme/v1/web/aweme/post/', params=params, headers=headers)

print(":::",response.text)

