var CryptoJS = require('crypto-js')



function formatDate(v, format) {
    if (!v)
        return "";
    var d = v;
    if (typeof v === 'string') {
        if (v.indexOf("/Date(") > -1)
            d = new Date(parseInt(v.replace("/Date(", "").replace(")/", ""), 10));
        else
            d = new Date(Date.parse(v.replace(/-/g, "/").replace("T", " ").split(".")[0]));
        // 用来处理出现毫秒的情况，截取掉.xxx，否则会出错
    } else if (typeof v === "number") {
        d = new Date(v);
    }
    var o = {
        "M+": d.getMonth() + 1,
        // month
        "d+": d.getDate(),
        // day
        "h+": d.getHours(),
        // hour
        "m+": d.getMinutes(),
        // minute
        "s+": d.getSeconds(),
        // second
        "q+": Math.floor((d.getMonth() + 3) / 3),
        // quarter
        "S": d.getMilliseconds()// millisecond
    };
    format = format || "yyyy-MM-dd";
    if (/(y+)/.test(format)) {
        format = format.replace(RegExp.$1, (d.getFullYear() + "").substr(4 - RegExp.$1.length));
    }
    for (var k in o) {
        if (new RegExp("(" + k + ")").test(format)) {
            format = format.replace(RegExp.$1, RegExp.$1.length == 1 ? o[k] : ("00" + o[k]).substr(("" + o[k]).length));
        }
    }
    return format;
}

var DES3 = {
    iv: function() {
        return formatDate(new Date(), "yyyyMMdd")
    },
    encrypt: function(b, c, a) {
        if (c) {
            return (CryptoJS.TripleDES.encrypt(b, CryptoJS.enc.Utf8.parse(c), {
                iv: CryptoJS.enc.Utf8.parse(a || DES3.iv()),
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            })).toString()
        }
        return ""
    },
    decrypt: function(b, c, a) {
        if (c) {
            return CryptoJS.enc.Utf8.stringify(CryptoJS.TripleDES.decrypt(b, CryptoJS.enc.Utf8.parse(c), {
                iv: CryptoJS.enc.Utf8.parse(a || DES3.iv()),
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            })).toString()
        }
        return ""
    }
};

function get_ming(key,mi){
    var ming = DES3.decrypt(mi, key);
    return ming
}

mi = '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'
key = 'gH4jB5P2HQtwMsTfimmVRhmj'


console.log(get_ming(key,mi))