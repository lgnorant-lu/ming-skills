import time
import requests
from lxml import etree
from openpyxl import Workbook


wb = Workbook()
sheet = wb.active
sheet.append(['标题','薪资','职位介绍'])


def spider(page):
    cookies = {
        '__gc_id': '311e5b1aff5c4945b89848520ff1fbce',
        '_ga': 'GA1.1.81049838.1760669246',
        '__uuid': '1760669245714.10',
        'access_system': 'C',
        'need_bind_tel': 'false',
        'new_user': 'true',
        'c_flag': 'dbfaac69dc48b6441e9ddefd97c69b07',
        'UniqueKey': 'f0fdf38f2920cbaa40d501f6e766523c',
        'liepin_login_valid': '0',
        'lt_auth': '6rxYPHICmgivtiLf3GFX465Oj9r8UGvO93lZgRoCgtbuUqXh4P%2FrRQKPqbMA9CoIqxl0JfgzMLf4Ne74wHdO7EcQ%2BlGnlZ6uv%2Fu9z34HT%2FphIsW2vezHg%2FXUQp0lkkAA8nJbpEIL%2BVzO',
        'imId': 'd8f663d6597a2f9398cef4fc780f1093',
        'imId_0': 'd8f663d6597a2f9398cef4fc780f1093',
        'imClientId': 'd8f663d6597a2f9301e00898fe032587',
        'imClientId_0': 'd8f663d6597a2f9301e00898fe032587',
        'inited_user': '727c407f759c327418e807ae7af0ea9b',
        'user_roles': '0',
        'user_photo': '5f8fa3a8ea60860b75385c7208u.png',
        'user_name': '%E8%AF%B7%E6%B1%82',
        'XSRF-TOKEN': 'YBrWG2izRqeDcG46S5TZ2w',
        '__tlog': '1760692362231.16%7C00000000%7C00000000%7C00000000%7C00000000',
        'Hm_lvt_a2647413544f5a04f00da7eee0d5e200': '1760669246,1760688258,1760692362',
        'HMACCOUNT': 'F4037280F82AFFB1',
        '__sessionId': '1760692362231.16',
        'hpo_role-sec_project': 'sec_project_liepin',
        'hpo_sec_tenant': '0',
        'imApp_0': '1',
        'acw_tc': 'ac11000117607087652992111e6c867da06e37f1dfeb1dbab8970cdd20a106',
        '_ga_54YTJKWN86': 'GS2.1.s1760708810$o4$g0$t1760708810$j60$l0$h0',
        'Hm_lpvt_a2647413544f5a04f00da7eee0d5e200': '1760708812',
        'fe_im_connectJson_0': '%7B%220_f0fdf38f2920cbaa40d501f6e766523c%22%3A%7B%22socketConnect%22%3A%221%22%2C%22connectDomain%22%3A%22liepin.com%22%7D%7D',
        'fe_im_opened_pages': '1760694056596_1760692998866_1760692388892_1760692528107_1760708815110',
        'fe_im_socketSequence_new_0': '14_14_14',
        '__session_seq': '58',
        '__tlg_event_seq': '236',
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
        'X-Fscp-Bi-Stat': '{"location": "https://www.liepin.com/company-jobs/8134400/"}',
        'X-Fscp-Fe-Version': '',
        'X-Fscp-Std-Info': '{"client_id": "40108"}',
        'X-Fscp-Trace-Id': '86afc43f-de2d-4e00-9297-eac3837f54cf',
        'X-Fscp-Version': '1.1',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': 'YBrWG2izRqeDcG46S5TZ2w',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        # 'Cookie': '__gc_id=311e5b1aff5c4945b89848520ff1fbce; _ga=GA1.1.81049838.1760669246; __uuid=1760669245714.10; access_system=C; need_bind_tel=false; new_user=true; c_flag=dbfaac69dc48b6441e9ddefd97c69b07; UniqueKey=f0fdf38f2920cbaa40d501f6e766523c; liepin_login_valid=0; lt_auth=6rxYPHICmgivtiLf3GFX465Oj9r8UGvO93lZgRoCgtbuUqXh4P%2FrRQKPqbMA9CoIqxl0JfgzMLf4Ne74wHdO7EcQ%2BlGnlZ6uv%2Fu9z34HT%2FphIsW2vezHg%2FXUQp0lkkAA8nJbpEIL%2BVzO; imId=d8f663d6597a2f9398cef4fc780f1093; imId_0=d8f663d6597a2f9398cef4fc780f1093; imClientId=d8f663d6597a2f9301e00898fe032587; imClientId_0=d8f663d6597a2f9301e00898fe032587; inited_user=727c407f759c327418e807ae7af0ea9b; user_roles=0; user_photo=5f8fa3a8ea60860b75385c7208u.png; user_name=%E8%AF%B7%E6%B1%82; XSRF-TOKEN=YBrWG2izRqeDcG46S5TZ2w; __tlog=1760692362231.16%7C00000000%7C00000000%7C00000000%7C00000000; Hm_lvt_a2647413544f5a04f00da7eee0d5e200=1760669246,1760688258,1760692362; HMACCOUNT=F4037280F82AFFB1; __sessionId=1760692362231.16; hpo_role-sec_project=sec_project_liepin; hpo_sec_tenant=0; imApp_0=1; acw_tc=ac11000117607087652992111e6c867da06e37f1dfeb1dbab8970cdd20a106; _ga_54YTJKWN86=GS2.1.s1760708810$o4$g0$t1760708810$j60$l0$h0; Hm_lpvt_a2647413544f5a04f00da7eee0d5e200=1760708812; fe_im_connectJson_0=%7B%220_f0fdf38f2920cbaa40d501f6e766523c%22%3A%7B%22socketConnect%22%3A%221%22%2C%22connectDomain%22%3A%22liepin.com%22%7D%7D; fe_im_opened_pages=1760694056596_1760692998866_1760692388892_1760692528107_1760708815110; fe_im_socketSequence_new_0=14_14_14; __session_seq=58; __tlg_event_seq=236',
    }

    json_data = {
        'data': {
            'compJobSearchCondition': {
                'compId': 8134400,
                'dq': '',
                'jobTitleCode': '',
                'pageSize': 30,
                'curPage': int(page),
            },
            'passThroughForm': {
                'ckId': 'khe9loajavbsqnct8jdd44xdzmq00zxb',
                'scene': 'page',
                'skId': '9fvg5dk66pb3t2xsx1ld5pfa5hkjxa39',
                'fkId': '9fvg5dk66pb3t2xsx1ld5pfa5hkjxa39',
                'sfrom': 'search_job_comp_prime_pc',
            },
        },
    }
    try:
        response = requests.post(
            'https://api-c.liepin.com/api/com.liepin.searchfront4c.pc-comp-homepage-search-job',
            cookies=cookies,
            headers=headers,
            json=json_data,
        ).json()
        # print(response)
        resp1 = response['data']['data']
        page_data_count = 0

        for i in resp1:
            try:
                job = i['job']
                # 标题
                title = job['title']
                # 薪资
                salary = job['salary']
                url = job['link']
                time.sleep(1)
                # 请求详情页
                xiang_resp = requests.get(url,headers=headers,cookies=cookies).text
                xiang_resp1 = etree.HTML(xiang_resp)
                job_intro_elements  = xiang_resp1.xpath('//dl[@class="paragraph"][1]/dt')
                # print(zz)
                for o in job_intro_elements :
                    job_intro = "".join(o.xpath('//dd[@data-selector="job-intro-content"]/text()')).replace(' ','').replace('\n','').replace('\r','')if job_intro_elements else "暂无职位介绍"
                    print('标题',title,'薪资',salary,"职位介绍:", job_intro)
                    sheet.append([title,salary,job_intro])
                    page_data_count += 1
            except Exception as e:
                print(f"出错: {e}")
            continue
        return page_data_count  # 添加这行，返回成功处理的数据数量

    except Exception as e:
        print(f"请求第{page}页时出错: {e}")
        return 0


def main():
    total_data_count = 0
    for page in range(0,20):
        print(f'开始爬取第{page}页数据')
        page_data_count = spider(page)
        total_data_count += page_data_count

        # 每爬取一页就保存一次
        try:
            wb.save('猎聘数据.xlsx')
            print(f"第{page}页数据已保存，当前累计数据: {total_data_count}条")
        except Exception as e:
            print(f"保存文件时出错: {e}")

    print(f"爬取完成！总共获取{total_data_count}条数据")


if __name__ == '__main__':
    main()