const CryptoJS = require('crypto-js')

// 获取时间戳
const time_da = Date.now()
// console.log(time_da)
const time_da_str = time_da.toString()
ti = time_da_str.slice(0,10)
// console.log(ti)



// 参数构建地址
const params = {
    'api_key': '51job',
    'timestamp': ti,
    'keyword': '爬虫',
    'searchType': '2',
    'function': '',
    'industry': '',
    'jobArea': '000000',
    'jobArea2': '',
    'landmark': '',
    'metro': '',
    'salary': '',
    'workYear': '',
    'degree': '',
    'companyType': '',
    'companySize': '',
    'jobType': '',
    'issueDate': '',
    'sortType': '0',
    'pageNum': '4',
    'requestId': '',
    'pageSize': '20',
    'source': '1',
    'accountId': '',
    'pageCode': 'sou|sou|soulb',
    'scene': '7',
};



// 方法1: 使用URLSearchParams (自动编码且保留原始顺序)
const urlParams = new URLSearchParams();
for (const [key, value] of Object.entries(params)) {
    urlParams.append(key, value);
}
diz = urlParams.toString();
dizhi = '/api/job/search-pc?'+diz
// console.log(dizhi)


// 算出签名值
function fn(di) {
    miyao = 'abfc8f9dcf8c3f3d8aa294ac5f2cf2cc7767e5592590f39c3f503271dd68562b'
    dizhi = di
    const hmac = CryptoJS.HmacSHA256(dizhi, miyao)
    const sign = hmac.toString(CryptoJS.enc.Hex)

    // console.log(sign)

    return{
        headers:{
            sign
        }
    }
}

fn(dizhi)

// console.log(hmacHex)
