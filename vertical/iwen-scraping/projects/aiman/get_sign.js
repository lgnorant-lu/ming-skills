CryptoJS = require('crypto-js')

function md5(o){
    return CryptoJS.MD5(o).toString()
}

function getSign(e) {
    var t = [
    "channel",
]
    t.push(e)
    t.push('iIndex')
    var s = t.join("_")
    var sign = md5(s);
    return sign
}

// e = "varietylist"

// console.log(getSign(e))