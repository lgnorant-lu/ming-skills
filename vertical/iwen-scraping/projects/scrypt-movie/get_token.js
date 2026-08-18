
var CryptoJS = require('crypto-js')



function i() {
    for (var t = Math.round((new Date).getTime() / 1e3).toString(), e = arguments.length, r = new Array(e), i = 0; i < e; i++)
        r[i] = arguments[i];
    r.push(t);
    var o = CryptoJS.SHA1(r.join(",")).toString(CryptoJS.enc.Hex)
      , c = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse([o, t].join(",")));
    return c
}


function get_token(page){
    var a = (page - 1) * 10;
    var e = i("/api/movie", a);
    return e
}


page = 1;

// console.log(get_toke(page))