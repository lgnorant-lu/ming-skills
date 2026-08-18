var CryptoJS = require('crypto-js')

function qF(e) {
    let t = "";
    return typeof e == "object" ? t = Object.keys(e).map(n => `${n}=${e[n]}`).sort().join("&") : typeof e == "string" && (t = e.split("&").sort().join("&")),
    t
}

function get_sign(t,u,n) {
    // var t = "type=trading-type&openConvert=false&keyword=&siteCode=44&secondType=A&tradingProcess=&thirdType=%5B%5D&projectType=&publishStartTime=&publishEndTime=&pageNo=5&pageSize=10"
    var r = qF(t);
    // var u = "6zRgcbWXFjLwotUO"
    var o = 'k8tUyS$m'
    // var n = 1762011494638
    return CryptoJS.SHA256(u + o + decodeURIComponent(r) + n).toString()
}


data = {
    "type": "trading-type",
    "openConvert": false,
    "keyword": "",
    "siteCode": "44",
    "secondType": "A",
    "tradingProcess": "",
    "thirdType": "[]",
    "projectType": "",
    "publishStartTime": "",
    "publishEndTime": "",
    "pageNo": 5,
    "pageSize": 10
}
//`
// const p = D1({
//     p: JSON.stringify(data, {allowDots: true}),
//     t: Date.now(),    // 时间戳,
//     n: 'wUlKUBhOLMJRuLHN',  // 随机值
//     k: 'k8tUyS$m'
// });

// console.log(get_sign())