delete __dirname
delete __filename

// 代理 检测当前代码有使用哪些环境
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

function obj_toString(obj, name) {
    Object.defineProperty(obj, Symbol.toStringTag, {
        value: name
    })
}

function Window() {

}

Window.prototype.setInterval = function () {

}
Window.prototype.setTimeout = function () {

}
Window.prototype.localStorage = {
    "b1b1": "1",
    "xhs_context_networkQuality": "MODERATE",
    "MF_STATISTICS": "{\"timestamp\":1748522235445,\"visitTimes\":3,\"readFeedCount\":0}",
    "XHS_STRATEGY_BOX": "{\"firstVisit-\":false}",
    "p1": "32",
    "HOME_FEED_CURSOR_SCORE": "27135",
    "last_tiga_update_time": "1748523181870",
    "NEW_XHS_ABTEST_REPORT_KEY": "{\"e77b5ac4c20ea70793021fe587440ffd6787691e000000000403584d99ed6ae611fa43f40aae018b5bd81818\":\"2025-05-29\"}",
    "UNREAD_NOTE_INFO": "{\"cachedFeeds\":[],\"unreadBeginNoteId\":\"68189627000000002300d3d7\",\"unreadEndNoteId\":\"68343735000000000f031bee\",\"unreadNoteCount\":24,\"timestamp\":0}",
    "sdt_source_storage_key": "{\"url\":\"https://fe-static.xhscdn.com/as/v1/f218/v/public/0666f0acdeed38d4cd9084ade1739498.js\",\"reportUrl\":\"/api/sec/v1/shield/webprofile\",\"desVersion\":\"2\",\"signVersion\":\"1\",\"xhsTokenUrl\":\"https://fe-static.xhscdn.com/as/v1/3e44/public/bf7d4e32677698655a5cadc581fd09b3.js\",\"extraInfo\":\"\",\"validate\":false,\"commonPatch\":[\"/fe_api/burdock/v2/note/post\",\"/api/sns/web/v1/comment/post\",\"/api/sns/web/v1/note/like\",\"/api/sns/web/v1/note/collect\",\"/api/sns/web/v1/user/follow\",\"/api/sns/web/v1/feed\",\"/api/sns/web/v1/login/activate\",\"/api/sns/web/v1/note/metrics_report\",\"/api/redcaptcha\",\"/api/store/jpd/main\",\"/phoenix/api/strategy/getAppStrategy\",\"/web_api/sns/v2/note\"],\"signUrl\":\"https://fe-static.xhscdn.com/as/v1/3e44/public/04b29480233f4def5c875875b6bdc3b1.js\"}",
    "guide-ExploreMoreGuide": "{\"neverShowAgainFlag\":false,\"hasShownFlag\":false,\"lastShowTime\":1736927516850}",
    "b1": "I38rHdgsjopgIvesdVwgIC+oIELmBZ5e3VwXLgFTIxS3bqwErFeexd0ekncAzMFYnqthIhJeSfMDKutRI3KsYorWHPtGrbV0P9WfIi/eWc6eYqtyQApPI37ekmR6QL+5Ii6sdneeSfqYHqwl2qt5B0DBIx+PGDi/sVtkIxdsxuwr4qtiIhuaIE3e3LV0I3VTIC7e0utl2ADmsLveDSKsSPw5IEvsiVtJOqw8BuwfPpdeTFWOIx4TIiu6ZPwrPut5IvlaLbgs3qtxIxes1VwHIkumIkIyejgsY/WTge7eSqte/D7sDcpipedeYrDtIC6eDVw2IENsSqtlnlSuNjVtIvoekqt3cZ7sVo4gIESyIhEqQ9quIxhnqz8gIkIfoqwkICqWG73sdlOeVPw3IvAe0fgedflnIi5s3MLU2utAIiKsidvekZNeTPt4nAOeWPwEIvTGz06edPwEpngsDuwBI3YrIxE5Luwwaqw+rekrPI5eDo/eVPwmIhJsSnAekmuvIiAsfI/sxBidIkve3PwlIhQk2VtqOqt1IxesTVtjIk0siqwdIh/sjut3wutnsPw5ICclI3l4wA4jwIAsWVw4IE4qIhOsSqtZBbTt/A0ejjp1IkGPGutwZuwSIvde3utUtMKs1l6sVbEPIEJs6B7sTuwGpuwPICJeWVwiIkgexjRwIv7eSo/efVtSIh3s1VtjPsusIkzZIxJe1W7sjAgsjYAsYPww",
    "guide-ImageNoteGuide": "{\"neverShowAgainFlag\":false,\"hasShownFlag\":false,\"lastShowTime\":1736927516850}",
    "xhs-pc-theme": "system"
}
window = globalThis
Object.setPrototypeOf(window, Window.prototype)


// 原型链检测补法
function HTMLDocument() {

}

