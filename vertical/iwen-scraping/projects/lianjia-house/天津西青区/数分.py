import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # 修复后端错误
import matplotlib.pyplot as plt
import seaborn as sns
import re
from collections import Counter

# 设置中文字体
plt.rcParams['font.sans-serif'] = ['SimHei']  # Windows
plt.rcParams['axes.unicode_minus'] = False  # 解决负号显示问题

# 重新读取数据并处理格式问题
data = []
with open('数据1.csv', 'r', encoding='utf-8') as f:
    for line in f:
        # 使用正则表达式匹配行结构
        match = re.match(r'(.+?),(.+?),(.+)', line.strip())
        if match:
            title, details, price_info = match.groups()
            # 提取总价和单价
            price_parts = price_info.split(',')
            total_price = price_parts[0]
            unit_price = price_parts[1] if len(price_parts) > 1 else ''

            # 提取户型信息
            room_match = re.search(r'(\d+室\d+厅)', details)
            room_type = room_match.group(1) if room_match else None

            # 提取面积信息
            area_match = re.search(r'(\d+\.?\d*)\s*平米', details)
            area = float(area_match.group(1)) if area_match else None

            # 提取总价数值 - 修复正则匹配错误
            total_price_value = None
            if total_price:
                price_match = re.search(r'(\d+\.?\d*)', total_price)
                if price_match:
                    total_price_value = float(price_match.group(1))

            # 提取区域信息
            areas = ['河西', '南开', '和平', '河东', '河北', '红桥', '西青', '津南', '北辰', '东丽',
                     '武清', '宝坻', '静海', '宁河', '蓟州', '滨海', '中北', '梅江', '大寺', '南站']
            region = '其他'
            for area_name in areas:
                if area_name in title:
                    region = area_name
                    break

            data.append({
                '标题': title,
                '详情': details,
                '总价': total_price_value,
                '单价': unit_price,
                '户型': room_type,
                '面积': area,
                '区域': region
            })

# 创建DataFrame
df = pd.DataFrame(data)

# 1. 区域房源数量统计
region_counts = df['区域'].value_counts()

plt.figure(figsize=(12, 6))
sns.barplot(x=region_counts.index, y=region_counts.values, palette="viridis")
plt.title('各区域房源数量分布')
plt.xlabel('区域')
plt.ylabel('房源数量')
plt.xticks(rotation=45)
plt.tight_layout()
plt.savefig('区域房源数量.png')
plt.close()

# 2. 户型数量分析
room_type_counts = df['户型'].value_counts().head(10)

plt.figure(figsize=(12, 6))
sns.barplot(x=room_type_counts.values, y=room_type_counts.index, palette="magma")
plt.title('最受欢迎的户型TOP10')
plt.xlabel('数量')
plt.ylabel('户型')
plt.tight_layout()
plt.savefig('户型数量分布.png')
plt.close()

# 3. 区域平均价格分析
# 过滤掉总价为None的行
df_price = df.dropna(subset=['总价'])
region_avg_price = df_price.groupby('区域')['总价'].mean().sort_values(ascending=False)

plt.figure(figsize=(14, 7))
ax = sns.barplot(x=region_avg_price.index, y=region_avg_price.values, palette="coolwarm")
plt.title('各区域平均房价')
plt.xlabel('区域')
plt.ylabel('平均总价(万元)')
plt.xticks(rotation=45)

# 添加折线图
ax2 = ax.twinx()
sns.lineplot(x=region_counts.index, y=region_counts.values, color='blue',
             marker='o', ax=ax2, label='房源数量')
ax2.set_ylabel('房源数量')

plt.legend(loc='upper right')
plt.tight_layout()
plt.savefig('区域平均价格.png')
plt.close()

# 4. 面积区间市场占有率
# 过滤掉面积为None的行
df_area = df.dropna(subset=['面积'])
bins = [0, 50, 70, 90, 110, 130, 150, 200, 300, 400, float('inf')]
labels = ['<50', '50-70', '70-90', '90-110', '110-130', '130-150', '150-200', '200-300', '300-400', '>400']
df_area['面积区间'] = pd.cut(df_area['面积'], bins=bins, labels=labels, right=False)
area_interval_counts = df_area['面积区间'].value_counts().sort_index()

plt.figure(figsize=(10, 10))
plt.pie(area_interval_counts, labels=area_interval_counts.index,
        autopct='%1.1f%%', startangle=90, colors=sns.color_palette("Set3"))
plt.title('面积区间市场占有率')
plt.tight_layout()
plt.savefig('面积区间分布.png')
plt.close()

# 生成分析报告
report = f"""
# 链家二手房数据分析报告

## 1. 区域房源分布
- 房源数量最多的区域: {region_counts.idxmax()} ({region_counts.max()}套)
- 房源数量最少的区域: {region_counts.idxmin()} ({region_counts.min()}套)
- 区域分布热力图已保存为: 区域房源数量.png

## 2. 户型受欢迎程度
- 最受欢迎的户型: {room_type_counts.idxmax()} ({room_type_counts.max()}套)
- 户型分布TOP5:
{room_type_counts.head().to_string()}
- 户型分布图已保存为: 户型数量分布.png

## 3. 区域价格分析
- 平均房价最高的区域: {region_avg_price.idxmax()} ({region_avg_price.max():.1f}万元)
- 平均房价最低的区域: {region_avg_price.idxmin()} ({region_avg_price.min():.1f}万元)
- 区域价格与数量关系图已保存为: 区域平均价格.png

## 4. 面积区间分布
- 主流面积区间: {area_interval_counts.idxmax()} (占比{area_interval_counts.max() / area_interval_counts.sum():.1%})
- 面积区间分布图已保存为: 面积区间分布.png
"""

print(report)

# 将报告保存为文本文件
with open('链家数据分析报告.txt', 'w', encoding='utf-8') as f:
    f.write(report)