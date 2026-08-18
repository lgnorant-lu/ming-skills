var CryptoJS = require('crypto-js')


function get_s(data){
    var d = 'auto';
    var h = 'zh-CHS';
    var k = 109984457;
    return CryptoJS.MD5("".concat(d).concat(h).concat(data).concat(k)).toString()
}

data = 'open'

console.log(get_s(data))