var CryptoJS = require('crypto-js')

function s(n){
    return CryptoJS.MD5(n).toString()
}


function l(t, e) {
            return t.toString().toUpperCase() > e.toString().toUpperCase() ? 1 : t.toString().toUpperCase() == e.toString().toUpperCase() ? 0 : -1
        }

function u(t) {
    for (var e = Object.keys(t).sort(l), n = "", a = 0; a < e.length; a++)
        if (void 0 !== t[e[a]])
            if (t[e[a]] && t[e[a]]instanceof Object || t[e[a]]instanceof Array) {
                var i = JSON.stringify(t[e[a]]);
                n += e[a] + i
            } else
                n += e[a] + t[e[a]];
    return n
}

function d(t) {
    for (var e in t)
        "" !== t[e] && void 0 !== t[e] || delete t[e];
    var n = 'B3978D054A72A7002063637CCDF6B2E5' + u(t);
    return s(n).toLocaleLowerCase()
}


function get_sign(ts,page) {
    var t = {
    "ts": ts,
    "pageNo": page,
    "pageSize": 20,
    "total": 3227,
    "AREACODE": "",
    "M_PROJECT_TYPE": "",
    "KIND": "GCJS",
    "GGTYPE": "1",
    "PROTYPE": "",
    "timeType": "6",
    "BeginTime": "2025-03-19 00:00:00",
    "EndTime": "2025-09-19 23:59:59",
    "createTime": ""
}
    return d(t)
}

// ts = 1758275264326
// page = 1
//
//
// console.log(get_sign())