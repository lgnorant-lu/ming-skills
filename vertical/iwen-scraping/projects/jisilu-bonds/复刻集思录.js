var u = require('crypto-js')

function jm(text, aes_key) {
    var key = CryptoJS.enc.Utf8.parse(aes_key);
    var iv = CryptoJS.enc.Utf8.parse("");
    var srcs = CryptoJS.enc.Utf8.parse(text);
    var encrypted = CryptoJS.AES.encrypt(srcs, key, {
        iv: iv,
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
    });
    return encrypted.ciphertext.toString(CryptoJS.enc.Hex)
}

