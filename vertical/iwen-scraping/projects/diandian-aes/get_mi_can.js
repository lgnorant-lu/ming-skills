const crypto = require('crypto');

function h(e, n, o) {
    var d = "";
    // 将密钥和IV从utf8转换为Buffer
    n = Buffer.from(n, "utf8");
    o = Buffer.from(o, "utf8");
    // 创建解密器
    var c = crypto.createDecipheriv("aes-128-cbc", n, o);
    // 更新解密数据
    d += c.update(e, "hex", "utf8");
    // 完成解密
    d += c.final("utf8");
    return d;
}

function get_k(e) {

    var path = '/v1/rank'
    var n = {
        "s": "614e8a2289435d2a9816fd01906d71ee",
        "k": "d7cc9f52b5f756cb",
        "l": "e63e8423c9bb387e",
        "d": -1,
        "sort": "dd",
        "num": 10
    }
    var r = 'get'

    var s = n.s
      , d = n.k
      , m = n.l
      , f = n.d
      , v = n.sort
      , l = n.num
      , k = function(content, t, e) {
        for (var a = Array.from(content), n = Array.from(t), r = a.length, o = n.length, d = String.fromCodePoint, i = 0; i < r; i++)
            a[i] = d(a[i].codePointAt(0) ^ n[(i + e) % o].codePointAt(0));
        return a.join("")
    }(function(s, t, path, e) {
        return [s, t, e, path].join("(&&)")
    }(function(t, e) {
        var n = t;
        var r = [];
        for (var d in n)
            Array.isArray(n[d]) && "get" === e && (n[d] = n[d].join("")),
            "post" === e && (Array.isArray(n[d]) || o()(n[d])) && (n[d] = JSON.stringify(n[d])),
            r.push(n[d]);
        return r.sort(),
        r.join("")
    }(e, r), parseInt((new Date).getTime() / 1e3) - 655876800 - f, path, v), h(s, d, m), l);
    return Buffer.from(k).toString("base64")
}


// e = {
//     'market_id': '1',
//     'genre_id': '0',
//     'country_id': '75',
//     'device_id': '1',
//     'page': '2',
//     'time': '1764243067',
//     'rank_type': '4',
//     'brand_id': '2',
// }
//
// console.log(get_k(e))