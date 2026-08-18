def find_first_key_value(data,target_key):
    # 处理字典
    if isinstance(data,dict):
        for key,val in data.items():
            if key == target_key:
                return val

            # 递归遍历子元素的值
            rrr = find_first_key_value(val,target_key)

            if rrr is not None:
                return rrr

    # 处理列表
    if isinstance(data,list):
        for i in data:
            rrr2 = find_first_key_value(i,target_key)
            if rrr2 is not None:
                return rrr2


data = {
    'a':{
        'b':{
            'c':100,

        }
    },
    'd': 123,
    'e': {
        'f':[
            {},
            {
                'name':'heng'
            }
        ]
    }
}

print(find_first_key_value(data,'c'))
print(find_first_key_value(data,'d'))
print(find_first_key_value(data,'name'))