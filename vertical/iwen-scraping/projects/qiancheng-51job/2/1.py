import re
import requests
from urllib.parse import quote


class AcwTc:
    KEY = "3000176000856006061501533003690027800375"

    @staticmethod
    def get_acw_sc_v2(arg1):
        unsbox_result = AcwTc.unsbox(arg1)
        xor_result = AcwTc.hex_xor(unsbox_result, AcwTc.KEY)
        return xor_result.lower()

    @staticmethod
    def hex_xor(s1, s2):
        result = ""
        length = min(len(s1), len(s2))

        for i in range(0, length, 2):
            num1 = int(s1[i:i + 2], 16)
            num2 = int(s2[i:i + 2], 16)
            xor_result = num1 ^ num2
            result += format(xor_result, '02X')
        return result

    @staticmethod
    def unsbox(s):
        positions = [15, 35, 29, 24, 33, 16, 1, 38, 10, 9, 19, 31, 40, 27, 22, 23,
                     25, 13, 6, 11, 39, 18, 20, 8, 14, 21, 32, 26, 2, 30, 7,
                     4, 17, 5, 3, 28, 34, 37, 12, 36]
        result = [''] * len(positions)

        for i in range(len(s)):
            for j in range(len(positions)):
                if positions[j] == i + 1:
                    result[j] = s[i]
                    break

        filtered = ''.join(result)
        return filtered


def main():
    url = "https://we.51job.com/api/job/search-pc"

    # 第一次请求获取arg1
    response = requests.get(url)
    if response.status_code == 200 and "var arg1='" in response.text:
        pattern = re.compile(r"var\s+arg1\s*=\s*'([A-F0-9]+)'")
        match = pattern.search(response.text)
        if match:
            arg1_value = match.group(1)
            acw_sc = AcwTc.get_acw_sc_v2(arg1_value)

            acw_sc_v2_cookie = f"acw_sc__v2={acw_sc}"
            print(acw_sc_v2_cookie)

            # 第二次请求带上cookie
            headers = {
                'Cookie': acw_sc_v2_cookie,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            response2 = requests.get(url, headers=headers)
            print("response:\n" + response2.text)
        else:
            print("response:\n" + response.text)
    else:
        print(f"请求失败，状态码: {response.status_code}")


if __name__ == "__main__":
    main()