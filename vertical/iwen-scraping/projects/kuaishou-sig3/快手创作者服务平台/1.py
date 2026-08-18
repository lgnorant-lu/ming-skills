# https://cp.kuaishou.com/growth/main

# 参数：__NS_sig3

import requests


def spider():

    cookies = {
        'bUserId': '1000357939289',
        'userId': '2888170506',
        'kuaishou.web.cp.api_st': 'ChZrdWFpc2hvdS53ZWIuY3AuYXBpLnN0ErABELo4wPKc1PpmlxlfpoduhdtSj8l63kobv40HbBWG9iLHi-pOq_d_JRt033_snbda2KOw5ZdzymndrnJWSyLZDat2C2n6XKbIY_AFjUtdNiOnjdAIw1AH8F4jXqVHC6R8qW6oqrLUGzcUI27Gxrgv39wYrJTcsvjBoJAO3ynP83vAeUp_a8hJ6iR70dlzjGPJGIpG4WuO00cofQAztcKf_LAhx_p48t8XqSrWPfThZEsaEigiXAXbikfxY_eaMpqy56wmIiIgcsg-DPWdCM8q7tlAeXy2sWpnDLfr4eNWtW9reV8wpAkoBTAB',
        'kuaishou.web.cp.api_ph': 'a121bac70fc843d3388dc72e4bd4f9a4ca6c',
        'did': 'web_97a4ba65da1f722ceb544256d004adb1',
        'kwfv1': 'PnGU+9+Y8008S+nH0U+0mjPf8fP08f+98f+nLlwnrIP9+Sw/ZFGfzY+eGlGf+f+e4SGfbYP0QfGnLFwBLU80mYG9GMGAYfP0+08nQD+/Hlwe4SG/Q0G/Zl+BzS+/HA8nQ080mD8eWhP/Zh8n8jweG7wBrl+emD+nrlPf+SG9pf+0P=',
    }

    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json;charset=UTF-8',
        'Origin': 'https://cp.kuaishou.com',
        'Pragma': 'no-cache',
        'Referer': 'https://cp.kuaishou.com/growth/main',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'returnSetRootDomainLoginUrl': 'true',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        # 'Cookie': 'bUserId=1000357939289; userId=2888170506; kuaishou.web.cp.api_st=ChZrdWFpc2hvdS53ZWIuY3AuYXBpLnN0ErABELo4wPKc1PpmlxlfpoduhdtSj8l63kobv40HbBWG9iLHi-pOq_d_JRt033_snbda2KOw5ZdzymndrnJWSyLZDat2C2n6XKbIY_AFjUtdNiOnjdAIw1AH8F4jXqVHC6R8qW6oqrLUGzcUI27Gxrgv39wYrJTcsvjBoJAO3ynP83vAeUp_a8hJ6iR70dlzjGPJGIpG4WuO00cofQAztcKf_LAhx_p48t8XqSrWPfThZEsaEigiXAXbikfxY_eaMpqy56wmIiIgcsg-DPWdCM8q7tlAeXy2sWpnDLfr4eNWtW9reV8wpAkoBTAB; kuaishou.web.cp.api_ph=a121bac70fc843d3388dc72e4bd4f9a4ca6c; did=web_97a4ba65da1f722ceb544256d004adb1; kwfv1=PnGU+9+Y8008S+nH0U+0mjPf8fP08f+98f+nLlwnrIP9+Sw/ZFGfzY+eGlGf+f+e4SGfbYP0QfGnLFwBLU80mYG9GMGAYfP0+08nQD+/Hlwe4SG/Q0G/Zl+BzS+/HA8nQ080mD8eWhP/Zh8n8jweG7wBrl+emD+nrlPf+SG9pf+0P=',
    }

    params = {
        '__NS_sig3': 'acbcfbcb6483249798f1f2f32a7e576b29cd6589ededefefe0e1e2f8',
    }

    json_data = {
        'kuaishou.web.cp.api_ph': 'a121bac70fc843d3388dc72e4bd4f9a4ca6c',
    }

    response = requests.post(
        'https://cp.kuaishou.com/rest/v2/creator/pc/school/category/tree',
        params=params,
        cookies=cookies,
        headers=headers,
        json=json_data,
    ).text
    print(response)


def main():
    spider()


if __name__ == '__main__':
    main()