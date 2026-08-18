var CryptoJS = require('crypto-js')

function md5(n) {
    return CryptoJS.MD5(n).toString()
}


function s(serialId,tm) {
    // var tm = new Date().getTime()
    // console.log(tm)
    var data = {
    "cityId": "2205",
    "serialId": serialId
}
    var i = JSON.stringify(data)
    var o = '19DDD1FBDFF065D3A4DA777D2D7A81EC';
    var n = "cid=" + '508' + "&param=" + i + o + tm

    var s = md5(n);
    return s
}

function sign(serialId,tm) {
    return s(serialId,tm)
}


// console.log(sign(e, t))