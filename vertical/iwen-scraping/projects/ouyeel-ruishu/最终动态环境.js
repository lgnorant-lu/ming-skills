content = 'meta_content'


window = self = top = global

window.addEventListener = function (){}
window.setInterval = function (){}
window.setTimeout = function (){}
window.ActiveXObject = undefined

_head = {
    removeChild : function (){}
}
meta = {
    content: content,
    getAttribute(attr){
        console.log('meta_getAttribute',attr)
        if (attr === 'r'){
            return 'm'
        }
    },
    parentNode:_head,
}
script = {
    getAttribute(attr){
        console.log('script_getAttribute',attr)
        if (attr === 'r'){
            return 'm'
        }
    },
    parentElement:_head,
    content: content
}
div = {
    getElementsByTagName(){
        return []
    }
}
form = {}
document = {
    appendChild(){},
    removeChild(){},
    createElement(ele){
        console.log('document_createElement',ele)
        if (ele === 'div'){
            return div
        }if (ele === 'form'){
            return form
        }else {
            return {}
        }
    },
    getElementsByTagName(ele){
        console.log('document_getElementsByTagName',ele)
        if (ele === 'script'){
            return [script,script]
        }
        if (ele === 'meta'){
            return [meta,meta]
        }
        if (ele === 'base'){
            return []
        }else {
            return []
        }
    },
    getElementById(){}
}
navigator = {
    userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
}


location = {
    "ancestorOrigins": {},
    "href": "https://www.ouyeel.com/search-ng/exchange/search/?categorySummary=C8",
    "origin": "https://www.ouyeel.com",
    "protocol": "https:",
    "host": "www.ouyeel.com",
    "hostname": "www.ouyeel.com",
    "port": "",
    "pathname": "/search-ng/exchange/search/",
    "search": "?categorySummary=C8",
    "hash": ""
}


'ts_js'

'auto_js'


function get_cookie2(){
    return document.cookie
}

// console.log(get_cookie2())