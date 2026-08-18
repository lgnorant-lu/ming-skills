function C (e, t)
{
    // requests.get(url,参数,xxxx)
    // axios.post(url,参数,xxxx)
    return n.H("https://dict.youdao.com/webtranslate",  o.A(o.A({}, e),), {    // o.A 合并对象
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        }
    })
}


// var fn = (a,b) => a + b;  // 后面只有一段代码时候 后面省略了return
// // var fn = (a,b) return => a + b;  // 省略了return
//
// var ret = fn(1,2);
// console.log(ret)


// a = 111;
// b = 222;
// // 模板字符串
// kk = `你好，我是${a},今天${b}`
// console.log(kk)

var crypto = require('crypto')

function S(e, t) {
    return _(`client=fanyideskweb&mysticTime=${e}&product=webfanyi&key=${t}`)
}

function _(e) {
    return crypto.createHash("md5").update(e.toString()).digest("hex")
}

function k(word) {
    const e = 'Vy4EQ1uwPkUoqvcP1nIu6WiAjxFeA3Y9'
    const a = (new Date).getTime();
    return {
        "sign": S(a, e),
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
        "i": word,
        "from": "en",
        "to": "zh-CHS",
        "useTerm": false,
        "domain": "0",
        "dictResult": true,
        "keyid": "webfanyi"
    }
}

function u(e, t, a) {
    return new Promise(( (o, i) => {
        n.A.post(e, t, a).then((e => {
            o(e.data)
        }
        )).catch((e => {
            i(e)
        }
        ))
    }
    ))
}

function send(){
    return new Promise( (resolve, reject) => {    // function 改箭头函数
        // 函数
        // resolve (返回值) ——> 成功
        // reject (返回) ——> 失败
    })
}