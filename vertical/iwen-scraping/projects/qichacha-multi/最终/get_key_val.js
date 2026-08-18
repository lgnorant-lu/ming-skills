
var CryptoJS = require('crypto-js');
var window = global;


function a_d(e, t) {
    return CryptoJS.HmacSHA512(e, t).toString()
}


a_d2 = {
    "n": 20,
    "codes": {
        "0": "W",
        "1": "l",
        "2": "k",
        "3": "B",
        "4": "Q",
        "5": "g",
        "6": "f",
        "7": "i",
        "8": "i",
        "9": "r",
        "10": "v",
        "11": "6",
        "12": "A",
        "13": "K",
        "14": "N",
        "15": "k",
        "16": "4",
        "17": "L",
        "18": "1",
        "19": "8"
    }
}


function o_d2() {
    for (var e = (arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : "/").toLowerCase(), t = e + e, n = "", i = 0; i < t.length; ++i) {
        var o = t[i].charCodeAt() % a_d2.n;
        n += a_d2.codes[o]
    }
    return n
}


function o_d() {
    var e = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : {}
      , t = (arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : "/").toLowerCase()
      , n = JSON.stringify(e).toLowerCase();
    return a_d(t + n, o_d2(t)).toLowerCase().substr(8, 20)
}

function r_d() {
    var e = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : {}
      , t = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : ""
      , n = (arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : "/").toLowerCase()
      , i = JSON.stringify(e).toLowerCase();
    return a_d(n + "pathString" + i + t, o_d2(n))
}

function s_d() {
    var list = ["w", "i", "n", "d", "o", "w", ".", "t", "i", "d"];
    return eval(list.join(""))
}


function get_key_val(data){
    t = '/api/search/searchmulti'
    tid = '1c9ac57b1298fbd24ddccda3586fd9f5'

    var i = o_d(t, data)
    var u = r_d(t, data,tid);
    // var headers[i] = u
    return [i,u]
}

data = {
        'searchKey': '奔驰',
        'pageIndex': 2,
        'pageSize': 20,
    }

console.log(get_key_val(data))