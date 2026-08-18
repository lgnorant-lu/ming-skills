
meta_content = '2yG83SmHM884D4_IDFMca3IVmCaKQkehwXm0Q8keqbPyokTu3b2LarGbRce1q55TyFlBWQo.ECbta5jtEZQ5a5592oopfsz8vYGuGmXWAkZSPTNfydqx_rCEIRArI4HbN8.UXEyB3uajQhkaSdMSKrY.usfqlXSrhpBwmjFwpLS0DBoPQKUFjkqM_R9uVPBVDyxoVKkZkx9inz7FirEGnKFTnxHA.d9hHUPgNt2NI0W'


window = self = top = global

window.addEventListener = function (){}
window.setInterval = function (){}
window.setTimeout = function (){}
window.ActiveXObject = undefined

_head = {
    removeChild : function (){}
}
meta = {
    content: meta_content,
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
    content: meta_content
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

function setproxyarr(proxyObjArr) {
    for (let i = 0; i < proxyObjArr.length; i++) {
        const handler = `{
            get: function(target,property,receiver){
                console.log("方法:","get",",对象","${proxyObjArr[i]}",",属性",property,",属性类型:",typeof property, ",属性值",target[property],",属性值类型:",typeof target[property]);
                return target[property];
            },
            set: function(target,property,value,receiver){
                console.log("方法:","set",",对象","${proxyObjArr[i]}",",属性",property,",属性类型:",typeof property, ",属性值:",value,",属性值类型:",typeof target[property]);
                return Reflect.set(...arguments);
            }
        }`;
        eval(`try {
            ${proxyObjArr[i]};
            ${proxyObjArr[i]} = new Proxy(${proxyObjArr[i]}, ${handler});
        } catch (e) {
            ${proxyObjArr[i]} = {};
            ${proxyObjArr[i]} = new Proxy(${proxyObjArr[i]}, ${handler});
        }`);
    }
}
// setproxyarr(['window','document','div','script','meta','navigator'])