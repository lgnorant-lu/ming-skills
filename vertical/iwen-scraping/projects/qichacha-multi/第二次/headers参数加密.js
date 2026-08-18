window = global

const crypto = require('crypto')

function _HMAC(arg1, arg2) {
    return crypto.createHmac('sha512', arg2).update(arg1).digest('hex');
}


var z = function (e, t) {
    return _HMAC(e, t).toString()
}

_codes = {
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

var r = function () {
    for (var e = (arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : "/").toLowerCase(), t = e + e, n = "", i = 0; i < t.length; ++i) {
        var o = t[i].charCodeAt() % _codes.n;
        n += _codes.codes[o]
    }
    return n
}

var s = function () {
    var e = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : {}
        , t = (arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : "/").toLowerCase()
        , n = JSON.stringify(e).toLowerCase();
    return z(t + n, r(t)).toLowerCase().substr(8, 20)
}

// t = "/api/datalist/mainmember?isnewagg=true&keyno=5dffb644394922f9073544a08f38be9f&nodename=ipoemployees&pageindex=1"


var e = function () {
    var e = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : {}
        , t = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : ""
        , n = (arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : "/").toLowerCase()
        , i = JSON.stringify(e).toLowerCase();
    return z(n + "pathString" + i + t, r(n))
}


function hea(t){

    var i = s(t, undefined)
    var u = e(t, undefined, '1482627dea966dd75018ebfed2b74e13');


    return headers = {
        'key': i,
        'value': u
    }
}


// e.headers[i] = u


// console.log(i)
// console.log(u)
console.log(hea("/api/datalist/mainmember?isnewagg=true&keyno=5dffb644394922f9073544a08f38be9f&nodename=ipoemployees&pageindex=2"))