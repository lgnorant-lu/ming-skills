
var CryptoJS = require('crypto-js')


function get_token(data){
    const parmas = new URLSearchParams(data).toString()
    var token = CryptoJS.SHA1(parmas).toString()
    return token
}

// data = {
//     "data_type": "1",
//     "page": "2",
//     "platform": "web"
// }
//
//
// console.log(get_token(data))