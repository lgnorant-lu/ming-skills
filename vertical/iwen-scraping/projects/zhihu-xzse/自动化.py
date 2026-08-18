import time
import pandas as pd
from DrissionPage import Chromium

web = Chromium()

tab = web.latest_tab

# tab.get('https://www.zhihu.com/search?type=content&q=%E8%B4%B8%E6%98%93%E6%88%98')

# js_code = """
# for (let i=0; i<999; i++) clearInterval(i);
# setInterval (function (){
#     window.scrollBy(0,2000);
# }, 500);
# """
# # 执行js代码
# tab.run_js(js_code)

all_data = []


divs = tab.ele('@data-za-detail-view-path-module=SearchResultList').children('t:div')
for div in divs:
    try:
        if div.ele('.ContentItem-title'):
            title = div.ele('.Highlight').text
            dizhi1 = div.ele('.Highlight').parent('@target=_blank')
            dizhi2 = dizhi1.ele('xpath:/@href')
            dizhi = 'https://www.zhihu.com'+ str(dizhi2)
            # 进入详情页
            new_tab = div.ele('.Highlight').click.for_new_tab()
            if new_tab.ele('.RichContent-inner'):
                neirong = new_tab.ele('.RichContent-inner').text.replace(' ','').replace('\n','').replace('\r','')
                shijian = new_tab.ele('.ContentItem-time').text.replace(' ','').replace('\n','').replace('\r','')
                all_data.append({
                    '标题': title,
                    '内容': neirong,
                    '时间': shijian,
                    '网址': dizhi,
                })
                if all_data:
                    df = pd.DataFrame(all_data)
                    df.to_excel('知乎.xlsx', index=False)
                    print(f"成功保存{len(all_data)}条数据到知乎.xlsx")
                else:
                    print("未获取到有效数据")
                new_tab.close()

                print(title,'完成')
                # time.sleep(1)
                # break
            elif new_tab.ele('.css-376mun'):
                neirong = new_tab.ele('.css-376mun').text.replace(' ', '').replace('\n', '').replace('\r', '')
                shijian = new_tab.ele('.ContentItem-time').text.replace(' ', '').replace('\n', '').replace('\r', '')
                all_data.append({
                    '标题': title,
                    '内容': neirong,
                    '时间': shijian,
                    '网址': dizhi,
                })
                if all_data:
                    df = pd.DataFrame(all_data)
                    df.to_excel('知乎.xlsx', index=False)
                    print(f"成功保存{len(all_data)}条数据到知乎.xlsx")
                else:
                    print("未获取到有效数据")
                new_tab.close()

                print(title, '完成')
                # time.sleep(1)
        else:
            continue
    except Exception as e:
        print(f"程序运行出错: {str(e)}")
        continue