

var CryptoJS = require('crypto-js')




function get_rid(e){
    var o = '7cd084941338484aae1ad9425b84077c';
    var i = '4932caff0ff746eab6f01bf08b70ac45';
    for (var a = (t = o + i,
    r = [],
    [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52].forEach((function(e) {
        t.charAt(e) && r.push(t.charAt(e))
    }
    )),
    r.join("").slice(0, 32)), u = Math.round(Date.now() / 1e3), s = Object.assign({}, e, {
        wts: u
    }), c = Object.keys(s).sort(), l = [], f = /[!'()*]/g, d = 0; d < c.length; d++) {
        var p = c[d]
          , h = s[p];
        h && "string" == typeof h && (h = h.replace(f, "")),
        null != h && l.push("".concat(encodeURIComponent(p), "=").concat(encodeURIComponent(h)))
    }
    var v = l.join("&");
    console.log(v+a)
    return {
        w_rid: CryptoJS.MD5(v + a).toString(),
        wts: u.toString()
    }
}




// console.log(get_rid(parmas))