function HTMLHtmlElement() {
    this.clientHeight = 149;
    this.clientLeft = 0;
    this.clientTop = 0;
    this.clientWidth = 1734;
    this.contentEditable = "inherit";
    this.currentCSSZoom = 1;
    this.offsetHeight = 2006;
    this.offsetLeft = 0;
    this.offsetParent = null;
    this.offsetTop = 0;
    this.offsetWidth = 1734;
    this.tagName = "HTML";
    this.getAttribute = function (args) {
        console.log("对象 => HTMLHtmlElement, getAttribute:", args)
    }
}
HTMLDocument.prototype.cookie = 'gid=yj44DJdq8D0Wyj44DJdJivkEDJFfWM11y0W66E1qM28quA28MhW2fq8882qjJ4j8D2WJj0Yy; abRequestId=99ed6ae611fa43f40aae018b5bd81818; xsecappid=xhs-pc-web; a1=1971a9612f62kpgw7qdk531ss3ydb0ym3o4ofyq3550000271454; webId=e77b5ac4c20ea70793021fe587440ffd; webBuild=4.67.0; unread={%22ub%22:%2268189627000000002300d3d7%22%2C%22ue%22:%2268343735000000000f031bee%22%2C%22uc%22:24}; loadts=1748522273799; websectiga=3633fe24d49c7dd0eb923edc8205740f10fdb18b25d424d2a2322c6196d2a4ad; sec_poison_id=5538eb9a-7c65-4c69-913a-36dbbee8dd1b'
HTMLDocument.prototype.documentElement = watch(new HTMLHtmlElement(), 'HTMLHtmlElement')

function WebGLRenderingContext() {
    this.drawingBufferColorSpace = "srgb";
    this.drawingBufferFormat = 32856;
    this.drawingBufferHeight = 150;
    this.drawingBufferWidth = 300;
    this.unpackColorSpace = "srgb";
    this.getExtension = function (args) {
        console.log("对象 => WebGLRenderingContext, getExtension:", args)
    }
}

function HTMLCanvasElement() {
    this.tagName = "CANVAS";
    this.textContent = "";
    this.title = "";
    this.translate = true;
    this.virtualKeyboardPolicy = "";
    this.width = 300;
    this.height = 150;
    this.getContext = function (args) {
        console.log("对象 => HTMLDocument, getContext:", args)
        if(args === 'webgl'){
            webgl = watch(new WebGLRenderingContext(), 'WebGLRenderingContext')
            obj_toString(webgl, 'WebGLRenderingContext')
            return webgl
        }
    }
}

// HTMLDocument变成可以修改的对象
Object.defineProperty(HTMLDocument.prototype, 'createElement', {
    enumerable:true,
    configurable:true,
    writable:true,
    value:function createElement(tagName) {
        console.log("对象 => HTMLDocument, createElement创建元素:", tagName)
        if(tagName === 'canvas'){
            aaa = watch(new HTMLCanvasElement(), 'canvas')
            obj_toString(aaa, 'HTMLCanvasElement')
            return aaa
        }
    }
})
document = watch(new HTMLDocument(), 'HTMLDocument')
obj_toString(document, 'HTMLDocument')


function Location() {

}
Location.prototype = {
    "ancestorOrigins": {},
    "href": "https://www.xiaohongshu.com/explore?channel_id=homefeed.fashion_v3",
    "origin": "https://www.xiaohongshu.com",
    "protocol": "https:",
    "host": "www.xiaohongshu.com",
    "hostname": "www.xiaohongshu.com",
    "port": "",
    "pathname": "/explore",
    "search": "?channel_id=homefeed.fashion_v3",
    "hash": ""
}
location = watch(new Location(), 'Location')

function Navigator() {

}
Navigator.prototype = {
    appCodeName: "Mozilla",
    appName: "Netscape",
    appVersion: "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
}
navigator = watch(new Navigator(), 'Navigator')

function Screen() {
    this.availHeight = 1080;
    this.availLeft = 0;
    this.availTop = 0;
    this.availWidth = 1920;
    this.colorDepth = 24;
    this.height = 1080;
    this.isExtended = false;
    this.onchange = null;
    this.pixelDepth = 24;
    this.width = 1920;
}
screen = watch(new Screen(), 'Screen')


require('./x-s_code_js')

p = '/api/sns/web/v1/homefeed'
u = {
    "cursor_score": "",
    "num": 31,
    "refresh_type": 1,
    "note_index": 22,
    "unread_begin_note_id": "",
    "unread_end_note_id": "",
    "unread_note_count": 0,
    "category": "homefeed.fashion_v3",
    "search_key": "",
    "need_num": 6,
    "image_formats": [
        "jpg",
        "webp",
        "avif"
    ],
    "need_filter_image": false
}
X_s = window._webmsxyw(p, u)
console.log(X_s)