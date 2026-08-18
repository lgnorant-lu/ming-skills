import time
import pandas as pd
from DrissionPage import Chromium
from fontTools.ttLib import TTFont
import ddddocr
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont


def convert_cmap_to_image(cmap_code, font_path):
    img_size = 1024
    # 准备三要素：image画布  draw画笔 font字体
    img = Image.new("1", (img_size, img_size), 255)  # 创建一个黑白图像对象
    draw = ImageDraw.Draw(img)  # 创建绘图对象
    font = ImageFont.truetype(font_path, img_size)  # 加载字体文件

    # 将 cmap code 转换为字符
    character = chr(cmap_code)
    # print("character:",character)
    bbox = draw.textbbox((0, 0), character, font=font)  # 获取文本在图像中的边界框
    width = bbox[2] - bbox[0]  # 文本的宽度
    height = bbox[3] - bbox[1]  # 文本的高度
    draw.text(((img_size - width) // 2, (img_size - height) // 2), character, font=font)  # 绘制文本，并居中显示
    return img


def extract_text_from_font(font_path):
    font = TTFont(font_path)  # 加载字体文件
    # font.saveXML("xxx.xml")
    # # 图像识别的模块：DdddOcr
    ocr = ddddocr.DdddOcr(beta=True, show_ad=False)  # 实例化 ddddocr 对象

    print("font.getBestCmap().items():", font.getBestCmap().items())

    font_map = {}
    for cmap_code, glyph_name in font.getBestCmap().items():
        image = convert_cmap_to_image(cmap_code, font_path)  # 将字体字符转换为图像

        # 提取图像字符
        bytes_io = BytesIO()
        image.save(bytes_io, "PNG")
        text = ocr.classification(bytes_io.getvalue())  # 图像识别
        # print("text:", text)
        # image.save(f"./imgs/{text}.png", "PNG")  # 保存图像

        # print(f"Unicode码点：{cmap_code} - Unicode字符:{glyph_name}，识别结果：{text}")
        font_map[hex(cmap_code).replace('0x', '')] = text

    return font_map


font_file_path = "boos.woff2"
from_data = extract_text_from_font(font_file_path)
# print(from_data)


web = Chromium()

try:
    tab = web.latest_tab

    tab.get('https://www.zhipin.com/web/geek/jobs?city=100010000&degree=202,203,204,205&query=%E8%89%BA%E9%BE%99%E8%AE%A2%E5%8D%95%E4%BA%A7%E5%93%81%E7%BB%8F%E7%90%86')
    all_data = []  # 存储所有职位数据
    div_list = tab.ele('.rec-job-list').children('t:div')
    # print(len(div_list))
    for div in div_list:
        div.ele('.job-name').click()
        # 标题
        job_name = div.ele('.job-name').text
        # 企业
        boos_name = div.ele('.boss-name').text
        # 薪资
        money = div.ele('.job-salary').text.replace('\ue032', '1').replace('\ue033', '2').replace('\ue034',
                                                                                                  '3').replace('\ue035',
                                                                                                               '4').replace(
            '\ue036', '5').replace('\ue037', '6').replace('\ue038', '7').replace('\ue039', '8').replace('\ue03a', '9').replace('\ue031','0')
        # j = from_data[repr(money)[3:-1]]
        # 要求
        requirement = div.ele('.tag-list').text.replace('\n', '').replace('\r', '')
        body = tab.ele('.job-detail-body')
        # 职责
        experience = body.child(index=4).text.replace('\n', '').replace('\r', '')
        # print(title,requirement,experience)
        all_data.append({
            '岗位名称': job_name,
            '企业':boos_name,
            '岗位薪资': money,
            '岗位要求': requirement,
            '岗位职责': experience
        })
        print(all_data[-1])
        time.sleep(2)

        if all_data:
            df = pd.DataFrame(all_data)
            df.to_excel('boss_zhipin_jobs.xlsx', index=False)
            print(f"成功保存{len(all_data)}条数据到boss_zhipin_jobs.xlsx")
        else:
            print("未获取到有效数据")
except Exception as e:
    print(f"程序运行出错: {str(e)}")
