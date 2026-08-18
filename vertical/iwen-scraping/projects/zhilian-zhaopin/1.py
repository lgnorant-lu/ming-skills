import requests

cookies = {
    'x-zp-client-id': 'b4eb88e1-3951-492f-a2e2-288f9571881c',
    'sensorsdata2015jssdkchannel': '%7B%22prop%22%3A%7B%22_sa_channel_landing_url%22%3A%22%22%7D%7D',
    'Hm_lvt_7fa4effa4233f03d11c7e2c710749600': '1757754459',
    'HMACCOUNT': 'F4037280F82AFFB1',
    'LastCity': '%E4%B8%8A%E6%B5%B7',
    'LastCity%5Fid': '538',
    'locationInfo_search': '{%22code%22:%22%22}',
    'zp_passport_deepknow_sessionId': 'a2529dfasc5ed5441c8228717f117e2680a3',
    'ZP_OLD_FLAG': 'false',
    'sts_deviceid': '19942975ac881f-0eee8a0a3c1fb2-26061951-3686400-19942975ac9f66',
    'sts_sg': '1',
    'sts_evtseq': '1',
    'sts_sid': '19942975acbe3f-0cc6c3f50fefaf8-26061951-3686400-19942975acc163c',
    'sts_chnlsid': 'Unknown',
    'zp_src_url': 'https%3A%2F%2Fwww.zhaopin.com%2F',
    'at': '597a0b9b05564a0789956a20c08141b5',
    'rt': 'e0f2edb37b2343f7a096f744d8056820',
    'sensorsdata2015jssdkcross': '%7B%22distinct_id%22%3A%221240870328%22%2C%22first_id%22%3A%22197cf379c0ce07-0062bf74a8475b6-26011e51-3686400-197cf379c0deb6%22%2C%22props%22%3A%7B%22%24latest_traffic_source_type%22%3A%22%E7%9B%B4%E6%8E%A5%E6%B5%81%E9%87%8F%22%2C%22%24latest_search_keyword%22%3A%22%E6%9C%AA%E5%8F%96%E5%88%B0%E5%80%BC_%E7%9B%B4%E6%8E%A5%E6%89%93%E5%BC%80%22%2C%22%24latest_referrer%22%3A%22%22%7D%2C%22identities%22%3A%22eyIkaWRlbnRpdHlfY29va2llX2lkIjoiMTk3Y2YzNzljMGNlMDctMDA2MmJmNzRhODQ3NWI2LTI2MDExZTUxLTM2ODY0MDAtMTk3Y2YzNzljMGRlYjYiLCIkaWRlbnRpdHlfbG9naW5faWQiOiIxMjQwODcwMzI4In0%3D%22%2C%22history_login_id%22%3A%7B%22name%22%3A%22%24identity_login_id%22%2C%22value%22%3A%221240870328%22%7D%2C%22%24device_id%22%3A%22197cf379c0ce07-0062bf74a8475b6-26011e51-3686400-197cf379c0deb6%22%7D',
    'ZL_REPORT_GLOBAL': '{%22//www%22:{%22seid%22:%22%22%2C%22actionid%22:%22cf38e4f8-2ecd-4434-8602-ccb0fe26ca78-cityPage%22}%2C%22/resume/new%22:{%22actionid%22:%2258ee647d-a60a-47fc-ae72-8aa169f7fe2e%22%2C%22funczone%22:%22addrsm_ok_rcm%22}%2C%22jobs%22:{%22recommandActionidShare%22:%229ebd0574-d59e-44e2-805b-8375442b1418-job%22}}',
    'Hm_lpvt_7fa4effa4233f03d11c7e2c710749600': '1757759169',
}

headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'cache-control': 'no-cache',
    'content-type': 'application/json;charset=UTF-8',
    'origin': 'https://www.zhaopin.com',
    'pragma': 'no-cache',
    'priority': 'u=1, i',
    'referer': 'https://www.zhaopin.com/',
    'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'x-zp-business-system': '1',
    'x-zp-page-code': '4019',
    'x-zp-platform': '13',
    # 'cookie': 'x-zp-client-id=b4eb88e1-3951-492f-a2e2-288f9571881c; sensorsdata2015jssdkchannel=%7B%22prop%22%3A%7B%22_sa_channel_landing_url%22%3A%22%22%7D%7D; Hm_lvt_7fa4effa4233f03d11c7e2c710749600=1757754459; HMACCOUNT=F4037280F82AFFB1; LastCity=%E4%B8%8A%E6%B5%B7; LastCity%5Fid=538; locationInfo_search={%22code%22:%22%22}; zp_passport_deepknow_sessionId=a2529dfasc5ed5441c8228717f117e2680a3; ZP_OLD_FLAG=false; sts_deviceid=19942975ac881f-0eee8a0a3c1fb2-26061951-3686400-19942975ac9f66; sts_sg=1; sts_evtseq=1; sts_sid=19942975acbe3f-0cc6c3f50fefaf8-26061951-3686400-19942975acc163c; sts_chnlsid=Unknown; zp_src_url=https%3A%2F%2Fwww.zhaopin.com%2F; at=597a0b9b05564a0789956a20c08141b5; rt=e0f2edb37b2343f7a096f744d8056820; sensorsdata2015jssdkcross=%7B%22distinct_id%22%3A%221240870328%22%2C%22first_id%22%3A%22197cf379c0ce07-0062bf74a8475b6-26011e51-3686400-197cf379c0deb6%22%2C%22props%22%3A%7B%22%24latest_traffic_source_type%22%3A%22%E7%9B%B4%E6%8E%A5%E6%B5%81%E9%87%8F%22%2C%22%24latest_search_keyword%22%3A%22%E6%9C%AA%E5%8F%96%E5%88%B0%E5%80%BC_%E7%9B%B4%E6%8E%A5%E6%89%93%E5%BC%80%22%2C%22%24latest_referrer%22%3A%22%22%7D%2C%22identities%22%3A%22eyIkaWRlbnRpdHlfY29va2llX2lkIjoiMTk3Y2YzNzljMGNlMDctMDA2MmJmNzRhODQ3NWI2LTI2MDExZTUxLTM2ODY0MDAtMTk3Y2YzNzljMGRlYjYiLCIkaWRlbnRpdHlfbG9naW5faWQiOiIxMjQwODcwMzI4In0%3D%22%2C%22history_login_id%22%3A%7B%22name%22%3A%22%24identity_login_id%22%2C%22value%22%3A%221240870328%22%7D%2C%22%24device_id%22%3A%22197cf379c0ce07-0062bf74a8475b6-26011e51-3686400-197cf379c0deb6%22%7D; ZL_REPORT_GLOBAL={%22//www%22:{%22seid%22:%22%22%2C%22actionid%22:%22cf38e4f8-2ecd-4434-8602-ccb0fe26ca78-cityPage%22}%2C%22/resume/new%22:{%22actionid%22:%2258ee647d-a60a-47fc-ae72-8aa169f7fe2e%22%2C%22funczone%22:%22addrsm_ok_rcm%22}%2C%22jobs%22:{%22recommandActionidShare%22:%229ebd0574-d59e-44e2-805b-8375442b1418-job%22}}; Hm_lpvt_7fa4effa4233f03d11c7e2c710749600=1757759169',
}

params = {
    'MmEwMD': '5D0M97hbOSBLoxzJhKUCMuTtHP_Q20XVQxJoZObg_OC0cl0zJqvjCdUBMwi2bEQdCOh1wUoxvWbg2D9yAGwpUo0XB4o9KkXKmbzZ1Q_wTHbs683rU8iAdPpBWRbMy7r9Z6_EV9PAIs_i.iZUMqDVnzMva8lN_KARf084_O5WRGJ_IXY6iyJoyW8Y6Ic56cM.p5PRwISkCkUHu.7P7BPnJGhWNZ6YGnMv8emMlrnXDrwCcgDoan7KCCSSyVbw4ZNNwdzeS1IENSxF_R3Po.L90n9eviINQeQ0a3AdSGHzTMBBI4epRqS6aqMck5EowJmEVNz5qlKdHrmt56V2IImsbAc9usrv7ZMxgplO1nQ7gPiOSuVms2VFrskacmkMTQ9.1CG0DvWRSNOheo3YXuuOirG',
    'c1K5tw0w6_': '4VpaSdMq4PD8yogFB.VEY1WaOMuWtX_6hVn4zp1OvPnWdmSMAtlaItUeKq1J1nHWcJaub4Ypd9lJXtEunAMQZwSxnHYfBfvUUiiqJZctibo5VrHgsm80.ruB6efrRw9XPK_zBkrXXUAnNVKbdzgcgrVDZHiiRp0bG7rZViyy0wApVNxIAs5F_Gvctkbz_UpDnQB2R0zydO7OfLf3JUBiHj4mlheQC1HvcGhY5FHMLTu4oVufEbjQZcPwzPm54U1BX6eRFzcU6rEQCVMa2LogWYnp2jFNApjunoL8XNKLhUZMTTogIyrwHb2E1XX1Lx7db14BTfBz27vMRvey9WEDWb4q2R6U1fN0minLPkyfGh.U9hQa2TtwMEHRA4lNlrYsXxLucgOKXIyF2XQ788yku6zR8yyhoDs7kYfejoKZtq6htHXfGLT.1cuLKShmbZfGsP295YNbC83Io_Lu2SstAHa',
}

json_data = {
    'S_SOU_FULL_INDEX': '道路',
    'S_SOU_WORK_CITY': '538',
    'order': 11,
    'pageSize': 20,
    'pageIndex': 1,
    'eventScenario': 'pcSearchedSouSearch',
    'anonymous': 0,
}

response = requests.post(
    'https://fe-api.zhaopin.com/c/i/search/positions',
    params=params,
    cookies=cookies,
    headers=headers,
    json=json_data,
)


print(response.text)

# Note: json_data will not be serialized by requests
# exactly as it was in the original request.
#data = '{"S_SOU_FULL_INDEX":"道路","S_SOU_WORK_CITY":"538","order":11,"pageSize":20,"pageIndex":8,"eventScenario":"pcSearchedSouSearch","anonymous":0}'.encode()
#response = requests.post(
#    'https://fe-api.zhaopin.com/c/i/search/positions',
#    params=params,
#    cookies=cookies,
#    headers=headers,
#    data=data,
#)