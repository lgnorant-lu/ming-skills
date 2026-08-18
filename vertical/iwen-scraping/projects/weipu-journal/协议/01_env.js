
content = 'hGxr0liI8XfBTgO5CJfEegOShJXDNQw.1eeT4IFRRdDjK5wDLERGbSLeT1R6XOu.Rwz..6W2GB6YV9saLCEomCIC_RqNwIGaSWd3XOBzmzRevaGjG1L4GctUdoy7SzR1ikMGf.zI4G18aLqq2Kn__vgc9o2lksffZhAapR5HDKisf9rhHr2Gca'

delete __dirname
delete __filename

window = top = self = global
window.setInterval = function (){}
window.setTimeout = function (){}
window.addEventListener = function (){}
window.attachEvent = function (){}

// delete global
// delete Buffer

div = {
    getElementsByTagName(){
        return []
    }
}

script = {
    getAttribute(ele){
        console.log('script_getAttribute',ele)
        if(ele === 'r'){
            return 'm'
        }
    },
    parentElement:{
        removeChild(){}
    },
    innerText:{

    }
}

meta = {
    content:content,
    r:'m',
    id:'FbkwzLN5XOx0',
    getAttribute(ele){
        console.log('meta_getAttribute',ele)
        if (ele === 'r'){
            return 'm'
        }
    },
    parentNode:{
        removeChild(){}
    }


}

document = {
    createElement(ele){
        console.log('document_createElement',ele)
        if (ele === 'div'){
            return div
        }if (ele === 'from'){
            return {}
        }if (ele === 'a'){
            return {}
        }
    },
    appendChild(){},
    removeChild(){},
    getElementsByTagName(ele){
        console.log('document_getElementsByTagName',ele)
        if(ele === 'script'){
            return [script,script]
        }
        if(ele === 'base'){
            return []
        }
    },
    getElementById(id){
        console.log('document_getElementById',id)
        if (id === 'FbkwzLN5XOx0'){
            return meta
        }
    },
    attachEvent:function (){}
}

location = {
    "ancestorOrigins": {},
    "href": "https://qikan.cqvip.com/Qikan/Search/Index?from=index",
    "origin": "https://qikan.cqvip.com",
    "protocol": "https:",
    "host": "qikan.cqvip.com",
    "hostname": "qikan.cqvip.com",
    "port": "",
    "pathname": "/Qikan/Search/Index",
    "search": "?from=index",
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

setproxyarr(['window', 'document','location','div','script','meta'])