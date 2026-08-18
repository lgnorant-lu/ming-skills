var CryptoJS = require('crypto-js')

function p(e, t, r) {
    var n = ""
      , i = t
      , a = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];
    e && (i = Math.round(Math.random() * (r - t)) + t);
    for (var o = 0; o < i; o++) {
        n += a[Math.round(Math.random() * (a.length - 1))]
    }
    return n
}

function get_sign(key,page){
    var l = (new Date).getTime();
    var b = "$d6eb7ff91ee257475%";
    var c = 10;
    var re = p(!1, 16)
    var g = CryptoJS.SHA256([l, re, b, key, c, page].sort().join("")).toString();
    dic = {
        'sign':g,
        'rs':re,
        'ts':l
    }
    return dic
}

// key = '淘宝'
// page = 1
//
// console.log(get_sign(key,page))