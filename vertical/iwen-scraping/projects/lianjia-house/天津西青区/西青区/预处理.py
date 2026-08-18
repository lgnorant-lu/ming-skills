# 房产数据预处理
import pandas as pd
import re
from io import StringIO

# 原始数据
raw_data = """亲和美园 大产权 电梯房 可以贷款必看好房,2室1厅 | 75.16平米 | 西南 | 毛坯 | 高楼层(共23层) | 板楼,45万5,988元/平
清枫园通透大一室 中间楼层 采光视野好,1室1厅 | 67.72平米 | 南 北 | 其他 | 高楼层(共18层) | 板楼,85万12,552元/平"""

# 将原始数据转换为DataFrame
df = pd.read_csv(StringIO(raw_data), header=None, names=['title', 'details', 'price_info'])


# 数据解析函数
def parse_property_data(row):
    # 初始化所有可能变量
    room_info = area = orientation = renovation = building_type = None
    floor_level = current_floor = total_floors = None

    # 解析详情信息
    details = row['details'].split('|')
    if len(details) >= 6:
        room_info = details[0].strip()
        area_match = re.search(r'(\d+\.?\d*)', details[1])
        area = float(area_match.group(1)) if area_match else None
        orientation = details[2].strip()
        renovation = details[3].strip()
        building_type = details[5].strip()

        # 解析楼层信息
        floor_info = details[4].strip()
        if '高楼层' in floor_info:
            floor_level = '高'
        elif '中楼层' in floor_info:
            floor_level = '中'
        elif '低楼层' in floor_info:
            floor_level = '低'

        floor_match = re.search(r'(\d+)[层楼]', floor_info)
        if floor_match:
            current_floor = int(floor_match.group(1))

        total_match = re.search(r'共(\d+)层', floor_info)
        if total_match:
            total_floors = int(total_match.group(1))

    # 解析价格信息
    total_price = unit_price = None
    price_match = re.search(r'([\d\.]+)万\s*([\d,]+)元/平', row['price_info'])
    if price_match:
        total_price = float(price_match.group(1))
        unit_price = float(price_match.group(2).replace(',', ''))

    # 提取标题中的关键特征
    features = []
    if '精装' in row['title']: features.append('精装修')
    if '毛坯' in row['title']: features.append('毛坯')
    if '南北通透' in row['title']: features.append('南北通透')
    if '地铁' in row['title']: features.append('近地铁')
    if '车位' in row['title']: features.append('带车位')
    if '满五' in row['title']: features.append('满五年')

    return pd.Series({
        'room_info': room_info,
        'area': area,
        'orientation': orientation,
        'renovation': renovation,
        'building_type': building_type,
        'floor_level': floor_level,
        'current_floor': current_floor,
        'total_floors': total_floors,
        'total_price': total_price,
        'unit_price': unit_price,
        'features': ', '.join(features) if features else None
    })


# 应用解析函数
parsed_data = df.apply(parse_property_data, axis=1)

# 合并原始数据和解析结果
result_df = pd.concat([df[['title']], parsed_data], axis=1)

# 数据清洗
# 1. 删除无法解析的数据
result_df = result_df.dropna(subset=['area', 'total_price'])

# 2. 转换数据类型
result_df['area'] = result_df['area'].astype(float)
result_df['total_price'] = result_df['total_price'].astype(float)
result_df['unit_price'] = result_df['unit_price'].astype(float)

# 3. 计算单价验证
result_df['calculated_unit_price'] = (result_df['total_price'] * 10000) / result_df['area']
result_df['price_diff'] = abs(result_df['unit_price'] - result_df['calculated_unit_price'])

# 显示预处理结果
print(f"原始数据量: {len(df)}")
print(f"处理后数据量: {len(result_df)}")
print("\n数据样例:")
print(result_df.head())