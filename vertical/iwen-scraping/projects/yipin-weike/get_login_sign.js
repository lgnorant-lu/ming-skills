
var CryptoJS = require('crypto-js')



var KP = {
    key: CryptoJS.enc.Utf8.parse('fX@VyCQVvpdj8RCa'),
    // 秘钥
    iv: CryptoJS.enc.Utf8.parse('00000000000000000000000000000000')
};

function encrypt(data) {
    var encrypted = CryptoJS.AES.encrypt(data, KP.key, {
        iv: KP.iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });
    return encrypted.toString();
};

function aes(data) {
        return encrypt(data);
    }

function md5(sign){
    return CryptoJS.MD5(sign).toString()
}

function o(obj) {
        return typeof obj;
    }


function sortParams(params) {
    var sign = '';
    Object.keys(params).sort().forEach(function(key) {
        sign += key + (Object(o)(params[key]) === 'object' ? JSON.stringify(params[key], function(k, v) {
            if (typeof v === 'number') {
                v = String(v);
            }

            return v;
        }).replace(/\//g, '\\/') : params[key]);
    });
    return sign;
}


function uuid() {
    var len = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 5;
    return Math.random().toString(36).substring(3, 3 + len);
}


function aesSign(headers) {
    var data = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
    var secretKey = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'a75846eb4ac490420ac63db46d2a03bf';
    var sign = secretKey + sortParams(data) + sortParams(headers) + secretKey;
    sign = md5(sign);
    sign = aes(sign);
    return sign;
}

function sign(username,pas,code){

    var timestemp = parseInt(new Date().getTime() / 1000)
    var Header = {
        'App-Ver': '',
        'Os-Ver': '',
        'Device-Ver': '',
        Imei: '',
        'Access-Token': '',
        Timestemp: timestemp,
        NonceStr: "".concat(timestemp).concat(uuid()),
        'App-Id': '4ac490420ac63db4',
        'Device-Os': 'web'

    };

    var signatureParams = {
    "username": username,
    "password": pas,
    "code": code,
    "hdn_refer": "https://www.epwk.com/"
}

    // return Signature = Object(_config_encrypt__WEBPACK_IMPORTED_MODULE_10__["a"])(Header, signatureParams, _utils_env__WEBPACK_IMPORTED_MODULE_13__["j"] ? _utils_env__WEBPACK_IMPORTED_MODULE_13__["g"] : _utils_env__WEBPACK_IMPORTED_MODULE_13__["c"])
    return {
        he : {
            'Signature': aesSign(Header, signatureParams, 'a75846eb4ac490420ac63db46d2a03bf'),
            'NonceStr' : Header.NonceStr
        }
    }
}

console.log(sign())

// 'X2iQHKPnYg2X8sddAo3cVElmnqMBpGlvRRosg2A5gyOOKja45dWUG3Jhz8XB4HnA'
// '5JjijmGMwwnY9JIFI48uD8KIq7d5j11osWyJ11z9+1J2IZ43xmjdwg7UlbbNUMt9'