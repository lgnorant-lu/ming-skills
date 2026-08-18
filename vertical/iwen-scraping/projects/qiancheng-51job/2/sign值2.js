let CryptoJS = require('crypto-js')



// // 获取时间戳
// const time_da = Date.now()
// // console.log(time_da)
// const str_time_de = time_da.toString()
// let ti = str_time_de.slice(0,10)
// // console.log(ti)


// 构建参数
// params = {
//     "api_key": "51job",
//     "timestamp": ti,
//     "keyword": "道路",
//     "searchType": "2",
//     "function": "industry",
//     "jobArea": "000000",
//     "jobArea2": "landmark",
//     "metro": "salary",
//     "workYear": "degree",
//     "companyType": "companySize",
//     "jobType": "issueDate",
//     "sortType": "0",
//     "pageNum": "2",
//     "requestId": "b201e3a2f2baea3c746beef7ecab2407",
//     "pageSize": "20",
//     "source": "1",
//     "accountId": "266821509",
//     "pageCode": "sou|sou|soulb",
//     "scene": "7"
// }

// var parmse = JSON.stringify(parms)
// console.log(parmse)


// 生成sign值
// const urlParams = new URLSearchParams();
// for (const [key, value] of Object.entries(params)) {
//     urlParams.append(key, value);
// }
// diz = urlParams.toString();
// // console.log(diz)
// dizhi = '/api/job/search-pc?' + diz
// console.log(dizhi)
// dizhi = '/api/job/search-pc?api_key=51job&timestamp=1757782808&keyword=%E9%81%93%E8%B7%AF&searchType=2&function=&industry=&jobArea=000000&jobArea2=&landmark=&metro=&salary=&workYear=&degree=&companyType=&companySize=&jobType=&issueDate=&sortType=0&pageNum=4&requestId=b201e3a2f2baea3c746beef7ecab2407&pageSize=20&source=1&accountId=266821509&pageCode=sou%7Csou%7Csoulb&scene=7'.replace(1757782808,ti)
// console.log(dizhi)

function fn1(dii){
    miyao = 'abfc8f9dcf8c3f3d8aa294ac5f2cf2cc7767e5592590f39c3f503271dd68562b'
    dizh = dii
    let hmac = CryptoJS.HmacSHA256(dizh,miyao)
    let sign = hmac.toString()

    return {
        headers:{
            sign
        }
    }
    // console.log(sign)
}

// fn1('/api/job/search-pc?api_key=51job&timestamp=1757781652&keyword=%E9%81%93%E8%B7%AF&searchType=2&function=&industry=&jobArea=000000&jobArea2=&landmark=&metro=&salary=&workYear=&degree=&companyType=&companySize=&jobType=&issueDate=&sortType=0&pageNum=5&requestId=b201e3a2f2baea3c746beef7ecab2407&pageSize=20&source=1&accountId=266821509&pageCode=sou%7Csou%7Csoulb&scene=7')
// fn1(dizhi)



