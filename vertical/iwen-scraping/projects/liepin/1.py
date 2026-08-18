import time
import requests
from lxml import etree
from openpyxl import Workbook


wb = Workbook()
sheet = wb.active
sheet.append(['标题','薪资','职位介绍'])


def spider(page):

    cookies = {
        'inited_user': '727c407f759c327418e807ae7af0ea9b',
        'XSRF-TOKEN': 'rrLK6CmGRA2ZPWH7fq_3cw',
        '__gc_id': '311e5b1aff5c4945b89848520ff1fbce',
        '_ga': 'GA1.1.81049838.1760669246',
        '__uuid': '1760669245714.10',
        'acw_tc': '1a0c650d17606692460553216ea25362717ab6d6b8bcb9b3ebed313f5ebdea',
        '__sessionId': '1760669245723.05',
        'Hm_lvt_a2647413544f5a04f00da7eee0d5e200': '1760669246',
        'HMACCOUNT': 'F4037280F82AFFB1',
        'access_system': 'C',
        'user_roles': '0',
        'need_bind_tel': 'false',
        'new_user': 'true',
        'c_flag': 'dbfaac69dc48b6441e9ddefd97c69b07',
        'hpo_role-sec_project': 'sec_project_liepin',
        'hpo_sec_tenant': '0',
        '__tlog': '1760669245723.05%7C00000000%7CR002017571%7Cs_o_001%7Cs_o_001',
        'UniqueKey': 'f0fdf38f2920cbaa40d501f6e766523c',
        'liepin_login_valid': '0',
        'lt_auth': '6rxYPHICmgivtiLf3GFX465Oj9r8UGvO93lZgRoCgtbuUqXh4P%2FrRQKPqbMA9CoIqxl0JfgzMLf4Ne74wHdO7EcQ%2BlGnlZ6uv%2Fu9z34HT%2FphIsW2vezHg%2FXUQp0lkkAA8nJbpEIL%2BVzO',
        'user_photo': '5f8fa3a8ea60860b75385c7208u.png',
        'user_name': '%E8%AF%B7%E6%B1%82',
        'inited_user': '727c407f759c327418e807ae7af0ea9b',
        'imId': 'd8f663d6597a2f9398cef4fc780f1093',
        'imId_0': 'd8f663d6597a2f9398cef4fc780f1093',
        'imClientId': 'd8f663d6597a2f9301e00898fe032587',
        'imClientId_0': 'd8f663d6597a2f9301e00898fe032587',
        'imApp_0': '1',
        'fe_im_connectJson_0': '%7B%220_f0fdf38f2920cbaa40d501f6e766523c%22%3A%7B%22socketConnect%22%3A%221%22%2C%22connectDomain%22%3A%22liepin.com%22%7D%7D',
        '_ga_54YTJKWN86': 'GS2.1.s1760669245$o1$g1$t1760670119$j60$l0$h0',
        'Hm_lpvt_a2647413544f5a04f00da7eee0d5e200': '1760670123',
        'fe_im_opened_pages': '1760669936292_1760669967134_1760670128731',
        'fe_im_socketSequence_new_0': '5_5_2',
        '__session_seq': '28',
        '__tlg_event_seq': '326',
    }

    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json;charset=UTF-8',
        'Origin': 'https://www.liepin.com',
        'Pragma': 'no-cache',
        'Referer': 'https://www.liepin.com/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'X-Client-Type': 'web',
        'X-Fscp-Bi-Stat': '{"location": "https://www.liepin.com/company-jobs/985012/"}',
        'X-Fscp-Fe-Version': '',
        'X-Fscp-Std-Info': '{"client_id": "40108"}',
        'X-Fscp-Trace-Id': '489b9595-70a7-4861-9c50-c1ec46e59e97',
        'X-Fscp-Version': '1.1',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': 'rrLK6CmGRA2ZPWH7fq_3cw',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        # 'Cookie': 'inited_user=727c407f759c327418e807ae7af0ea9b; XSRF-TOKEN=rrLK6CmGRA2ZPWH7fq_3cw; __gc_id=311e5b1aff5c4945b89848520ff1fbce; _ga=GA1.1.81049838.1760669246; __uuid=1760669245714.10; acw_tc=1a0c650d17606692460553216ea25362717ab6d6b8bcb9b3ebed313f5ebdea; __sessionId=1760669245723.05; Hm_lvt_a2647413544f5a04f00da7eee0d5e200=1760669246; HMACCOUNT=F4037280F82AFFB1; access_system=C; user_roles=0; need_bind_tel=false; new_user=true; c_flag=dbfaac69dc48b6441e9ddefd97c69b07; hpo_role-sec_project=sec_project_liepin; hpo_sec_tenant=0; __tlog=1760669245723.05%7C00000000%7CR002017571%7Cs_o_001%7Cs_o_001; UniqueKey=f0fdf38f2920cbaa40d501f6e766523c; liepin_login_valid=0; lt_auth=6rxYPHICmgivtiLf3GFX465Oj9r8UGvO93lZgRoCgtbuUqXh4P%2FrRQKPqbMA9CoIqxl0JfgzMLf4Ne74wHdO7EcQ%2BlGnlZ6uv%2Fu9z34HT%2FphIsW2vezHg%2FXUQp0lkkAA8nJbpEIL%2BVzO; user_photo=5f8fa3a8ea60860b75385c7208u.png; user_name=%E8%AF%B7%E6%B1%82; inited_user=727c407f759c327418e807ae7af0ea9b; imId=d8f663d6597a2f9398cef4fc780f1093; imId_0=d8f663d6597a2f9398cef4fc780f1093; imClientId=d8f663d6597a2f9301e00898fe032587; imClientId_0=d8f663d6597a2f9301e00898fe032587; imApp_0=1; fe_im_connectJson_0=%7B%220_f0fdf38f2920cbaa40d501f6e766523c%22%3A%7B%22socketConnect%22%3A%221%22%2C%22connectDomain%22%3A%22liepin.com%22%7D%7D; _ga_54YTJKWN86=GS2.1.s1760669245$o1$g1$t1760670119$j60$l0$h0; Hm_lpvt_a2647413544f5a04f00da7eee0d5e200=1760670123; fe_im_opened_pages=1760669936292_1760669967134_1760670128731; fe_im_socketSequence_new_0=5_5_2; __session_seq=28; __tlg_event_seq=326',
    }

    json_data = {
        'data': {
            'compJobSearchCondition': {
                'compId': 985012,
                'dq': '',
                'jobTitleCode': '',
                'pageSize': 30,
                'curPage': int(page),
            },
            'passThroughForm': {
                'sfrom': 'search_job_comp_prime_pc',
                'ckId': 'zuhl9wss3t4uttpmuoihfos9s4kjbkw9',
                'scene': 'page',
                'skId': 'g6cupvgctazdmu5ez61fvydqcc00z3pb',
                'fkId': 'g6cupvgctazdmu5ez61fvydqcc00z3pb',
            },
        },
    }

    response = requests.post(
        'https://api-c.liepin.com/api/com.liepin.searchfront4c.pc-comp-homepage-search-job',
        cookies=cookies,
        headers=headers,
        json=json_data,
    ).json()
    # print(response)
    resp1 = response['data']['data']

    for i in resp1:
        try:
            job = i['job']
            # 标题
            title = job['title']
            # 薪资
            salary = job['salary']
            url = job['link']
            time.sleep(2)
            # 请求详情页
            xiang_resp = requests.get(url,headers=headers,cookies=cookies).text
            xiang_resp1 = etree.HTML(xiang_resp)
            zz = xiang_resp1.xpath('//dl[@class="paragraph"][1]/dt')
            # print(zz)
            for o in zz:
                job_intro = "".join(o.xpath('//dd[@data-selector="job-intro-content"]/text()')).replace(' ','').replace('\n','').replace('\r','')
                print('标题',title,'薪资',salary,"职位介绍:", job_intro)
                sheet.append([title,salary,job_intro])
            # print(zz)
        # print(resp1)
        except Exception as e:
            continue


def main():
    for page in range(0,20):
        spider(page)
        wb.save('猎聘数据.xlsx')


if __name__ == '__main__':
    main()