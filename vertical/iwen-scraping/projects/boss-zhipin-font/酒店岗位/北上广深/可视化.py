import pandas as pd
from pyecharts import options as opts
from pyecharts.charts import Bar, Line, Pie, Grid, WordCloud
from pyecharts.globals import ThemeType

# 模拟数据结构（需替换为你的真实数据路径）
data = pd.read_csv("C:\Users\PC\Desktop\\boos直聘北上广深酒店数据.xlsx")  # 包含4个字段：岗位名称、薪资、学历、岗位职责
# data = data[data["城市"].isin(["北京", "上海", "广州", "深圳"])]  # 确保仅4个城市
print(data)