var crypto = require('crypto')

function S(e, t) {
    return _(`client=fanyideskweb&mysticTime=${e}&product=webfanyi&key=${t}`)
}


function _(e) {
    return crypto.createHash("md5").update(e.toString()).digest("hex")
}


function fn(danci) {
    const e = 'Vy4EQ1uwPkUoqvcP1nIu6WiAjxFeA3Y3'
    const a = (new Date).getTime();
    return {
        "sign": S(e, a),
        "client": "fanyideskweb",
        "product": "webfanyi",
        "appVersion": "1.0.0",
        "vendor": "web",
        "pointParam": "client,mysticTime,product",
        "mysticTime": a,
        "keyfrom": "fanyi.web",
        "mid": 1,
        "screen": 1,
        "model": 1,
        "network": "wifi",
        "abtest": 0,
        "yduuid": "abcdefg",
        "i": danci,
        "from": "en",
        "to": "zh-CHS",
        "useTerm": false,
        "domain": "0",
        "dictResult": true,
        "keyid": "webfanyi"
    }
}

function T(e) {
    return crypto.createHash("md5").update(e).digest()
}


function O(e) {
    let t = 'ydsecret://query/key/B*RGygVywfNBwpmBaZg*WT7SIOUP2T0C9WHMZN39j^DAdaZhAnxvGcCY6VYFwnHl';
    let a = 'ydsecret://query/iv/C@lZe2YzHtZ2CYgaXKSVfsb7Y4QWHjITPPZ0nQp87fBeJ!Iv6v^6fvi2WN@bYpJ4'
    if (!e)
        return null;
    const o = Buffer.alloc(16, T(t))
        , n = Buffer.alloc(16, T(a))
        , r = crypto.createDecipheriv("aes-128-cbc", o, n);
    let s = r.update(e, "base64", "utf-8");
    return s += r.final("utf-8"),
        s
}


// console.log(O('_jsUyA02rwkOJ4enKX7c4Sdm4hPbMmosJtqyVVdpmzKXt_0lQyUgvRMxWeLKy_h5gfiBjzMU-xnirN04jmuELi5BzIun02CKPbUS9EHGzt9qYGE3jHmsDWjatxIUUh-jZgjBcgLt6uayQ7GLid1tZFD0Dhk85Hd67mYmv-ZxYTcZbJwcWykjinQ86K-_1yHo'))