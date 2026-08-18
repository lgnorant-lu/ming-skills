
content = 'meta_content'

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

'ts_';
'auto_';

function get_cookie(){
    return document.cookie
}

// get_cookie()