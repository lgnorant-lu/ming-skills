var CryptoJS = require('crypto-js')

function qF(e) {
    let t = "";
    return typeof e == "object" ? t = Object.keys(e).map(n => `${n}=${e[n]}`).sort().join("&") : typeof e == "string" && (t = e.split("&").sort().join("&")),
    t
}

function get_sign(data,nonce,ti) {
    var r = qF(data);
    // var u = "MsHd97e3q6JrXTFz";
    var o = 'k8tUyS$m';
    // var n = Date.now()
    return CryptoJS.SHA256(nonce + o + decodeURIComponent(r) + ti).toString()
}




var nonce = "MsHd97e3q6JrXTFz";
var ti = Date.now()
var data = 'type=trading-type&openConvert=false&keyword=&siteCode=44&secondType=A&tradingProcess=&thirdType=%5B%5D&projectType=&publishStartTime=&publishEndTime=&pageNo=4&pageSize=10'


console.log(get_sign(data,nonce,ti))