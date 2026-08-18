delete __dirname
delete __filename


// 原型代理
function watch(obj, name) {
    return new Proxy(obj, {
        get: function (target, property, receiver) {
            try {
                if (typeof target[property] === "function") {
                    console.log("对象 => " + name + ",读取属性:" + property + ",值为:" + 'function' + ",类型为:" + (typeof target[property]))
                } else {
                    console.log("对象 => " + name + ",读取属性:" + property + ",值为:" + target[property] + ",类型为:" + (typeof target[property]))
                }
            } catch (e) {
            }
            return target[property]
        },
        set: (target, property, newValue, receiver) => {
            try {
                console.log("对象 => " + name + ",设置属性:" + property + ",值为:" + newValue + ",类型为:" + (typeof newValue))
            } catch (e) {
            }
            return Reflect.set(target, property, newValue, receiver)
        }
    })
}

// window = globalThis

function obj_tostring(obj,name){
    Object.defineProperty(obj,Symbol.toStringTag,{
        value: name
    })
}

function Window(){

}

window = watch(globalThis,'window')

// 原型链检测补法
function HTMLDocument(){
}

Object.defineProperty(HTMLDocument.prototype,'createElement',{
    enumerable:true,
    configurable:true,
    value:function createElement(tagName){
        // return document.createElement(tagName)
        console.log("对象 => HTMLDocument,createElement创建元素:",tagName)
    }
})

document = watch(new HTMLDocument(),'HTMLDocument')
obj_tostring(document,'HTMLDocument')


require('./x-s_code_js')

p = '/api/sns/web/v1/homefeed'
u = {
    "cursor_score": "",
    "num": 18,
    "refresh_type": 1,
    "note_index": 9,
    "unread_begin_note_id": "",
    "unread_end_note_id": "",
    "unread_note_count": 0,
    "category": "homefeed.fashion_v3",
    "search_key": "",
    "need_num": 8,
    "image_formats": [
        "jpg",
        "webp",
        "avif"
    ],
    "need_filter_image": false
}
X_s = window._webmsxyw(p,u)

