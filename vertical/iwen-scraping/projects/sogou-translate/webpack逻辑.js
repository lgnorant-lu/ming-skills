window = global

var heng;

!function(t) {
    function e(e) {
        for (var r, o, c = e[0], u = e[1], s = e[2], l = 0, f = []; l < c.length; l++)
            o = c[l],
            Object.prototype.hasOwnProperty.call(a, o) && a[o] && f.push(a[o][0]),
            a[o] = 0;
        for (r in u)
            Object.prototype.hasOwnProperty.call(u, r) && (t[r] = u[r]);
        for (p && p(e); f.length; )
            f.shift()();
        return i.push.apply(i, s || []),
        n()
    }
    function n() {
        for (var t, e = 0; e < i.length; e++) {
            for (var n = i[e], r = !0, o = 1; o < n.length; o++) {
                var u = n[o];
                0 !== a[u] && (r = !1)
            }
            r && (i.splice(e--, 1),
            t = c(c.s = n[0]))
        }
        return t
    }
    var r = {}
      , o = {
        "6": 0
    }
      , a = {
        "6": 0
    }
      , i = [];
    function c(e) {
        console.log(e)
        if (r[e])
            return r[e].exports;
        var n = r[e] = {
            "i": e,
            "l": !1,
            "exports": {}
        };
        return t[e].call(n.exports, n, n.exports, c),
        n.l = !0,
        n.exports
    }
    heng = c
    c.e = function(t) {
        var e = [];
        o[t] ? e.push(o[t]) : 0 !== o[t] && {
            "5": 1,
            "7": 1,
            "8": 1,
            "9": 1,
            "10": 1,
            "11": 1,
            "12": 1,
            "13": 1,
            "14": 1,
            "16": 1,
            "17": 1,
            "18": 1,
            "19": 1,
            "20": 1,
            "21": 1,
            "22": 1,
            "23": 1,
            "24": 1,
            "25": 1,
            "26": 1,
            "27": 1,
            "29": 1,
            "30": 1
        }[t] && e.push(o[t] = new Promise((function(e, n) {
            for (var r = "wap/static/css/" + t + "." + {
                "0": "31d6cfe0",
                "1": "31d6cfe0",
                "2": "31d6cfe0",
                "3": "31d6cfe0",
                "4": "31d6cfe0",
                "5": "88ab9336",
                "7": "5ee11638",
                "8": "210a8eca",
                "9": "fbf3ab07",
                "10": "fbf3ab07",
                "11": "76cc3683",
                "12": "f27f98cf",
                "13": "62386597",
                "14": "b32c9ffa",
                "15": "31d6cfe0",
                "16": "fbf3ab07",
                "17": "970a12a5",
                "18": "88ab9336",
                "19": "fbf3ab07",
                "20": "fbf3ab07",
                "21": "fbf3ab07",
                "22": "fbf3ab07",
                "23": "39942a3e",
                "24": "bb7b95ea",
                "25": "4d654b0c",
                "26": "d2c25935",
                "27": "9678c52a",
                "29": "a3d3d6bb",
                "30": "4882c5dc"
            }[t] + ".css", a = c.p + r, i = document.getElementsByTagName("link"), u = 0; u < i.length; u++) {
                var s = (p = i[u]).getAttribute("data-href") || p.getAttribute("href");
                if ("stylesheet" === p.rel && (s === r || s === a))
                    return e()
            }
            var l = document.getElementsByTagName("style");
            for (u = 0; u < l.length; u++) {
                var p;
                if ((s = (p = l[u]).getAttribute("data-href")) === r || s === a)
                    return e()
            }
            var f = document.createElement("link");
            f.rel = "stylesheet",
            f.type = "text/css",
            f.onload = e,
            f.onerror = function(e) {
                var r = e && e.target && e.target.src || a
                  , i = new Error("Loading CSS chunk " + t + " failed.\n(" + r + ")");
                i.request = r,
                delete o[t],
                f.parentNode.removeChild(f),
                n(i)
            }
            ,
            f.href = a,
            0 !== f.href.indexOf(window.location.origin + "/") && (f.crossOrigin = "anonymous"),
            document.getElementsByTagName("head")[0].appendChild(f)
        }
        )).then((function() {
            o[t] = 0
        }
        )));
        var n = a[t];
        if (0 !== n)
            if (n)
                e.push(n[2]);
            else {
                var r = new Promise((function(e, r) {
                    n = a[t] = [e, r]
                }
                ));
                e.push(n[2] = r);
                var i, u = document.createElement("script");
                u.charset = "utf-8",
                u.timeout = 120,
                c.nc && u.setAttribute("nonce", c.nc),
                u.src = function(t) {
                    return c.p + "wap/static/js/" + ({
                        "5": "agreement",
                        "7": "appexplain",
                        "8": "authority",
                        "9": "authorityAndroid",
                        "10": "authorityIos",
                        "11": "bookpage",
                        "12": "detailapp",
                        "13": "detailpc",
                        "14": "feed",
                        "15": "home",
                        "16": "inforcollectlist",
                        "17": "language",
                        "18": "policy",
                        "19": "policysdk",
                        "20": "policyshare",
                        "21": "privacynew",
                        "22": "privacynewsimple",
                        "23": "promotion",
                        "24": "qbexplain",
                        "25": "qbyouthexplain",
                        "26": "quick",
                        "27": "text",
                        "29": "wapsite",
                        "30": "writing"
                    }[t] || t) + "." + {
                        "0": "a13439bd",
                        "1": "aa872cd4",
                        "2": "79950059",
                        "3": "b43d3e9e",
                        "4": "5a4081aa",
                        "5": "f7c15f65",
                        "7": "3ae165d6",
                        "8": "daa3201c",
                        "9": "9292efb3",
                        "10": "7756e9e9",
                        "11": "6aafce6e",
                        "12": "fd5d6ef0",
                        "13": "56961640",
                        "14": "948d0899",
                        "15": "0c8668a3",
                        "16": "47ac94c9",
                        "17": "b00bd3bc",
                        "18": "22a29b0c",
                        "19": "a7dc960f",
                        "20": "849cd26b",
                        "21": "b3c0c6b2",
                        "22": "b75820fe",
                        "23": "5dd37228",
                        "24": "790ef3a2",
                        "25": "3488898c",
                        "26": "fc208cff",
                        "27": "53232fe5",
                        "29": "247147a2",
                        "30": "290305e5"
                    }[t] + ".js"
                }(t),
                0 !== u.src.indexOf(window.location.origin + "/") && (u.crossOrigin = "anonymous");
                var s = new Error;
                i = function(e) {
                    u.onerror = u.onload = null,
                    clearTimeout(l);
                    var n = a[t];
                    if (0 !== n) {
                        if (n) {
                            var r = e && ("load" === e.type ? "missing" : e.type)
                              , o = e && e.target && e.target.src;
                            s.message = "Loading chunk " + t + " failed.\n(" + r + ": " + o + ")",
                            s.name = "ChunkLoadError",
                            s.type = r,
                            s.request = o,
                            n[1](s)
                        }
                        a[t] = void 0
                    }
                }
                ;
                var l = setTimeout((function() {
                    i({
                        "type": "timeout",
                        "target": u
                    })
                }
                ), 12e4);
                u.onerror = u.onload = i,
                document.head.appendChild(u)
            }
        return Promise.all(e)
    }
    ,
    c.m = t,
    c.c = r,
    c.d = function(t, e, n) {
        c.o(t, e) || Object.defineProperty(t, e, {
            "enumerable": !0,
            "get": n
        })
    }
    ,
    c.r = function(t) {
        "undefined" != typeof Symbol && Symbol.toStringTag && Object.defineProperty(t, Symbol.toStringTag, {
            "value": "Module"
        }),
        Object.defineProperty(t, "__esModule", {
            "value": !0
        })
    }
    ,
    c.t = function(t, e) {
        if (1 & e && (t = c(t)),
        8 & e)
            return t;
        if (4 & e && "object" == typeof t && t && t.__esModule)
            return t;
        var n = Object.create(null);
        if (c.r(n),
        Object.defineProperty(n, "default", {
            "enumerable": !0,
            "value": t
        }),
        2 & e && "string" != typeof t)
            for (var r in t)
                c.d(n, r, function(e) {
                    return t[e]
                }
                .bind(null, r));
        return n
    }
    ,
    c.n = function(t) {
        var e = t && t.__esModule ? function() {
            return t.default
        }
        : function() {
            return t
        }
        ;
        return c.d(e, "a", e),
        e
    }
    ,
    c.o = function(t, e) {
        return Object.prototype.hasOwnProperty.call(t, e)
    }
    ,
    c.p = "//search.sogoucdn.com/translate/",
    c.oe = function(t) {
        throw t
    }
    ;
    var u = window.webpackJsonp = window.webpackJsonp || []
      , s = u.push.bind(u);
    u.push = e,
    u = u.slice();
    for (var l = 0; l < u.length; l++)
        e(u[l]);
    var p = s;
    i.push([349, 28]),
    n()
}({
    "1": function(t, e, n) {
        "use strict";
        n.d(e, "p", (function() {
            return r
        }
        )),
        n.d(e, "x", (function() {
            return o
        }
        )),
        n.d(e, "y", (function() {
            return a
        }
        )),
        n.d(e, "f", (function() {
            return i
        }
        )),
        n.d(e, "D", (function() {
            return c
        }
        )),
        n.d(e, "C", (function() {
            return u
        }
        )),
        n.d(e, "u", (function() {
            return s
        }
        )),
        n.d(e, "d", (function() {
            return l
        }
        )),
        n.d(e, "z", (function() {
            return p
        }
        )),
        n.d(e, "k", (function() {
            return f
        }
        )),
        n.d(e, "A", (function() {
            return d
        }
        )),
        n.d(e, "h", (function() {
            return h
        }
        )),
        n.d(e, "B", (function() {
            return g
        }
        )),
        n.d(e, "q", (function() {
            return m
        }
        )),
        n.d(e, "n", (function() {
            return y
        }
        )),
        n.d(e, "e", (function() {
            return v
        }
        )),
        n.d(e, "j", (function() {
            return b
        }
        )),
        n.d(e, "l", (function() {
            return w
        }
        )),
        n.d(e, "r", (function() {
            return _
        }
        )),
        n.d(e, "s", (function() {
            return S
        }
        )),
        n.d(e, "c", (function() {
            return A
        }
        )),
        n.d(e, "a", (function() {
            return O
        }
        )),
        n.d(e, "i", (function() {
            return E
        }
        )),
        n.d(e, "E", (function() {
            return x
        }
        )),
        n.d(e, "F", (function() {
            return T
        }
        )),
        n.d(e, "g", (function() {
            return k
        }
        )),
        n.d(e, "b", (function() {
            return I
        }
        )),
        n.d(e, "G", (function() {
            return C
        }
        )),
        n.d(e, "m", (function() {
            return D
        }
        )),
        n.d(e, "v", (function() {
            return j
        }
        )),
        n.d(e, "t", (function() {
            return P
        }
        )),
        n.d(e, "o", (function() {
            return N
        }
        )),
        n.d(e, "w", (function() {
            return R
        }
        ));
        var r = "UPDATE_INDEX_BY_KEY"
          , o = "UPDATE_RESULT"
          , a = "UPDATE_SERVER_CONFIG"
          , i = "TOGGLE_TEXTTRANS_INDEX"
          , c = "UPDATE_TRANS_BY_KEY"
          , u = "UPDATE_TRANSLATE_DATA"
          , s = "UPDATE_QUERY"
          , l = "TOGGLE_LOADING"
          , p = "UPDATE_SERVER_SGTKN"
          , f = "UPDATE_AD_TITLE"
          , d = "UPDATE_SERVER_UIGS"
          , h = "TOGGLE_TRANSLATE_RECORD_DIALOG"
          , g = "UPDATE_SUGGESTION"
          , m = "UPDATE_KANA_TIPS"
          , y = "UPDATE_FLOAT_MARK"
          , v = "TOGGLE_TAB"
          , b = "TOGGLE_WORD_AFFIX"
          , w = "UPDATE_AFFIX_SENCE_INFO"
          , _ = "UPDATE_LANGUAGE"
          , S = "UPDATE_LANGUAGE_LIST"
          , A = "TOGGLE_LANGMAP_SHOW"
          , O = "TOGGLE_DETECT_SHOW"
          , E = "TOGGLE_TRANSMODEL_POPUP"
          , x = "UPDATE_TRANS_MODEL"
          , T = "UPDATE_VOICE"
          , k = "TOGGLE_TOAST"
          , I = "TOGGLE_FEEDBACK"
          , C = "UPDATE_WRITING_BY_KEY"
          , D = "UPDATE_CORRECTINFO_BY_ID"
          , j = "UPDATE_QUERY_BY_ID"
          , P = "UPDATE_POLISHEDSENTS"
          , N = "UPDATE_HAS_ACTIVE"
          , R = "UPDATE_QUERY_RESULT"
    },
    "13": function(t, e) {
        t.exports = window.Vue
    },
    "141": function(t, e, n) {},
    "145": function(t, e) {
        t.exports = window.VuexRouterSync
    },
    "147": function(t, e) {
        var n, r, o = o || function(t, e) {
            var n = {}
              , r = n.lib = {}
              , o = function() {}
              , a = r.Base = {
                "extend": function(t) {
                    o.prototype = this;
                    var e = new o;
                    return t && e.mixIn(t),
                    e.hasOwnProperty("init") || (e.init = function() {
                        e.$super.init.apply(this, arguments)
                    }
                    ),
                    e.init.prototype = e,
                    e.$super = this,
                    e
                },
                "create": function() {
                    var t = this.extend();
                    return t.init.apply(t, arguments),
                    t
                },
                "init": function() {},
                "mixIn": function(t) {
                    for (var e in t)
                        t.hasOwnProperty(e) && (this[e] = t[e]);
                    t.hasOwnProperty("toString") && (this.toString = t.toString)
                },
                "clone": function() {
                    return this.init.prototype.extend(this)
                }
            }
              , i = r.WordArray = a.extend({
                "init": function(t, e) {
                    t = this.words = t || [],
                    this.sigBytes = undefined !== e ? e : 4 * t.length
                },
                "toString": function(t) {
                    return (t || u).stringify(this)
                },
                "concat": function(t) {
                    var e = this.words
                      , n = t.words
                      , r = this.sigBytes;
                    if (t = t.sigBytes,
                    this.clamp(),
                    r % 4)
                        for (var o = 0; o < t; o++)
                            e[r + o >>> 2] |= (n[o >>> 2] >>> 24 - o % 4 * 8 & 255) << 24 - (r + o) % 4 * 8;
                    else if (65535 < n.length)
                        for (o = 0; o < t; o += 4)
                            e[r + o >>> 2] = n[o >>> 2];
                    else
                        e.push.apply(e, n);
                    return this.sigBytes += t,
                    this
                },
                "clamp": function() {
                    var e = this.words
                      , n = this.sigBytes;
                    e[n >>> 2] &= 4294967295 << 32 - n % 4 * 8,
                    e.length = t.ceil(n / 4)
                },
                "clone": function() {
                    var t = a.clone.call(this);
                    return t.words = this.words.slice(0),
                    t
                },
                "random": function(e) {
                    for (var n = [], r = 0; r < e; r += 4)
                        n.push(4294967296 * t.random() | 0);
                    return new i.init(n,e)
                }
            })
              , c = n.enc = {}
              , u = c.Hex = {
                "stringify": function(t) {
                    var e = t.words;
                    t = t.sigBytes;
                    for (var n = [], r = 0; r < t; r++) {
                        var o = e[r >>> 2] >>> 24 - r % 4 * 8 & 255;
                        n.push((o >>> 4).toString(16)),
                        n.push((15 & o).toString(16))
                    }
                    return n.join("")
                },
                "parse": function(t) {
                    for (var e = t.length, n = [], r = 0; r < e; r += 2)
                        n[r >>> 3] |= parseInt(t.substr(r, 2), 16) << 10;
                    return new i.init(n,e / 2)
                }
            }
              , s = c.Latin1 = {
                "stringify": function(t) {
                    var e = t.words;
                    t = t.sigBytes;
                    for (var n = [], r = 0; r < t; r++)
                        n.push(String.fromCharCode(e[r >>> 2] >>> 24 - r % 4 * 8 & 255));
                    return n.join("")
                },
                "parse": function(t) {
                    for (var e = t.length, n = [], r = 0; r < e; r++)
                        n[r >>> 2] |= (255 & t.charCodeAt(r)) << 24 - r % 4 * 8;
                    return new i.init(n,e)
                }
            }
              , l = c.Utf8 = {
                "stringify": function(t) {
                    try {
                        return decodeURIComponent(escape(s.stringify(t)))
                    } catch (t) {
                        throw Error("Malformed UTF-8 data")
                    }
                },
                "parse": function(t) {
                    return s.parse(unescape(encodeURIComponent(t)))
                }
            }
              , p = r.BufferedBlockAlgorithm = a.extend({
                "reset": function() {
                    this._data = new i.init,
                    this._nDataBytes = 0
                },
                "_append": function(t) {
                    "string" == typeof t && (t = l.parse(t)),
                    this._data.concat(t),
                    this._nDataBytes += t.sigBytes
                },
                "_process": function(e) {
                    var n = this._data
                      , r = n.words
                      , o = n.sigBytes
                      , a = this.blockSize
                      , c = o / (4 * a);
                    if (e = (c = e ? t.ceil(c) : t.max((0 | c) - this._minBufferSize, 0)) * a,
                    o = t.min(4 * e, o),
                    e) {
                        for (var u = 0; u < e; u += a)
                            this._doProcessBlock(r, u);
                        u = r.splice(0, e),
                        n.sigBytes -= o
                    }
                    return new i.init(u,o)
                },
                "clone": function() {
                    var t = a.clone.call(this);
                    return t._data = this._data.clone(),
                    t
                },
                "_minBufferSize": 0
            });
            r.Hasher = p.extend({
                "cfg": a.extend(),
                "init": function(t) {
                    this.cfg = this.cfg.extend(t),
                    this.reset()
                },
                "reset": function() {
                    p.reset.call(this),
                    this._doReset()
                },
                "update": function(t) {
                    return this._append(t),
                    this._process(),
                    this
                },
                "finalize": function(t) {
                    return t && this._append(t),
                    this._doFinalize()
                },
                "blockSize": 16,
                "_createHelper": function(t) {
                    return function(e, n) {
                        return new t.init(n).finalize(e)
                    }
                },
                "_createHmacHelper": function(t) {
                    return function(e, n) {
                        return new f.HMAC.init(t,n).finalize(e)
                    }
                }
            });
            var f = n.algo = {};
            return n
        }(Math);
        r = (n = o).lib.WordArray,
        n.enc.Base64 = {
            "stringify": function(t) {
                var e = t.words
                  , n = t.sigBytes
                  , r = this._map;
                t.clamp(),
                t = [];
                for (var o = 0; o < n; o += 3)
                    for (var a = (e[o >>> 2] >>> 24 - o % 4 * 8 & 255) << 16 | (e[o + 1 >>> 2] >>> 24 - (o + 1) % 4 * 8 & 255) << 8 | e[o + 2 >>> 2] >>> 24 - (o + 2) % 4 * 8 & 255, i = 0; 4 > i && o + .75 * i < n; i++)
                        t.push(r.charAt(a >>> 6 * (3 - i) & 63));
                if (e = r.charAt(64))
                    for (; t.length % 4; )
                        t.push(e);
                return t.join("")
            },
            "parse": function(t) {
                var e = t.length
                  , n = this._map;
                (o = n.charAt(64)) && -1 !== (o = t.indexOf(o)) && (e = o);
                for (var o = [], a = 0, i = 0; i < e; i++)
                    if (i % 4) {
                        var c = n.indexOf(t.charAt(i - 1)) << i % 4 * 2
                          , u = n.indexOf(t.charAt(i)) >>> 6 - i % 4 * 2;
                        o[a >>> 2] |= (c | u) << 24 - a % 4 * 8,
                        a++
                    }
                return r.create(o, a)
            },
            "_map": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
        },
        function(t) {
            function e(t, e, n, r, o, a, i) {
                return ((t = t + (e & n | ~e & r) + o + i) << a | t >>> 32 - a) + e
            }
            function n(t, e, n, r, o, a, i) {
                return ((t = t + (e & r | n & ~r) + o + i) << a | t >>> 32 - a) + e
            }
            function r(t, e, n, r, o, a, i) {
                return ((t = t + (e ^ n ^ r) + o + i) << a | t >>> 32 - a) + e
            }
            function a(t, e, n, r, o, a, i) {
                return ((t = t + (n ^ (e | ~r)) + o + i) << a | t >>> 32 - a) + e
            }
            for (var i = o, c = (s = i.lib).WordArray, u = s.Hasher, s = i.algo, l = [], p = 0; 64 > p; p++)
                l[p] = 4294967296 * t.abs(t.sin(p + 1)) | 0;
            s = s.MD5 = u.extend({
                "_doReset": function() {
                    this._hash = new c.init([1732584193, 4023233417, 2562383102, 271733878])
                },
                "_doProcessBlock": function(t, o) {
                    for (var i = 0; 16 > i; i++) {
                        var c = t[u = o + i];
                        t[u] = 16711935 & (c << 8 | c >>> 24) | 4278255360 & (c << 24 | c >>> 8)
                    }
                    i = this._hash.words;
                    var u = t[o + 0]
                      , s = (c = t[o + 1],
                    t[o + 2])
                      , p = t[o + 3]
                      , f = t[o + 4]
                      , d = t[o + 5]
                      , h = t[o + 6]
                      , g = t[o + 7]
                      , m = t[o + 8]
                      , y = t[o + 9]
                      , v = t[o + 10]
                      , b = t[o + 11]
                      , w = t[o + 12]
                      , _ = t[o + 13]
                      , S = t[o + 14]
                      , A = t[o + 15]
                      , O = e(O = i[0], T = i[1], x = i[2], E = i[3], u, 7, l[0])
                      , E = e(E, O, T, x, c, 12, l[1])
                      , x = e(x, E, O, T, s, 17, l[2])
                      , T = e(T, x, E, O, p, 22, l[3]);
                    O = e(O, T, x, E, f, 7, l[4]),
                    E = e(E, O, T, x, d, 12, l[5]),
                    x = e(x, E, O, T, h, 17, l[6]),
                    T = e(T, x, E, O, g, 22, l[7]),
                    O = e(O, T, x, E, m, 7, l[8]),
                    E = e(E, O, T, x, y, 12, l[9]),
                    x = e(x, E, O, T, v, 17, l[10]),
                    T = e(T, x, E, O, b, 22, l[11]),
                    O = e(O, T, x, E, w, 7, l[12]),
                    E = e(E, O, T, x, _, 12, l[13]),
                    x = e(x, E, O, T, S, 17, l[14]),
                    O = n(O, T = e(T, x, E, O, A, 22, l[15]), x, E, c, 5, l[16]),
                    E = n(E, O, T, x, h, 9, l[17]),
                    x = n(x, E, O, T, b, 14, l[18]),
                    T = n(T, x, E, O, u, 20, l[19]),
                    O = n(O, T, x, E, d, 5, l[20]),
                    E = n(E, O, T, x, v, 9, l[21]),
                    x = n(x, E, O, T, A, 14, l[22]),
                    T = n(T, x, E, O, f, 20, l[23]),
                    O = n(O, T, x, E, y, 5, l[24]),
                    E = n(E, O, T, x, S, 9, l[25]),
                    x = n(x, E, O, T, p, 14, l[26]),
                    T = n(T, x, E, O, m, 20, l[27]),
                    O = n(O, T, x, E, _, 5, l[28]),
                    E = n(E, O, T, x, s, 9, l[29]),
                    x = n(x, E, O, T, g, 14, l[30]),
                    O = r(O, T = n(T, x, E, O, w, 20, l[31]), x, E, d, 4, l[32]),
                    E = r(E, O, T, x, m, 11, l[33]),
                    x = r(x, E, O, T, b, 16, l[34]),
                    T = r(T, x, E, O, S, 23, l[35]),
                    O = r(O, T, x, E, c, 4, l[36]),
                    E = r(E, O, T, x, f, 11, l[37]),
                    x = r(x, E, O, T, g, 16, l[38]),
                    T = r(T, x, E, O, v, 23, l[39]),
                    O = r(O, T, x, E, _, 4, l[40]),
                    E = r(E, O, T, x, u, 11, l[41]),
                    x = r(x, E, O, T, p, 16, l[42]),
                    T = r(T, x, E, O, h, 23, l[43]),
                    O = r(O, T, x, E, y, 4, l[44]),
                    E = r(E, O, T, x, w, 11, l[45]),
                    x = r(x, E, O, T, A, 16, l[46]),
                    O = a(O, T = r(T, x, E, O, s, 23, l[47]), x, E, u, 6, l[48]),
                    E = a(E, O, T, x, g, 10, l[49]),
                    x = a(x, E, O, T, S, 15, l[50]),
                    T = a(T, x, E, O, d, 21, l[51]),
                    O = a(O, T, x, E, w, 6, l[52]),
                    E = a(E, O, T, x, p, 10, l[53]),
                    x = a(x, E, O, T, v, 15, l[54]),
                    T = a(T, x, E, O, c, 21, l[55]),
                    O = a(O, T, x, E, m, 6, l[56]),
                    E = a(E, O, T, x, A, 10, l[57]),
                    x = a(x, E, O, T, h, 15, l[58]),
                    T = a(T, x, E, O, _, 21, l[59]),
                    O = a(O, T, x, E, f, 6, l[60]),
                    E = a(E, O, T, x, b, 10, l[61]),
                    x = a(x, E, O, T, s, 15, l[62]),
                    T = a(T, x, E, O, y, 21, l[63]);
                    i[0] = i[0] + O | 0,
                    i[1] = i[1] + T | 0,
                    i[2] = i[2] + x | 0,
                    i[3] = i[3] + E | 0
                },
                "_doFinalize": function() {
                    var e = this._data
                      , n = e.words
                      , r = 8 * this._nDataBytes
                      , o = 8 * e.sigBytes;
                    n[o >>> 5] |= 128 << 24 - o % 32;
                    var a = t.floor(r / 4294967296);
                    for (n[15 + (o + 64 >>> 9 << 4)] = 16711935 & (a << 8 | a >>> 24) | 4278255360 & (a << 24 | a >>> 8),
                    n[14 + (o + 64 >>> 9 << 4)] = 16711935 & (r << 8 | r >>> 24) | 4278255360 & (r << 24 | r >>> 8),
                    e.sigBytes = 4 * (n.length + 1),
                    this._process(),
                    n = (e = this._hash).words,
                    r = 0; 4 > r; r++)
                        o = n[r],
                        n[r] = 16711935 & (o << 8 | o >>> 24) | 4278255360 & (o << 24 | o >>> 8);
                    return e
                },
                "clone": function() {
                    var t = u.clone.call(this);
                    return t._hash = this._hash.clone(),
                    t
                }
            }),
            i.MD5 = u._createHelper(s),
            i.HmacMD5 = u._createHmacHelper(s)
        }(Math),
        function() {
            var t, e = o, n = (t = e.lib).Base, r = t.WordArray, a = (t = e.algo).EvpKDF = n.extend({
                "cfg": n.extend({
                    "keySize": 4,
                    "hasher": t.MD5,
                    "iterations": 1
                }),
                "init": function(t) {
                    this.cfg = this.cfg.extend(t)
                },
                "compute": function(t, e) {
                    for (var n = (c = this.cfg).hasher.create(), o = r.create(), a = o.words, i = c.keySize, c = c.iterations; a.length < i; ) {
                        u && n.update(u);
                        var u = n.update(t).finalize(e);
                        n.reset();
                        for (var s = 1; s < c; s++)
                            u = n.finalize(u),
                            n.reset();
                        o.concat(u)
                    }
                    return o.sigBytes = 4 * i,
                    o
                }
            });
            e.EvpKDF = function(t, e, n) {
                return a.create(n).compute(t, e)
            }
        }(),
        o.lib.Cipher || function(t) {
            var e = (h = o).lib
              , n = e.Base
              , r = e.WordArray
              , a = e.BufferedBlockAlgorithm
              , i = h.enc.Base64
              , c = h.algo.EvpKDF
              , u = e.Cipher = a.extend({
                "cfg": n.extend(),
                "createEncryptor": function(t, e) {
                    return this.create(this._ENC_XFORM_MODE, t, e)
                },
                "createDecryptor": function(t, e) {
                    return this.create(this._DEC_XFORM_MODE, t, e)
                },
                "init": function(t, e, n) {
                    this.cfg = this.cfg.extend(n),
                    this._xformMode = t,
                    this._key = e,
                    this.reset()
                },
                "reset": function() {
                    a.reset.call(this),
                    this._doReset()
                },
                "process": function(t) {
                    return this._append(t),
                    this._process()
                },
                "finalize": function(t) {
                    return t && this._append(t),
                    this._doFinalize()
                },
                "keySize": 4,
                "ivSize": 4,
                "_ENC_XFORM_MODE": 1,
                "_DEC_XFORM_MODE": 2,
                "_createHelper": function(t) {
                    return {
                        "encrypt": function(e, n, r) {
                            return ("string" == typeof n ? g : d).encrypt(t, e, n, r)
                        },
                        "decrypt": function(e, n, r) {
                            return ("string" == typeof n ? g : d).decrypt(t, e, n, r)
                        }
                    }
                }
            });
            e.StreamCipher = u.extend({
                "_doFinalize": function() {
                    return this._process(!0)
                },
                "blockSize": 1
            });
            var s = h.mode = {}
              , l = function(t, e, n) {
                var r = this._iv;
                r ? this._iv = undefined : r = this._prevBlock;
                for (var o = 0; o < n; o++)
                    t[e + o] ^= r[o]
            }
              , p = (e.BlockCipherMode = n.extend({
                "createEncryptor": function(t, e) {
                    return this.Encryptor.create(t, e)
                },
                "createDecryptor": function(t, e) {
                    return this.Decryptor.create(t, e)
                },
                "init": function(t, e) {
                    this._cipher = t,
                    this._iv = e
                }
            })).extend();
            p.Encryptor = p.extend({
                "processBlock": function(t, e) {
                    var n = this._cipher
                      , r = n.blockSize;
                    l.call(this, t, e, r),
                    n.encryptBlock(t, e),
                    this._prevBlock = t.slice(e, e + r)
                }
            }),
            p.Decryptor = p.extend({
                "processBlock": function(t, e) {
                    var n = this._cipher
                      , r = n.blockSize
                      , o = t.slice(e, e + r);
                    n.decryptBlock(t, e),
                    l.call(this, t, e, r),
                    this._prevBlock = o
                }
            }),
            s = s.CBC = p,
            p = (h.pad = {}).Pkcs7 = {
                "pad": function(t, e) {
                    for (var n, o = (n = (n = 4 * e) - t.sigBytes % n) << 24 | n << 16 | n << 8 | n, a = [], i = 0; i < n; i += 4)
                        a.push(o);
                    n = r.create(a, n),
                    t.concat(n)
                },
                "unpad": function(t) {
                    t.sigBytes -= 255 & t.words[t.sigBytes - 1 >>> 2]
                }
            },
            e.BlockCipher = u.extend({
                "cfg": u.cfg.extend({
                    "mode": s,
                    "padding": p
                }),
                "reset": function() {
                    u.reset.call(this);
                    var t = (e = this.cfg).iv
                      , e = e.mode;
                    if (this._xformMode === this._ENC_XFORM_MODE)
                        var n = e.createEncryptor;
                    else
                        n = e.createDecryptor,
                        this._minBufferSize = 1;
                    this._mode = n.call(e, this, t && t.words)
                },
                "_doProcessBlock": function(t, e) {
                    this._mode.processBlock(t, e)
                },
                "_doFinalize": function() {
                    var t = this.cfg.padding;
                    if (this._xformMode === this._ENC_XFORM_MODE) {
                        t.pad(this._data, this.blockSize);
                        var e = this._process(!0)
                    } else
                        e = this._process(!0),
                        t.unpad(e);
                    return e
                },
                "blockSize": 4
            });
            var f = e.CipherParams = n.extend({
                "init": function(t) {
                    this.mixIn(t)
                },
                "toString": function(t) {
                    return (t || this.formatter).stringify(this)
                }
            })
              , d = (s = (h.format = {}).OpenSSL = {
                "stringify": function(t) {
                    var e = t.ciphertext;
                    return ((t = t.salt) ? r.create([1398893684, 1701076831]).concat(t).concat(e) : e).toString(i)
                },
                "parse": function(t) {
                    var e = (t = i.parse(t)).words;
                    if (1398893684 === e[0] && 1701076831 === e[1]) {
                        var n = r.create(e.slice(2, 4));
                        e.splice(0, 4),
                        t.sigBytes -= 16
                    }
                    return f.create({
                        "ciphertext": t,
                        "salt": n
                    })
                }
            },
            e.SerializableCipher = n.extend({
                "cfg": n.extend({
                    "format": s
                }),
                "encrypt": function(t, e, n, r) {
                    r = this.cfg.extend(r);
                    var o = t.createEncryptor(n, r);
                    return e = o.finalize(e),
                    o = o.cfg,
                    f.create({
                        "ciphertext": e,
                        "key": n,
                        "iv": o.iv,
                        "algorithm": t,
                        "mode": o.mode,
                        "padding": o.padding,
                        "blockSize": t.blockSize,
                        "formatter": r.format
                    })
                },
                "decrypt": function(t, e, n, r) {
                    return r = this.cfg.extend(r),
                    e = this._parse(e, r.format),
                    t.createDecryptor(n, r).finalize(e.ciphertext)
                },
                "_parse": function(t, e) {
                    return "string" == typeof t ? e.parse(t, this) : t
                }
            }))
              , h = (h.kdf = {}).OpenSSL = {
                "execute": function(t, e, n, o) {
                    return o || (o = r.random(8)),
                    t = c.create({
                        "keySize": e + n
                    }).compute(t, o),
                    n = r.create(t.words.slice(e), 4 * n),
                    t.sigBytes = 4 * e,
                    f.create({
                        "key": t,
                        "iv": n,
                        "salt": o
                    })
                }
            }
              , g = e.PasswordBasedCipher = d.extend({
                "cfg": d.cfg.extend({
                    "kdf": h
                }),
                "encrypt": function(t, e, n, r) {
                    return n = (r = this.cfg.extend(r)).kdf.execute(n, t.keySize, t.ivSize),
                    r.iv = n.iv,
                    (t = d.encrypt.call(this, t, e, n.key, r)).mixIn(n),
                    t
                },
                "decrypt": function(t, e, n, r) {
                    return r = this.cfg.extend(r),
                    e = this._parse(e, r.format),
                    n = r.kdf.execute(n, t.keySize, t.ivSize, e.salt),
                    r.iv = n.iv,
                    d.decrypt.call(this, t, e, n.key, r)
                }
            })
        }(),
        function() {
            for (var t = o, e = t.lib.BlockCipher, n = t.algo, r = [], a = [], i = [], c = [], u = [], s = [], l = [], p = [], f = [], d = [], h = [], g = 0; 256 > g; g++)
                h[g] = 128 > g ? g << 1 : g << 1 ^ 283;
            var m = 0
              , y = 0;
            for (g = 0; 256 > g; g++) {
                var v = (v = y ^ y << 1 ^ y << 2 ^ y << 3 ^ y << 4) >>> 8 ^ 255 & v ^ 99;
                r[m] = v,
                a[v] = m;
                var b = h[m]
                  , w = h[b]
                  , _ = h[w]
                  , S = 257 * h[v] ^ 16843008 * v;
                i[m] = S << 24 | S >>> 8,
                c[m] = S << 16 | S >>> 16,
                u[m] = S << 8 | S >>> 24,
                s[m] = S,
                S = 16843009 * _ ^ 65537 * w ^ 257 * b ^ 16843008 * m,
                l[v] = S << 24 | S >>> 8,
                p[v] = S << 16 | S >>> 16,
                f[v] = S << 8 | S >>> 24,
                d[v] = S,
                m ? (m = b ^ h[h[h[_ ^ b]]],
                y ^= h[h[y]]) : m = y = 1
            }
            var A = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54];
            n = n.AES = e.extend({
                "_doReset": function() {
                    for (var t = (n = this._key).words, e = n.sigBytes / 4, n = 4 * ((this._nRounds = e + 6) + 1), o = this._keySchedule = [], a = 0; a < n; a++)
                        if (a < e)
                            o[a] = t[a];
                        else {
                            var i = o[a - 1];
                            a % e ? 6 < e && 4 == a % e && (i = r[i >>> 24] << 24 | r[i >>> 16 & 255] << 16 | r[i >>> 8 & 255] << 8 | r[255 & i]) : (i = r[(i = i << 8 | i >>> 24) >>> 24] << 24 | r[i >>> 16 & 255] << 16 | r[i >>> 8 & 255] << 8 | r[255 & i],
                            i ^= A[a / e | 0] << 24),
                            o[a] = o[a - e] ^ i
                        }
                    for (t = this._invKeySchedule = [],
                    e = 0; e < n; e++)
                        a = n - e,
                        i = e % 4 ? o[a] : o[a - 4],
                        t[e] = 4 > e || 4 >= a ? i : l[r[i >>> 24]] ^ p[r[i >>> 16 & 255]] ^ f[r[i >>> 8 & 255]] ^ d[r[255 & i]]
                },
                "encryptBlock": function(t, e) {
                    this._doCryptBlock(t, e, this._keySchedule, i, c, u, s, r)
                },
                "decryptBlock": function(t, e) {
                    var n = t[e + 1];
                    t[e + 1] = t[e + 3],
                    t[e + 3] = n,
                    this._doCryptBlock(t, e, this._invKeySchedule, l, p, f, d, a),
                    n = t[e + 1],
                    t[e + 1] = t[e + 3],
                    t[e + 3] = n
                },
                "_doCryptBlock": function(t, e, n, r, o, a, i, c) {
                    for (var u = this._nRounds, s = t[e] ^ n[0], l = t[e + 1] ^ n[1], p = t[e + 2] ^ n[2], f = t[e + 3] ^ n[3], d = 4, h = 1; h < u; h++) {
                        var g = r[s >>> 24] ^ o[l >>> 16 & 255] ^ a[p >>> 8 & 255] ^ i[255 & f] ^ n[d++]
                          , m = r[l >>> 24] ^ o[p >>> 16 & 255] ^ a[f >>> 8 & 255] ^ i[255 & s] ^ n[d++]
                          , y = r[p >>> 24] ^ o[f >>> 16 & 255] ^ a[s >>> 8 & 255] ^ i[255 & l] ^ n[d++];
                        f = r[f >>> 24] ^ o[s >>> 16 & 255] ^ a[l >>> 8 & 255] ^ i[255 & p] ^ n[d++],
                        s = g,
                        l = m,
                        p = y
                    }
                    g = (c[s >>> 24] << 24 | c[l >>> 16 & 255] << 16 | c[p >>> 8 & 255] << 8 | c[255 & f]) ^ n[d++],
                    m = (c[l >>> 24] << 24 | c[p >>> 16 & 255] << 16 | c[f >>> 8 & 255] << 8 | c[255 & s]) ^ n[d++],
                    y = (c[p >>> 24] << 24 | c[f >>> 16 & 255] << 16 | c[s >>> 8 & 255] << 8 | c[255 & l]) ^ n[d++],
                    f = (c[f >>> 24] << 24 | c[s >>> 16 & 255] << 16 | c[l >>> 8 & 255] << 8 | c[255 & p]) ^ n[d++],
                    t[e] = g,
                    t[e + 1] = m,
                    t[e + 2] = y,
                    t[e + 3] = f
                },
                "keySize": 8
            });
            t.AES = e._createHelper(n)
        }(),
        t.exports = o
    },
    "19": function(t, e, n) {
        "use strict";
        n.r(e),
        n.d(e, "ORIGIN_CLIENT", (function() {
            return r
        }
        )),
        n.d(e, "IS_PROD_ENV", (function() {
            return o
        }
        )),
        n.d(e, "MAX_TRANSLATE_LEN", (function() {
            return a
        }
        )),
        n.d(e, "MAX_VOICE_LEN", (function() {
            return i
        }
        )),
        n.d(e, "MAX_VOICE_LOOP", (function() {
            return c
        }
        )),
        n.d(e, "AUDIO_TTS_PATH", (function() {
            return u
        }
        )),
        n.d(e, "CK_KEY_SUV", (function() {
            return s
        }
        )),
        n.d(e, "CK_KEY_SURVEY", (function() {
            return l
        }
        )),
        n.d(e, "CK_KEY_UPSCREEN", (function() {
            return p
        }
        )),
        n.d(e, "LS_KEY_TRANSLATE_RECORD", (function() {
            return f
        }
        )),
        n.d(e, "LS_KEY_SRC_KANA_SWITCH", (function() {
            return d
        }
        )),
        n.d(e, "LS_KEY_TGT_KANA_SWITCH", (function() {
            return h
        }
        )),
        n.d(e, "MAX_SUGGESTION_NUM", (function() {
            return g
        }
        )),
        n.d(e, "MAX_SUGGESTION_QUERY_LEN", (function() {
            return m
        }
        )),
        n.d(e, "TAB_LIST", (function() {
            return y
        }
        )),
        n.d(e, "LANGUAGE_FROM_LIST", (function() {
            return v
        }
        )),
        n.d(e, "LANGUAGE_TO_LIST", (function() {
            return b
        }
        )),
        n.d(e, "OXFORD_TAB_LIST", (function() {
            return w
        }
        )),
        n.d(e, "TRANS_MODEL_LIST", (function() {
            return _
        }
        )),
        n.d(e, "USER_LIST", (function() {
            return S
        }
        )),
        n.d(e, "AD_WORD", (function() {
            return A
        }
        ));
        var r = ""
          , o = "production"
          , a = 5e3
          , i = 400
          , c = 10
          , u = "/openapi/external/getWebTTS"
          , s = "SUV"
          , l = "Survey"
          , p = "SGINPUT_UPSCREEN"
          , f = "TranslateWapRecord"
          , d = "TranslateWapSrcKana"
          , h = "TranslateWapTgtKana"
          , g = 10
          , m = 70
          , y = [{
            "type": "detail",
            "name": "常用"
        }, {
            "type": "oxford",
            "name": "牛津"
        }, {
            "type": "newCentury",
            "name": "权威"
        }, {
            "type": "zhongkao",
            "name": "中考"
        }, {
            "type": "gaokao",
            "name": "高考"
        }, {
            "type": "CET4",
            "name": "四级"
        }, {
            "type": "CET6",
            "name": "六级"
        }, {
            "type": "book",
            "name": "影视原声"
        }, {
            "type": "network",
            "name": "网络释义"
        }, {
            "type": "pic",
            "name": "词汇拓展"
        }, {
            "type": "keywords",
            "name": "重点词汇"
        }]
          , v = [{
            "lang": "en",
            "text": "英语",
            "play": !0
        }, {
            "lang": "zh-CHS",
            "text": "中文",
            "play": !0
        }, {
            "lang": "ja",
            "text": "日语",
            "play": !0
        }]
          , b = [{
            "lang": "zh-CHS",
            "text": "中文",
            "play": !0
        }, {
            "lang": "en",
            "text": "英语",
            "play": !0
        }, {
            "lang": "ja",
            "text": "日语",
            "play": !0
        }]
          , w = {
            "detail": {
                "originHeight": 500,
                "show": !1,
                "text": "更多释义",
                "toggle": !0
            },
            "phrases": {
                "originHeight": 250,
                "show": !1,
                "text": "更多短语",
                "toggle": !0
            },
            "phrasalVerbs": {
                "originHeight": 250,
                "show": !1,
                "text": "更多短语动词",
                "toggle": !0
            }
        }
          , _ = [{
            "textSimple": "通用",
            "text": "通用领域",
            "val": "general"
        }, {
            "textSimple": "医学",
            "text": "生物医学",
            "val": "medical"
        }, {
            "textSimple": "金融",
            "text": "金融财经",
            "val": "finance"
        }]
          , S = ["迟来的缘", "丫妮疒I", "拒绝暧昧", "ice", "李胖子", "莫尛锛哭", "释怀", "调皮的家伙", "好诗书克拉", "秋末初冬", "性感pg", "囿你", "爱你到永远", "卢文建", "翠竹之缘", "男神", "回车键", "我是二号", "枣庄老王", "周天易海", "呵呵4", "很闹心", "5886qiz", "果冻", "不知火舞", "哦陪明白", "天空星星", "一生学习", "平安是福", "丑小鸭", "BORN", "hardg", "阿醒妈妈", "最情人", "耐宇汽车", "淡定", "吾过客", "观鱼读月", "颐凡", "逻魂不灭", "喂喂", "Antunes", "小哥", "小财神", "小★丫★头"]
          , A = ["英语", "四六级", "考研英语", "雅思", "日语", "留学", "少儿英语", "成人英语", "翻译", "口语", "外语", "启蒙英语"]
    },
    "30": function(t, e, n) {
        "use strict";
        n.d(e, "a", (function() {
            return h
        }
        )),
        n.d(e, "d", (function() {
            return g
        }
        )),
        n.d(e, "e", (function() {
            return m
        }
        )),
        n.d(e, "c", (function() {
            return y
        }
        ));
        var r = n(103)
          , o = n.n(r)
          , a = n(2)
          , i = n.n(a);
        function c(t, e) {
            var n = Object.keys(t);
            if (Object.getOwnPropertySymbols) {
                var r = Object.getOwnPropertySymbols(t);
                e && (r = r.filter((function(e) {
                    return Object.getOwnPropertyDescriptor(t, e).enumerable
                }
                ))),
                n.push.apply(n, r)
            }
            return n
        }
        var u = n(19)
          , s = u.CK_KEY_SUV
          , l = u.MAX_VOICE_LEN
          , p = u.AUDIO_TTS_PATH
          , f = n(146)
          , d = {
            "removeElement": function(t) {
                var e = t.parentNode;
                e && e.removeChild(t)
            },
            "sendApprove": function(t, e) {
                (new Image).src = "/approve?uuid=".concat(encodeURIComponent(t), "&token=").concat(encodeURIComponent(e))
            },
            "getParentTag": function(t) {
                var e = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : [];
                if (t instanceof HTMLElement)
                    return t.parentElement && "BODY" !== t.parentElement.nodeName ? (e.push(t.parentElement.className),
                    d.getParentTag(t.parentElement, e)) : e
            },
            "uigsInit": function(t) {
                var e = t.self
                  , r = t.pagetype
                  , o = t.uuid
                  , a = t.qua
                  , u = void 0 === a ? "" : a
                  , l = t.guid
                  , p = t.qimei36
                  , d = t.terminal
                  , h = void 0 === d ? "wap" : d
                  , g = t.extraData
                  , m = void 0 === g ? {} : g
                  , y = n(33)
                  , v = 1
                  , b = /(msie\s|trident.*rv:)([\w.]+)/.exec(window.navigator.userAgent.toLowerCase());
                null !== b && (v = (parseInt(b[2], 10) || 0) < 10 ? 0 : 1);
                var w = f.get(s)
                  , _ = new Date;
                w || (w = _.getTime(),
                _.setTime(w + 31536e6),
                f.set(s, w, _)),
                e.$uigs.add(function(t) {
                    for (var e = 1; e < arguments.length; e++) {
                        var n = null != arguments[e] ? arguments[e] : {};
                        e % 2 ? c(Object(n), !0).forEach((function(e) {
                            i()(t, e, n[e])
                        }
                        )) : Object.getOwnPropertyDescriptors ? Object.defineProperties(t, Object.getOwnPropertyDescriptors(n)) : c(Object(n)).forEach((function(e) {
                            Object.defineProperty(t, e, Object.getOwnPropertyDescriptor(n, e))
                        }
                        ))
                    }
                    return t
                }({
                    "uigs_productid": "vs_web",
                    "vstype": "translate",
                    "snuid": "" === f.get("SNUID") ? null : f.get("SNUID"),
                    "terminal": h,
                    "pagetype": r,
                    "pbtype": "pv",
                    "uuid": o,
                    "fr": y.parse().query.fr || "default",
                    "onerror": !0,
                    "wuid": w,
                    "tOverIe10": v,
                    "abtest": f.get("ABTEST").split("|")[0] || null,
                    "spver": y.parse().query.spver || 0,
                    "qua": u,
                    "guid": l,
                    "qimei36": p
                }, m))
            },
            "getSelection": function() {
                var t = "";
                try {
                    if (window.getSelection) {
                        var e = document.activeElement;
                        t = !e || "TEXTAREA" !== e.nodeName && "INPUT" !== e.nodeName ? window.getSelection() : e.value.substring(e.selectionStart, e.selectionEnd)
                    } else
                        document.getSelection ? t = document.getSelection() : document.selection && (t = document.selection.createRange().text)
                } catch (t) {}
                return t.toString().replace(/^\s+/g, "").replace(/\s+$/g, "")
            },
            "removeSelection": function() {
                window.getSelection ? window.getSelection().removeAllRanges() : document.getSelection && document.getSelection.empty ? document.getSelection().empty() : document.selection && document.selection.empty && document.selection.empty()
            },
            "lsSetItem": function(t, e) {
                var n = [];
                try {
                    n = window.localStorage.setItem(t, e)
                } catch (t) {
                    n = []
                }
                return n
            },
            "lsGetItem": function(t) {
                var e = [];
                try {
                    e = window.localStorage.getItem(t).replace(/[\s]{2,}/g, "")
                } catch (t) {
                    e = []
                }
                return e
            },
            "lsRemoveItem": function(t) {
                try {
                    return window.localStorage.removeItem(t),
                    !0
                } catch (t) {
                    return !1
                }
            },
            "getDataset": function(t) {
                if (t.dataset)
                    return t.dataset;
                for (var e, n = t.attributes, r = {}, o = 0; o < n.length; o++)
                    (e = n[o].name.match(/^data-(.+)/)) && (r[e[1].replace(/-([\da-z])/gi, (function(t, e) {
                        return e.toUpperCase()
                    }
                    ))] = n[o].value);
                return r
            },
            "hasClass": function(t, e) {
                return !!t.className.match(new RegExp("(\\s|^)".concat(e, "(\\s|$)")))
            },
            "addClass": function(t, e) {
                d.hasClass(t, e) || Object.assign(t, {
                    "className": "".concat(t.className, " ").concat(e)
                })
            },
            "removeClass": function(t, e) {
                if (d.hasClass(t, e)) {
                    var n = t.className.replace(new RegExp("(\\s|^)".concat(e, "(\\s|$)")), " ");
                    Object.assign(t, {
                        "className": n
                    })
                }
            },
            "urlParams": function(t) {
                var e = [];
                return Object.keys(t).forEach((function(n) {
                    e.push("".concat(n, "=").concat(encodeURIComponent(t[n])))
                }
                )),
                e.join("&")
            },
            "wordStatic": function(t) {
                var e = t.trim();
                if (!e)
                    return 0;
                var n = 0
                  , r = (e = (e = (e = e.replace(/[\u4e00-\u9fa5]+/g, " ").trim()).replace(/\n|\r|^\s+$/gi, "")).replace(/\s+/gi, " ")).match(/\s/g);
                return r ? n = r.length + 1 : e && (n = 1),
                n
            },
            "getRandomNum": function(t, e) {
                var n = "";
                switch (arguments.length) {
                case 1:
                    n = parseInt(Math.random() * t + 1, 10);
                    break;
                case 2:
                    n = parseInt(Math.random() * (e - t + 1) + t, 10);
                    break;
                default:
                    n = 0
                }
                return n
            },
            "toggleCopy": function(t) {
                if (t)
                    document.oncontextmenu = null,
                    document.body.style.userSelect = "auto",
                    document.onselectstart = null,
                    document.oncopy = null,
                    document.oncut = null;
                else {
                    var e, n = document.querySelector(".trans-main"), r = this;
                    document.oncontextmenu = function(t) {
                        if (e = t && t.target,
                        r.domContains(n, e))
                            return !1
                    }
                    ,
                    document.body.style.userSelect = "none",
                    document.onselectstart = function(t) {
                        if (e = t && t.target,
                        r.domContains(n, e))
                            return !1
                    }
                    ,
                    document.oncopy = function(t) {
                        if (e = t && t.target,
                        r.domContains(n, e))
                            return !1
                    }
                    ,
                    document.oncut = function(t) {
                        if (e = t && t.target,
                        r.domContains(n, e))
                            return !1
                    }
                }
            },
            "domContains": function(t, e) {
                var n;
                if (t && e)
                    for (n = e; n; ) {
                        if (t === n)
                            return !0;
                        n = n.parentNode
                    }
                return !1
            },
            "getCookie": function(t) {
                return f.get(t) || ""
            },
            "setCookie": function(t, e, n) {
                return f.set(t, e, n)
            },
            "setScrollTop": function(t) {
                if (t) {
                    var e = document.querySelector("#".concat(t))
                      , n = null;
                    n = setTimeout((function() {
                        if (clearTimeout(n),
                        e) {
                            var t = (e.getBoundingClientRect() || {
                                "y": 0
                            }).y
                              , r = void 0 === t ? 0 : t;
                            window.scrollTo ? window.scrollTo(0, r - 44) : void 0 !== document.documentElement.scrollTop ? document.documentElement.scrollTop = r - 44 : void 0 !== window.pageYOffset ? window.pageYOffset = r - 44 : document.body.scrollTop = r - 44
                        }
                    }
                    ), 21)
                }
            }
        };
        function h(t, e) {
            for (var n = t.split("."), r = e.split("."), o = n.length, a = 0; a < o; a++) {
                var i = r[a] || 0;
                if (n[a] > i)
                    return 1;
                if (n[a] !== i)
                    return -1
            }
            return o < r.length ? -1 : 0
        }
        function g(t, e, n) {
            var r = arguments.length > 3 && void 0 !== arguments[3] ? arguments[3] : "default"
              , a = arguments.length > 4 ? arguments[4] : void 0;
            if (!e)
                return "";
            if (!t)
                return e;
            var i = Array.isArray(n) ? n[0] : n
              , c = i ? e.split(i) : [e];
            if (Array.isArray(n) && 2 === n.length) {
                var u = o()(n, 2)
                  , s = u[1];
                c = c.reduce((function(t, e) {
                    return t.concat(e.split(s))
                }
                ), [])
            }
            var l = a ? ' data-pos="'.concat(a, '"') : "";
            return c.map((function(t) {
                return '<a href="javascript:void(0)" class="select-trans" data-tab="'.concat(r, '"').concat(l, ">").concat(t, "</a>")
            }
            )).join(n)
        }
        function m(t, e) {
            var n = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : "default"
              , r = arguments.length > 3 ? arguments[3] : void 0;
            if (!e || !t)
                return e;
            var o = e;
            try {
                var a = o.match(/<[^>]+>/gi) || []
                  , i = new RegExp(a.join("|"),"gi")
                  , c = e.split(i) || []
                  , u = r ? ' data-pos="'.concat(r, '"') : "";
                o = c.reduce((function(t, e, r) {
                    return t + ((e.replaceAll(/[a-zA-Z|']+/g, (function(t) {
                        return '\n        <span class="select-trans" data-tab="'.concat(n, '"').concat(u, ">").concat(t, "</span>\n      ")
                    }
                    )) || "") + (a[r] || ""))
                }
                ), "")
            } catch (t) {}
            return o
        }
        function y(t) {
            var e = t.lang
              , n = (t.text || "").$br("al").replace(/(?:<br\s*\/?>|\r?\n)/gi, " ").replace(/(?:\ud83c[\udf00-\udfff]|\ud83d[\udc00-\ude4f]|\ud83d[\ude80-\udeff]|\uFEFF)/g, "").slice(0, l) || "";
            if (!n)
                return !1;
            var r = {
                "text": n,
                "spokenDialect": e,
                "rate": "0.8"
            }
              , o = JSON.stringify(r).replace(/^"|"$/g, "");
            return "".concat(p, "?S-Param=").concat(encodeURIComponent(o))
        }
        e.b = d
    },
    "336": function(t, e, n) {
        "use strict";
        n(141)
    },
    "349": function(t, e, n) {
        "use strict";
        n.r(e);
        var r = n(104)
          , o = n.n(r)
          , a = (n(151),
        n(13))
          , i = n.n(a)
          , c = n(2)
          , u = n.n(c)
          , s = n(52)
          , l = n.n(s);
        function p(t, e) {
            var n = Object.keys(t);
            if (Object.getOwnPropertySymbols) {
                var r = Object.getOwnPropertySymbols(t);
                e && (r = r.filter((function(e) {
                    return Object.getOwnPropertyDescriptor(t, e).enumerable
                }
                ))),
                n.push.apply(n, r)
            }
            return n
        }
        var f, d = {
            "data": function() {
                return {
                    "className": "view"
                }
            },
            "computed": function(t) {
                for (var e = 1; e < arguments.length; e++) {
                    var n = null != arguments[e] ? arguments[e] : {};
                    e % 2 ? p(Object(n), !0).forEach((function(e) {
                        u()(t, e, n[e])
                    }
                    )) : Object.getOwnPropertyDescriptors ? Object.defineProperties(t, Object.getOwnPropertyDescriptors(n)) : p(Object(n)).forEach((function(e) {
                        Object.defineProperty(t, e, Object.getOwnPropertyDescriptor(n, e))
                    }
                    ))
                }
                return t
            }({}, Object(s.mapState)("common", ["CONFIG"])),
            "created": function() {
                -1 !== this.$route.path.indexOf("writebook") && (this.className = "")
            }
        }, h = d, g = (n(336),
        n(102)), m = Object(g.a)(h, (function() {
            var t = this
              , e = t.$createElement
              , n = t._self._c || e;
            return n("transition", {
                "attrs": {
                    "name": "fade",
                    "mode": "out-in"
                }
            }, [n("div", {
                "staticClass": "page",
                "attrs": {
                    "id": "translateIndex"
                }
            }, [n("router-view", {
                "class": t.className
            })], 1)])
        }
        ), [], !1, null, null, null).exports, y = n(1), v = n(30);
        function b(t, e) {
            var n = Object.keys(t);
            if (Object.getOwnPropertySymbols) {
                var r = Object.getOwnPropertySymbols(t);
                e && (r = r.filter((function(e) {
                    return Object.getOwnPropertyDescriptor(t, e).enumerable
                }
                ))),
                n.push.apply(n, r)
            }
            return n
        }
        function w(t) {
            for (var e = 1; e < arguments.length; e++) {
                var n = null != arguments[e] ? arguments[e] : {};
                e % 2 ? b(Object(n), !0).forEach((function(e) {
                    u()(t, e, n[e])
                }
                )) : Object.getOwnPropertyDescriptors ? Object.defineProperties(t, Object.getOwnPropertyDescriptors(n)) : b(Object(n)).forEach((function(e) {
                    Object.defineProperty(t, e, Object.getOwnPropertyDescriptor(n, e))
                }
                ))
            }
            return t
        }
        var _ = {
            "namespaced": !0,
            "state": {
                "hotWords": [],
                "fillDivShow": !1,
                "loginStatus": !0,
                "showFeedBack": !1,
                "showPromotionPopup": {
                    "show": !1,
                    "type": ""
                },
                "showShareBomb": !1,
                "shareData": null,
                "showLoginDialog": !1,
                "toast": {
                    "show": !1,
                    "text": "",
                    "loading": !1
                },
                "modelToast": {
                    "show": !1,
                    "text": ""
                },
                "setting": !1,
                "promotionIcon": 0,
                "icon_img": "",
                "FrFlag": 0,
                "top": 0,
                "selectionInfo": {
                    "left": 0,
                    "right": 0,
                    "show": !1,
                    "from": "",
                    "to": "",
                    "val": "",
                    "area": ""
                },
                "translateTabUrl": "",
                "showPcDialog": !1,
                "sTop": 0
            },
            "getters": {
                "passport": function(t) {
                    return (t.CONFIG.loginInfo || {}).passportId || ""
                },
                "uaType": function(t) {
                    var e, n = t.CONFIG && t.CONFIG.ua;
                    return e = /Windows/g.test(n) && /Trident/g.test(n) ? "Windows/IE" : /Mac OS/g.test(n) && /QQBrowserLite/.test(n) ? "Mac/QQ" : "other",
                    e
                },
                "isInQB": function(t, e) {
                    var n = t.CONFIG || {}
                      , r = n.qua
                      , o = n.ua;
                    return Boolean(r && !/SogouMSE/i.test(void 0 === o ? "" : o)) || e.isInQBYouth
                },
                "isInQBYouth": function(t) {
                    var e = (t.CONFIG || {}).ua;
                    return /qbyouthfynohead/.test(void 0 === e ? "" : e)
                },
                "qbVersion": function(t) {
                    var e = (t.CONFIG || {}).ua;
                    return ((void 0 === e ? "" : e).match(/MQQBrowser\/(\d+\.\d+(?:\.\d+)?)/i) || [])[1] || ""
                },
                "isSelectTransAble": function(t, e) {
                    var n = e.isInQB
                      , r = e.qbVersion;
                    return n && -1 !== Object(v.a)(r, "13.2")
                }
            },
            "mutations": (f = {},
            u()(f, y.f, (function(t, e) {
                t.isTextTransIndex = e
            }
            )),
            u()(f, y.p, (function(t, e) {
                Object.assign(t, e)
            }
            )),
            u()(f, y.y, (function(t, e) {
                var n = e.uuid
                  , r = e.transError
                  , o = t.CONFIG;
                o.uuid = n || t.CONFIG.uuid,
                o.transError = r || t.CONFIG.transError
            }
            )),
            u()(f, y.b, (function(t, e) {
                t.showFeedBack = e
            }
            )),
            u()(f, y.g, (function(t, e) {
                var n = e.show
                  , r = e.text
                  , o = e.loading;
                t.toast = {
                    "show": n,
                    "text": r,
                    "loading": o
                }
            }
            )),
            f),
            "actions": {
                "postMessage": function(t, e) {
                    if (e && window.parent !== window.self) {
                        var n = Math.max(document.querySelector("#translateIndex").clientHeight, document.documentElement.clientHeight, document.body.clientHeight)
                          , r = w(w({}, e), {}, {
                            "type": "SOGOU_INPUT_TAB",
                            "iframeH": n
                        });
                        window.parent.postMessage(r, "*")
                    }
                },
                "stopBodyScroll": function(t, e) {
                    var n = t.state
                      , r = document.querySelector("#translateIndex").style;
                    e ? (n.top = Math.max(document.documentElement.scrollTop, document.body.scrollTop),
                    r.position = "fixed",
                    r.top = "".concat(-n.top, "px")) : (r.position = "",
                    r.top = "",
                    window.scrollTo(0, n.top))
                },
                "updateConfig": function(t, e) {
                    var n = t.commit
                      , r = e.uuid
                      , o = e.ssrSwitch
                      , a = e.transError;
                    n(y.y, {
                        "uuid": r,
                        "ssrSwitch": o,
                        "transError": a
                    })
                }
            }
        }
          , S = n(142);
        function A(t, e) {
            var n = Object.keys(t);
            if (Object.getOwnPropertySymbols) {
                var r = Object.getOwnPropertySymbols(t);
                e && (r = r.filter((function(e) {
                    return Object.getOwnPropertyDescriptor(t, e).enumerable
                }
                ))),
                n.push.apply(n, r)
            }
            return n
        }
        function O(t) {
            for (var e = 1; e < arguments.length; e++) {
                var n = null != arguments[e] ? arguments[e] : {};
                e % 2 ? A(Object(n), !0).forEach((function(e) {
                    u()(t, e, n[e])
                }
                )) : Object.getOwnPropertyDescriptors ? Object.defineProperties(t, Object.getOwnPropertyDescriptors(n)) : A(Object(n)).forEach((function(e) {
                    Object.defineProperty(t, e, Object.getOwnPropertyDescriptor(n, e))
                }
                ))
            }
            return t
        }
        n.n(S)()();
        var E = {
            "usa": "美",
            "uk": "英"
        };
        function x(t, e, n) {
            t.map((function(t) {
                return O(O({}, t), {}, {
                    "filename": t.filename ? t.filename : e
                })
            }
            )).forEach((function(t, e) {
                var r = t.type
                  , o = t.text
                  , a = t.filename;
                e < 2 && o && a && n.push({
                    "type": "".concat(r, "_").concat(e),
                    "play": !0,
                    "show": !0,
                    "active": !1,
                    "phonetic": (o || "").replace(/(?:\/|／)/g, ""),
                    "abbr": E[r] || "",
                    "src": a
                })
            }
            ))
        }
        function T(t, e) {
            t && "function" == typeof e && e()
        }
        var k, I, C = {
            "namespaced": !0,
            "state": {
                "from": {
                    "show": !1
                },
                "to": {
                    "show": !1
                }
            },
            "getters": {
                "vfrom": function(t) {
                    return t.from
                },
                "vto": function(t) {
                    return t.to
                },
                "getTTSVoice": function() {
                    return function(t, e) {
                        return Object(v.c)({
                            "lang": e,
                            "text": t
                        })
                    }
                }
            },
            "mutations": u()({}, y.F, (function(t, e) {
                var n = e.from
                  , r = e.to;
                t.from = n,
                t.to = r
            }
            )),
            "actions": {
                "toggleAllVoice": function(t, e) {
                    var n = t.commit
                      , r = t.state
                      , o = e.show
                      , a = {
                        "from": r.from,
                        "to": r.to
                    };
                    ["from", "to"].forEach((function(t) {
                        a[t] = {
                            "show": !!o
                        }
                    }
                    )),
                    n(y.F, a)
                },
                "updateVoice": function(t, e) {
                    var n = t.state
                      , r = t.commit
                      , o = t.rootState
                      , a = t.rootGetters
                      , i = e.translateData
                      , c = o.language
                      , u = c.detect
                      , s = c.to
                      , l = o.language.from;
                    l = "auto" === l ? u : l;
                    var p = o.textTranslate
                      , f = p.query
                      , d = p.result
                      , h = i.voice
                      , g = void 0 === h ? {} : h
                      , m = Array.isArray(g.phonetic) ? g.phonetic : []
                      , b = Array.isArray(g.phonetic_add) ? g.phonetic_add : []
                      , w = i.translate
                      , _ = void 0 === w ? {} : w
                      , S = _.phoneticForzh2en ? _.phoneticForzh2en : {}
                      , A = {
                        "from": n.from,
                        "to": n.to
                    }
                      , O = []
                      , E = []
                      , k = [];
                    ["from", "to"].forEach((function(t) {
                        var e = {}
                          , n = "from" === t ? l : s
                          , r = "from" === t ? f : d
                          , o = !!a["language/getItem"](n).play
                          , i = Object(v.c)({
                            "lang": n,
                            "text": r
                        });
                        k.push(i);
                        var c = "en" === n ? n : "other";
                        e.lang = "zh-CHS" === n ? "zh" : c,
                        e.type = t,
                        e.show = i && o,
                        e.play = o,
                        e.src = i,
                        A[t] = e
                    }
                    )),
                    m.length ? x("zh" === A.from.lang ? m.slice(0, 1) : m, k[0], O) : b.length && x(b, k[0], O),
                    T(!O.length && a["language/getItem"](l).play && k[0], (function() {
                        O.push({
                            "play": !0,
                            "show": !0,
                            "active": !1,
                            "src": k[0]
                        })
                    }
                    )),
                    T(Object.keys(S).length, (function() {
                        var t = [];
                        ["uk", "usa"].forEach((function(e) {
                            var n = S[e];
                            n && t.push({
                                "filename": n.source,
                                "text": n.phonetic,
                                "type": e
                            })
                        }
                        )),
                        x(t, k[1], E)
                    }
                    )),
                    T(!E.length && a["language/getItem"](s).play && k[1], (function() {
                        E.push({
                            "play": !0,
                            "show": !0,
                            "active": !1,
                            "src": k[1]
                        })
                    }
                    ));
                    var I = b.length ? b : []
                      , C = m.length ? m : I
                      , D = {};
                    C = C.reduce((function(t, e) {
                        return !D[e.text] && (D[e.text] = t.push(e)),
                        t
                    }
                    ), []),
                    O.length && (A.from.list = O,
                    A.from.phoneticShow = C && C.length ? C : O,
                    A.from.show = !0),
                    E.length && (A.to.list = E,
                    A.to.phoneticShow = C,
                    A.to.show = !0),
                    r(y.F, A)
                }
            }
        }, D = n(72), j = n.n(D), P = {
            "getItem": function() {
                return function(t) {
                    if ("auto" === t)
                        return j.a.auto;
                    var e = j.a.LI
                      , n = Object.values(e)
                      , r = [];
                    n.forEach((function(t) {
                        Array.isArray(t) ? r = r.concat(t) : r.push(t)
                    }
                    ));
                    var o = r.map((function(t) {
                        return t.lang
                    }
                    ))
                      , a = o.indexOf(t);
                    return a > -1 ? r[a] : "zh-CHT" === t ? (a = o.indexOf("zh-CHS")) > -1 ? r[a] : {} : (a = o.indexOf("en")) > -1 ? r[a] : {}
                }
            },
            "fromItem": function(t, e) {
                return e.getItem(t.from)
            },
            "toItem": function(t, e) {
                return e.getItem(t.to)
            },
            "autoItem": function(t, e) {
                return e.getItem(t.detect)
            },
            "detectText": function(t, e) {
                return e.getItem(t.detect).text
            },
            "direction": function(t) {
                var e, n = t.from, r = t.to;
                switch (n = "auto" === n ? t.detect : n,
                "".concat(n).concat(r)) {
                case "autozh-CHS":
                    e = "autotoz";
                    break;
                case "autoen":
                    e = "autotoe";
                    break;
                case "zh-CHSen":
                    e = "ztoe";
                    break;
                case "enzh-CHS":
                    e = "etoz";
                    break;
                case "zh-CHSja":
                    e = "ztoj";
                    break;
                case "jazh-CHS":
                    e = "jtoz";
                    break;
                case "kozh-CHS":
                    e = "ktoz";
                    break;
                case "zh-CHSko":
                    e = "ztok";
                    break;
                default:
                    e = "other"
                }
                return e
            },
            "modelAble": function(t, e) {
                return "autotoz" === e.direction || "autotoe" === e.direction || "ztoe" === e.direction || "etoz" === e.direction
            },
            "changeAble": function(t) {
                return "auto" !== t.from || "auto" !== t.detect
            }
        }, N = (k = {},
        u()(k, y.r, (function(t, e) {
            var n = e.from
              , r = e.to
              , o = e.detect;
            n && (t.from = n),
            r && (t.to = r),
            o && (t.detect = o)
        }
        )),
        u()(k, y.a, (function(t, e) {
            t.detectShow = e
        }
        )),
        u()(k, y.s, (function(t, e) {
            t.langMap = e
        }
        )),
        u()(k, y.c, (function(t, e) {
            var n = e.show
              , r = e.type;
            t.langMap.show = n,
            t.langMap.type = r
        }
        )),
        u()(k, y.i, (function(t, e) {
            t.showTransModelPopup = e
        }
        )),
        u()(k, y.E, (function(t, e) {
            t.transModel = e
        }
        )),
        k), R = {
            "namespaced": !0,
            "state": {
                "from": "auto",
                "to": "zh-CHS",
                "detect": "auto",
                "detectShow": !1,
                "langMap": {
                    "show": !1,
                    "current": "",
                    "type": ""
                },
                "transModel": {
                    "text": "通用领域",
                    "textSimple": "通用",
                    "val": "general"
                },
                "showTransModelPopup": !1
            },
            "getters": P,
            "mutations": N,
            "actions": {
                "updateLanguageList": function(t, e) {
                    var n = t.state
                      , r = t.commit
                      , o = t.getters
                      , a = e.type;
                    this.LANG_MAP = this.LANG_MAP || j.a;
                    var i, c = this.LANG_MAP, u = c["".concat(a, "CY")], s = n[a], l = u.splice(0, u.length - 2), p = u.splice(u.length - 2, 2), f = !1;
                    l.forEach((function(t) {
                        t.lang === s && (f = !0)
                    }
                    )),
                    p && p[0] && p[0].lang !== s && "auto" !== s && !f && (i = o.getItem(s),
                    p.unshift(i)),
                    c["".concat(a, "CY")] = l.concat(p.splice(0, 2)),
                    c.show = !0,
                    c.current = s,
                    c.type = a,
                    r(y.s, c)
                },
                "exchangeLanguage": function(t) {
                    var e = t.state
                      , n = t.getters
                      , r = t.commit;
                    if (!n.changeAble)
                        return !1;
                    r(y.r, {
                        "from": e.to,
                        "to": "auto" === e.from ? e.detect : e.from
                    })
                },
                "changeLanguage": function(t, e) {
                    var n, r, o = t.state, a = t.commit, i = e.type, c = e.lang, u = o.from, s = o.to;
                    "from" === i ? (n = c,
                    r = c === s ? "auto" === u ? "zh-CHS" === c ? "en" : "zh-CHS" : u : s) : "to" === i && (n = c === u ? s : u,
                    r = c),
                    a(y.r, {
                        "from": n,
                        "to": r
                    })
                },
                "updateLanguage": function(t, e) {
                    var n, r, o = t.state, a = t.commit, i = e.isNotMatch, c = e.isAutoMatch, u = e.detect, s = o.from, l = o.to;
                    "auto" === s && u === l && (r = "zh-CHS" === u ? "en" : "zh-CHS",
                    n = "auto" === s ? "auto" : u),
                    a(y.a, !!i),
                    c && (n = u,
                    r = "zh-CHS" === u ? "en" : "zh-CHS"),
                    a(y.r, {
                        "from": n,
                        "to": r,
                        "detect": u
                    })
                }
            }
        }, z = n(71), B = n.n(z), L = n(51), q = n.n(L), G = n(33), M = n.n(G), U = n(58), F = n.n(U), H = n(105), K = n.n(H), V = n(44), W = n.n(V), Y = n(19), $ = new RegExp("^(?:(?:http|https|ftp)://)?(?:(?:[\\w-]+\\.)+(?:com|edu|gov|int|mil|net|org|biz|info|pro|name|museum|coop|aero|xxx|idv|al|dz|af|ar|ae|aw|om|az|eg|et|ie|ee|ad|ao|ai|ag|at|au|mo|bb|pg|bs|pk|py|ps|bh|pa|br|by|bm|bg|mp|bj|be|is|pr|ba|pl|bo|bz|bw|bt|bf|bi|bv|kp|gq|dk|de|tl|tp|tg|dm|do|ru|ec|er|fr|fo|pf|gf|tf|va|ph|fj|fi|cv|fk|gm|cg|cd|co|cr|gg|gd|gl|ge|cu|gp|gu|gy|kz|ht|kr|nl|an|hm|hn|ki|dj|kg|gn|gw|ca|gh|ga|kh|cz|zw|cm|qa|ky|km|ci|kw|cc|hr|ke|ck|lv|ls|la|lb|lt|lr|ly|li|re|lu|rw|ro|mg|im|mv|mt|mw|my|ml|mk|mh|mq|yt|mu|mr|us|um|as|vi|mn|ms|bd|pe|fm|mm|md|ma|mc|mz|mx|nr|np|ni|ne|ng|nu|no|nf|na|za|zq|aq|gs|eu|pw|pn|pt|jp|se|ch|sv|ws|yu|sl|sn|cy|sc|sa|cx|st|sh|kn|lc|sm|pm|vc|lk|sk|si|sj|sz|sd|sr|sb|so|tj|tw|th|tz|to|tc|tt|tn|tv|tr|tm|tk|wf|vu|gt|ve|bn|ug|ua|uy|uz|es|eh|gr|hk|sg|nc|nz|hu|sy|jm|am|ac|ye|iq|ir|il|it|in|id|uk|vg|io|jo|vn|zm|je|td|gi|cl|cf|cn|fun|online|store|tech|vip|wang|top|wiki|pub|live|me|mobi))(:\\d+)?(/[^\\s]*)?$","i");
        function Q(t) {
            var e = !!t && t.match(/[\u4E00-\u9FFF]+/g);
            return !!e && e.join("") || ""
        }
        function X(t, e) {
            var n = Q(t)
              , r = Q(e)
              , o = "";
            if (n && n.length <= 8)
                o = n;
            else if (r && r.length <= 8)
                o = r;
            else {
                var a = Math.floor(Y.AD_WORD.length * Math.random());
                o = Y.AD_WORD[a]
            }
            return o
        }
        function J(t) {
            var e = t.errorCode
              , n = t.isSSR
              , r = t.query
              , o = t.uuid;
            if ("10" === e || "s10" === e) {
                if (n)
                    return {
                        "type": "transreq",
                        "stype": "hitReload",
                        "errorCode": e,
                        "isSSR": n
                    };
                var a = M.a.parse().query;
                a.keyword = r,
                a.errcode = e,
                window.location.href = "".concat(window.location.origin, "?").concat(M.a.stringify(a))
            } else if ("20" === e) {
                if (n)
                    return {
                        "type": "transreq",
                        "stype": "hitAnti",
                        "errorCode": e,
                        "isSSR": n
                    };
                window.location.href = "https://m.sogou.com/antispider?product=product&from=".concat(window.encodeURIComponent(window.location.href), "&m=1&suuid=").concat(o, "&antip=fanyi")
            }
        }
        var Z = {
            "namespaced": !0,
            "state": function() {
                return {
                    "query": "",
                    "adTitle": "",
                    "translateData": "",
                    "result": "",
                    "isZhEntering": !1,
                    "tabSelect": "",
                    "dictionaryType": "",
                    "ServerUIGS": {},
                    "ServerModelUIGS": {},
                    "ServerSgtkn": "",
                    "showTranslateRecordDialog": !1,
                    "suggestion": "",
                    "suggDirection": "",
                    "showWordAffixPopup": !1,
                    "affixSensInfo": "",
                    "loading": !1,
                    "kanaTips": {
                        "show": !1,
                        "left": "",
                        "top": "",
                        "type": "",
                        "arrowLeft": ""
                    },
                    "isFloatView": !1
                }
            },
            "mutations": (I = {},
            u()(I, y.D, (function(t, e) {
                Object.assign(t, e)
            }
            )),
            u()(I, y.u, (function(t, e) {
                t.query = (e || "").replace(/(?:\ud83c[\udffb-\udfff]|\ud83d[\udefb-\udeff]|\uFEFF)/g, "").replace(/^related:http/, "http").replace(/\r\n?/g, "\n").slice(0, Y.MAX_TRANSLATE_LEN)
            }
            )),
            u()(I, y.B, (function(t, e) {
                var n = e.sugg
                  , r = e.dir;
                n = Array.isArray(n) && n.length ? n.filter((function(t, e) {
                    return e < Y.MAX_SUGGESTION_NUM
                }
                )) : "",
                t.suggestion = n,
                t.suggDirection = r
            }
            )),
            u()(I, y.C, (function(t, e) {
                t.translateData = e
            }
            )),
            u()(I, y.x, (function(t, e) {
                t.result = e || ""
            }
            )),
            u()(I, y.e, (function(t, e) {
                t.tabSelect = e
            }
            )),
            u()(I, y.h, (function(t, e) {
                t.showTranslateRecordDialog = !!e
            }
            )),
            u()(I, y.z, (function(t, e) {
                t.ServerSgtkn = e
            }
            )),
            u()(I, y.k, (function(t, e) {
                t.adTitle = e
            }
            )),
            u()(I, y.A, (function(t, e) {
                var n = e.obj
                  , r = e.modelobj;
                t.ServerUIGS = n,
                t.ServerModelUIGS = r
            }
            )),
            u()(I, y.j, (function(t, e) {
                t.showWordAffixPopup = e
            }
            )),
            u()(I, y.l, (function(t, e) {
                t.affixSensInfo = e
            }
            )),
            u()(I, y.d, (function(t, e) {
                t.loading = e
            }
            )),
            u()(I, y.q, (function(t, e) {
                t.kanaTips = Object.assign(t.kanaTips, e)
            }
            )),
            u()(I, y.n, (function(t, e) {
                t.isFloatView = e
            }
            )),
            I),
            "actions": {
                "translateAction": function(t, e) {
                    return B()(q.a.mark((function n() {
                        var r, o, a, i, c, u, s, l, p, f, d, h, g, m, b, w, _, S, A, O, E, x, T, k, I, C, D, j, P, N, R, z, B, L, G, M, U, H, V, Q, Z, tt, et, nt, rt, ot, at;
                        return q.a.wrap((function(n) {
                            for (; ; )
                                switch (n.prev = n.next) {
                                case 0:
                                    if (r = t.commit,
                                    o = t.dispatch,
                                    a = t.rootState,
                                    i = t.rootGetters,
                                    c = e.route,
                                    u = e.$params,
                                    s = void 0 === u ? {} : u,
                                    l = e.isClient,
                                    p = c.query || {},
                                    f = p.keyword || p.query || "",
                                    d = p.transfrom || p.from || "auto",
                                    h = p.transto || p.to || "zh-CHS",
                                    g = p.fr || "default",
                                    m = p.model || "general",
                                    b = p.needQc || 1,
                                    w = 0,
                                    _ = !1 === l,
                                    S = p.tab || "",
                                    f = f.replace(/\uFEFF/g, "").trim(),
                                    w = f.length,
                                    d = "autodetect" === (d = d.trim()) ? "auto" : d,
                                    h = h.trim(),
                                    A = a.common.CONFIG,
                                    O = i["language/direction"],
                                    E = A.uuid || F.a.get(),
                                    f) {
                                        n.next = 29;
                                        break
                                    }
                                    return r(y.z, ""),
                                    r(y.u, ""),
                                    r(y.C, ""),
                                    r(y.x, ""),
                                    r(y.B, {
                                        "sugg": ""
                                    }),
                                    r("language/".concat(y.a), !1, {
                                        "root": !0
                                    }),
                                    _ && (r("language/".concat(y.r), {
                                        "from": "auto",
                                        "to": "zh-CHS",
                                        "detect": "auto"
                                    }, {
                                        "root": !0
                                    }),
                                    r("language/".concat(y.E), {
                                        "textSimple": "通用",
                                        "text": "通用领域",
                                        "val": "general"
                                    }, {
                                        "root": !0
                                    })),
                                    n.abrupt("return", !1);
                                case 29:
                                    if (!$.test(f)) {
                                        n.next = 35;
                                        break
                                    }
                                    return _ && r(y.u, f),
                                    x = {
                                        "type": "all",
                                        "stype": "url",
                                        "direction": O,
                                        "len": w,
                                        "qtype": "url"
                                    },
                                    r(y.A, {
                                        "obj": x,
                                        "modelobj": {}
                                    }),
                                    r(y.C, {
                                        "translate": {
                                            "queryType": "url",
                                            "dit": f,
                                            "from": d,
                                            "to": h
                                        }
                                    }),
                                    n.abrupt("return", !1);
                                case 35:
                                    return T = Date.now(),
                                    k = A.secretCode || "",
                                    I = K.a.cal("".concat(d).concat(h).concat(f).concat(k)),
                                    C = "browser_wap",
                                    "wap",
                                    "medical" !== m && "finance" !== m || (C += "_".concat(m)),
                                    D = {
                                        "from": d,
                                        "to": h,
                                        "text": f,
                                        "client": "wap",
                                        "fr": C,
                                        "needQc": b,
                                        "s": I,
                                        "uuid": E
                                    },
                                    Object.assign(D, s),
                                    !_ && f && r(y.d, !0),
                                    n.next = 46,
                                    W()({
                                        "method": "post",
                                        "url": "".concat(Y.ORIGIN_CLIENT, "/api/transwap/text/result"),
                                        "data": D
                                    }).catch((function(t) {
                                        o("common/updateConfig", {
                                            "transError": {
                                                "transmsg": t && t.message,
                                                "transtype": "network"
                                            }
                                        }, {
                                            "root": !0
                                        })
                                    }
                                    ));
                                case 46:
                                    if (j = n.sent,
                                    r(y.u, f),
                                    r(y.d, !1),
                                    r(y.k, ""),
                                    _ && (r("language/".concat(y.r), {
                                        "from": d,
                                        "to": h
                                    }, {
                                        "root": !0
                                    }),
                                    P = Y.TRANS_MODEL_LIST.concat([]),
                                    N = {},
                                    P.forEach((function(t) {
                                        t.val === m && (N = t)
                                    }
                                    )),
                                    r("language/".concat(y.E), N, {
                                        "root": !0
                                    })),
                                    (R = j && j.data) && 0 == +R.status && R.data) {
                                        n.next = 57;
                                        break
                                    }
                                    return o("common/updateConfig", {
                                        "transError": {
                                            "transmsg": R ? R.status : -1,
                                            "transtype": "failed"
                                        }
                                    }, {
                                        "root": !0
                                    }),
                                    z = {
                                        "type": "all",
                                        "stype": "failed",
                                        "errcode": R && R.status || null,
                                        "fr": g,
                                        "from": d,
                                        "to": h,
                                        "direction": O,
                                        "len": w,
                                        "qtype": "text",
                                        "uuid": E
                                    },
                                    r(y.A, {
                                        "obj": z,
                                        "modelobj": {}
                                    }),
                                    n.abrupt("return", !1);
                                case 57:
                                    if (B = R.data || {},
                                    L = B.translate || {},
                                    G = L.dit,
                                    M = L.errorCode,
                                    (U = S && B.tabList && B.tabList.length && B.tabList.filter((function(t) {
                                        return t && t.type === S
                                    }
                                    ))) && 0 !== U.length ? r(y.e, S) : (H = B.tabList,
                                    V = void 0 === H ? [] : H,
                                    Q = Array.isArray(V) && V.length && V[0],
                                    r(y.e, (Q || {}).type)),
                                    Z = B.sgtkn || "",
                                    r(y.z, Z),
                                    !_ && v.b.sendApprove(E, Z),
                                    !(tt = J({
                                        "errorCode": M,
                                        "isSSR": _,
                                        "query": f,
                                        "uuid": E
                                    }))) {
                                        n.next = 68;
                                        break
                                    }
                                    return n.abrupt("return", tt);
                                case 68:
                                    return r(y.C, B),
                                    et = B.dictType || "",
                                    r(y.D, {
                                        "dictionaryType": et
                                    }),
                                    r(y.x, G || ""),
                                    _ && (nt = X(f, G)) && r(y.k, nt),
                                    r("language/".concat(y.r), {
                                        "from": d,
                                        "to": h
                                    }, {
                                        "root": !0
                                    }),
                                    rt = B.isNotMatch,
                                    ot = B.isAutoMatch,
                                    at = B.detect,
                                    o("language/updateLanguage", {
                                        "isNotMatch": rt,
                                        "isAutoMatch": ot,
                                        "detect": at.detect
                                    }, {
                                        "root": !0
                                    }),
                                    o("voice/updateVoice", {
                                        "translateData": B
                                    }, {
                                        "root": !0
                                    }),
                                    o("textTranslate/translateLogAction", {
                                        "translateData": B,
                                        "fr": g,
                                        "uuid": E,
                                        "query": f,
                                        "isSSR": _,
                                        "TRANS_START_TIME": T
                                    }, {
                                        "root": !0
                                    }),
                                    n.abrupt("return", B);
                                case 79:
                                case "end":
                                    return n.stop()
                                }
                        }
                        ), n)
                    }
                    )))()
                },
                "translateLogAction": function(t, e) {
                    var n = t.commit
                      , r = t.state
                      , o = t.rootState
                      , a = t.rootGetters
                      , c = e.translateData
                      , u = e.fr
                      , s = e.uuid
                      , l = e.query
                      , p = e.isSSR
                      , f = e.TRANS_START_TIME
                      , d = Date.now()
                      , h = o.language.from
                      , g = o.language.to
                      , m = o.language.transModel.val
                      , b = a["language/direction"]
                      , w = l.length
                      , _ = c || {}
                      , S = _.translate
                      , A = _.detect
                      , O = _.detail
                      , E = _.oxford
                      , x = _.newCentury
                      , T = _.zhongkao
                      , k = _.gaokao
                      , I = _.CET4
                      , C = _.CET6
                      , D = _.kaoyan
                      , j = _.book
                      , P = _.network
                      , N = _.pic
                      , R = _.keywords
                      , z = _.secondQuery;
                    h = "auto" === h || "autodetect" === h ? A && A.detect : h;
                    var B = S && S.qc_type;
                    B = B ? "qc_".concat(B) : "";
                    var L = function(t) {
                        return t ? 1 : 0
                    }
                      , q = E || x
                      , G = (q && q.length && q[0] || {}).usual
                      , M = O && O.bilingual
                      , U = G && G.length && G[0] && ("" !== G[0].pos || G[0].values && "" !== G[0].values[0])
                      , F = Array.isArray(M) && M.length
                      , H = L(U || F || E || x || P)
                      , K = L(Array.isArray(R) && R.length)
                      , V = N && N.expand_data
                      , W = L(O && O.wordCard && O.wordCard.show)
                      , Y = L(1 === W && "en" === h)
                      , $ = L(1 === W && "zh-CHS" === h)
                      , Q = L(1 === W && "en" !== h && "zh-CHS" !== h)
                      , X = L(1 === W && P && P.network_mean)
                      , J = L((r.translateData && r.translateData.wordCard || {}).levelList)
                      , Z = "en" === h && "zh-CHS" === g && v.b.wordStatic(r.query) >= 5
                      , tt = o.common.isQBSideBar
                      , et = {
                        "version": "new",
                        "type": "all",
                        "stype": "success",
                        "terminal": tt ? "qbsidebar" : "wap",
                        "fr": u,
                        "direction": b,
                        "from": h,
                        "to": g,
                        "writing_resultpage": L(Z),
                        "len": w,
                        "qtype": "text",
                        "qctype": B,
                        "dict_cover": H,
                        "detail": L(O),
                        "word_card_cover": W,
                        "word_card_en": Y,
                        "word_card_ch": $,
                        "word_card_minor": Q,
                        "word_card_netmean": X,
                        "word_deform": L(O && O.wordCard && O.wordCard.exchange),
                        "keyword": K,
                        "bilingual": L(F),
                        "simple": L(U),
                        "level_list": J,
                        "synonym": L(O && O.synonym),
                        "antonym": L(O && O.antonym),
                        "conjugate": L(O && O.wordRootInfo),
                        "rootaffix": L(O && O.affix),
                        "baike_sogou": L(O && O.baike),
                        "baike_wiki": L(O && O.wiki),
                        "wordDifference": L(O && O.word_difference_info),
                        "word_phrase": L(O && O.word_group),
                        "second_query": L(z),
                        "dict_oxford": L(E),
                        "dict_newcentury": L(x),
                        "zhongkaotab": L(T),
                        "gaokaotab": L(k),
                        "CET4tab": L(I),
                        "CET6tab": L(C),
                        "kaoyantab": L(D),
                        "network_tab": L(P),
                        "yinying_tab": L(j),
                        "tuozhan_tab": L(N),
                        "one_pic": L(V && V.onePic),
                        "more_pic": L(V && V.morePic),
                        "no_pic": L(V && V.noPic),
                        "uuid": s
                    }
                      , nt = "zh-CHS" === h && "en" === g || "en" === h && "zh-CHS" === g
                      , rt = {
                        "terminal": tt ? "qbsidebar" : "wap",
                        "type": "trans_model",
                        "pbtype": "pv",
                        "model_general": L(nt && "general" === m),
                        "model_medical": L(nt && "medical" === m),
                        "model_finance": L(nt && "finance" === m)
                    };
                    p ? (et.t_trans_ssr = d - (o.common.CONFIG.loadTime || 0),
                    et.from_type = 0,
                    n(y.A, {
                        "obj": et,
                        "modelobj": rt
                    })) : (et.t_trans = d - f,
                    et.from_type = "vs_result" === u ? 2 : 1,
                    i.a.prototype.$uigs.send(et),
                    i.a.prototype.$uigs.send(rt))
                },
                "getSuggestion": function(t) {
                    var e = t.state
                      , n = t.commit
                      , r = t.rootState
                      , o = r.language.from
                      , a = r.language.to
                      , i = e.query
                      , c = r.common.CONFIG.uuid || F.a.get();
                    if (o = "autodetect" === o ? "auto" : o,
                    i.length > Y.MAX_SUGGESTION_QUERY_LEN)
                        return !1;
                    W()({
                        "url": "/reventondc/suggV3",
                        "method": "post",
                        "headers": {
                            "Accept": "application/json"
                        },
                        "data": M.a.params({
                            "from": o,
                            "to": a,
                            "client": "wap",
                            "text": i,
                            "uuid": c,
                            "pid": "sogou-dict-vr",
                            "addSugg": "on"
                        })
                    }).then((function(t) {
                        var e = t && t.data;
                        e && 0 === e.code && e.sugg ? n(y.B, {
                            "sugg": e.sugg,
                            "dir": e.direction
                        }) : n(y.B, {
                            "sugg": "",
                            "dir": e.direction
                        })
                    }
                    )).catch((function() {}
                    ))
                }
            }
        };
        function tt(t) {
            return t.replace(/&nbsp;/gi, " ").replace(/&gt;/gi, ">").replace(/&lt;/gi, "<").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
        }
        function et(t, e, n) {
            var r = -1
              , o = t.replace(/\n/gi, "<br />").replace(/<font color="red"><\/font>/gi, "");
            return o = e ? (o = o.replace(/(<font color="red">)(.*?)(<\/font>)/g, (function(t, o, a) {
                return r += 1,
                '<span class="input-text-word-box" data-id="'.concat(n, "-").concat(r, '"><span class="error data-id="').concat(r, '">').concat(a, '</span> <span class="correct">').concat(e[r].correctWord, "</span></span>")
            }
            ))).replace(/  +/g, (function(t) {
                return t.replace(/ /g, "&nbsp;")
            }
            )) : o.replace(/(<font color="red">)(.*?)(<\/font>)/g, (function(t, e, n) {
                return '<span class="correct">'.concat(n, "</span>")
            }
            ))
        }
        var nt, rt = n(73);
        function ot(t, e) {
            var n = Object.keys(t);
            if (Object.getOwnPropertySymbols) {
                var r = Object.getOwnPropertySymbols(t);
                e && (r = r.filter((function(e) {
                    return Object.getOwnPropertyDescriptor(t, e).enumerable
                }
                ))),
                n.push.apply(n, r)
            }
            return n
        }
        function at(t) {
            for (var e = 1; e < arguments.length; e++) {
                var n = null != arguments[e] ? arguments[e] : {};
                e % 2 ? ot(Object(n), !0).forEach((function(e) {
                    u()(t, e, n[e])
                }
                )) : Object.getOwnPropertyDescriptors ? Object.defineProperties(t, Object.getOwnPropertyDescriptors(n)) : ot(Object(n)).forEach((function(e) {
                    Object.defineProperty(t, e, Object.getOwnPropertyDescriptor(n, e))
                }
                ))
            }
            return t
        }
        var it = n(58)
          , ct = (nt = {},
        u()(nt, y.G, (function(t, e) {
            Object.assign(t, e)
        }
        )),
        u()(nt, y.m, (function(t, e) {
            var n = e.id
              , r = e.key
              , o = e.val;
            t.result[t.currIndex].correctInfo[n][r] = o
        }
        )),
        u()(nt, y.v, (function(t, e) {
            var n = e.key
              , r = e.id
              , o = e.val;
            t[n][r] = o
        }
        )),
        u()(nt, y.t, (function(t, e) {
            var n = e.active
              , r = e.data;
            "number" == typeof n && (t.result[t.currIndex].polishedSents.active = n),
            r && (t.result[t.currIndex].polishedSents.data = r)
        }
        )),
        u()(nt, y.o, (function(t, e) {
            t.firstActive[e] = !0
        }
        )),
        u()(nt, y.w, (function(t, e) {
            t.queryResult = e
        }
        )),
        nt)
          , ut = {
            "namespaced": !0,
            "state": {
                "type": "textarea",
                "query": "",
                "queryResult": [],
                "queryBackUp": "",
                "queryHtmlBackup": {},
                "result": null,
                "state": null,
                "currIndex": 0,
                "wordLength": 0,
                "strLength": 0,
                "correctionNum": 2,
                "popup": !1,
                "articleId": null,
                "originQuery": [],
                "firstActive": [!1, !1]
            },
            "getters": {
                "queryLength": function(t) {
                    return t.query.length
                },
                "errorDetect": function(t) {
                    return t.result && t.result.length || t.state && "waploading" !== t.state
                },
                "visibleCorrectInfo": function(t) {
                    return t.result && t.result[t.currIndex].correctInfo.slice(0, t.correctionNum)
                },
                "btnDisable": function(t) {
                    return "loading" === t.state || "textarea" === t.type && "" === t.query.trim() || "loading" === t.state || "html" === t.type && !t.query.length
                },
                "visiblePolishedSents": function(t) {
                    return t.result && t.result[t.currIndex].polishedSents.data.filter((function(t, e) {
                        return e < 2
                    }
                    )).map((function(t) {
                        return t.replace(/(<br \/>)+$/g, "")
                    }
                    ))
                },
                "curCorrectInfo": function(t) {
                    return t.result && t.result[t.currIndex].correctInfo
                },
                "curPolishedSents": function(t) {
                    return t.result && t.result[t.currIndex].polishedSents
                },
                "curCorrectInfoLength": function(t) {
                    return t.result && t.result[t.currIndex].correctInfo.length
                },
                "curPolishedSentsLength": function(t) {
                    return t.result && t.result[t.currIndex].polishedSents.data.length
                },
                "resultDisabled": function(t) {
                    return "textarea" === t.type && "error" !== t.state && "noEnglish" !== t.state && "offline" !== t.state
                }
            },
            "mutations": ct,
            "actions": {
                "clear": function(t) {
                    (0,
                    t.commit)(y.G, {
                        "query": "",
                        "queryResult": [],
                        "queryBackUp": "",
                        "queryHtmlBackup": {},
                        "type": "textarea",
                        "state": !1,
                        "wordLength": 0,
                        "currIndex": 0,
                        "result": null,
                        "originQuery": []
                    })
                },
                "prefetchWritingData": function(t, e) {
                    return B()(q.a.mark((function n() {
                        var r, o, a, i, c, u, s, l, p, f, d, h, g, m, v, b, w, _, S;
                        return q.a.wrap((function(n) {
                            for (; ; )
                                switch (n.prev = n.next) {
                                case 0:
                                    if (r = t.commit,
                                    o = t.state,
                                    a = t.rootState,
                                    i = t.dispatch,
                                    c = e.route,
                                    u = e.ssr,
                                    s = void 0 === u ? "" : u,
                                    l = e.$uigs,
                                    p = c.query.keyword,
                                    f = p || "") {
                                        n.next = 7;
                                        break
                                    }
                                    return i("clear", {
                                        "commit": r
                                    }),
                                    n.abrupt("return");
                                case 7:
                                    return d = {
                                        "pbtype": "pv",
                                        "stype": "writing_error"
                                    },
                                    h = a.common.CONFIG.uuid || it.get(),
                                    g = a.common.CONFIG.ua,
                                    m = RegExp(/iphone|symbianos|android|windows phone|ipod/),
                                    v = g && g.toLowerCase().match(m),
                                    "",
                                    w = [],
                                    r(y.G, {
                                        "state": v ? "waploading" : "loading",
                                        "currIndex": 0,
                                        "result": null,
                                        "queryHtmlBackup": {},
                                        "type": v ? "html" : ""
                                    }),
                                    f = tt(f = f.replace(/\n+$/, "").replace(/(?:\ud83c[\udf00-\udfff]|\ud83d[\udc00-\ude4f]|\ud83d[\ude80-\udeff]|\uFEFF)/g, "")),
                                    b = f,
                                    _ = "wap",
                                    v && (_ += a.common.isTextTransIndex ? "-index" : "-result"),
                                    S = {
                                        "uuid": h,
                                        "passport": [],
                                        "deviceModel": g,
                                        "osVersion": g,
                                        "os": _,
                                        "language": "en",
                                        "query": f
                                    },
                                    S = JSON.stringify(S).replace(/^"|"$/g, ""),
                                    S = Object(rt.encrypt)(S),
                                    n.next = 25,
                                    W()({
                                        "method": "POST",
                                        "url": "".concat(Y.ORIGIN_CLIENT, "/api/transwap/writing/result"),
                                        "data": {
                                            "jsonData": S
                                        }
                                    }).then((function(t) {
                                        var e = t.data;
                                        if (e && "success" === e.message && 0 === e.code) {
                                            var n = e.data
                                              , a = [];
                                            n = Object(rt.decrypt)(n);
                                            var i = !0;
                                            if (n = n.map((function(t, e) {
                                                var n = t.correctInfo
                                                  , r = t.polishedSents
                                                  , o = at({}, t);
                                                a.push('<span class="num">'.concat(e + 1, "</span>").concat(tt(et(o.markedQuery, o.correctInfo, e)))),
                                                w.push(o.markedQuery.replace(/(<font color="red">)|(<\/font>)/g, ""));
                                                var c = r.map((function(t) {
                                                    return et(t)
                                                }
                                                ));
                                                return o.polishedSents = {
                                                    "active": -1,
                                                    "data": c.filter((function(t) {
                                                        return "" !== t.replace(/(<br \/>)+$/g, "")
                                                    }
                                                    ))
                                                },
                                                o.correctInfo = n.map((function(t) {
                                                    var e = t.correctWord
                                                      , n = t.origWord
                                                      , r = t.errorWriting;
                                                    return at(at({}, t), {}, {
                                                        "correctWord": tt(e),
                                                        "origWord": tt(n),
                                                        "errorWriting": tt(r),
                                                        "active": !0
                                                    })
                                                }
                                                )),
                                                (n.length || r.length) && (i = !1),
                                                o
                                            }
                                            )),
                                            v && !o.state)
                                                return;
                                            r(y.G, {
                                                "type": "html",
                                                "query": a,
                                                "result": n,
                                                "queryBackUp": b,
                                                "state": !!i && "noError",
                                                "articleId": n[0].articleId,
                                                "originQuery": w
                                            }),
                                            r(y.w, a),
                                            d = {
                                                "pbtype": "pv",
                                                "stype": "writing_succ"
                                            }
                                        } else
                                            r(y.w, []),
                                            r(y.G, {
                                                "state": "error",
                                                "type": "textarea"
                                            })
                                    }
                                    )).catch((function() {
                                        r(y.G, {
                                            "state": "error",
                                            "type": "textarea"
                                        })
                                    }
                                    ));
                                case 25:
                                    s || l.send(d);
                                case 26:
                                case "end":
                                    return n.stop()
                                }
                        }
                        ), n)
                    }
                    )))()
                }
            }
        };
        function st(t, e) {
            var n = Object.keys(t);
            if (Object.getOwnPropertySymbols) {
                var r = Object.getOwnPropertySymbols(t);
                e && (r = r.filter((function(e) {
                    return Object.getOwnPropertyDescriptor(t, e).enumerable
                }
                ))),
                n.push.apply(n, r)
            }
            return n
        }
        function lt(t) {
            var e = t.config
              , n = t.channel
              , r = void 0 === n ? {} : n;
            return Object.assign(_.state, function(t) {
                for (var e = 1; e < arguments.length; e++) {
                    var n = null != arguments[e] ? arguments[e] : {};
                    e % 2 ? st(Object(n), !0).forEach((function(e) {
                        u()(t, e, n[e])
                    }
                    )) : Object.getOwnPropertyDescriptors ? Object.defineProperties(t, Object.getOwnPropertyDescriptors(n)) : st(Object(n)).forEach((function(e) {
                        Object.defineProperty(t, e, Object.getOwnPropertyDescriptor(n, e))
                    }
                    ))
                }
                return t
            }({
                "CONFIG": e || {}
            }, r)),
            new l.a.Store({
                "modules": {
                    "common": _,
                    "voice": C,
                    "language": R,
                    "textTranslate": Z,
                    "writing": ut
                }
            })
        }
        i.a.use(l.a);
        var pt = n(57)
          , ft = n.n(pt);
        i.a.use(ft.a);
        var dt = ft.a.prototype.push;
        ft.a.prototype.push = function(t) {
            return dt.call(this, t).catch((function(t) {
                return t
            }
            ))
        }
        ;
        var ht = n(145);
        var gt = n(106)
          , mt = n.n(gt);
        n(348).polyfill(),
        i.a.prototype.$uigs = new mt.a({
            "uigs_productid": "vs_web",
            "vstype": "translate"
        }),
        i.a.prototype.$http = W.a.create(),
        i.a.prototype.$navTo = function(t) {
            var e = this.$store || {}
              , n = e.state || {}
              , r = t.query
              , a = r.keyword || ""
              , c = M.a.parse().query || {};
            if (r.fr && "vs_result" === r.fr && i.a.prototype.$uigs.send({
                "pbtype": "pv",
                "version": "new",
                "type": "all",
                "stype": "success",
                "from_type": 2
            }),
            n.common.isSogouSearchApp && "object" === o()(window.JSInvoker) && "function" == typeof window.JSInvoker.openTranslateResult) {
                var u = n.route.query
                  , s = u.transto || u.to || "zh-CHS";
                window.JSInvoker.openTranslateResult(a, s, 2)
            } else
                window.scrollTo(0, 0),
                e.dispatch("common/postMessage", {
                    "query": a
                }),
                this.$router.push({
                    "query": Object.assign(c, r)
                })
        }
        ,
        i.a.mixin({
            "beforeRouteUpdate": function(t, e, n) {
                var r = this.$options.asyncData;
                r ? r({
                    "store": this.$store,
                    "route": t,
                    "isClient": !0
                }).then((function() {
                    n(!0)
                }
                )).catch(n) : n()
            }
        });
        var yt, vt, bt, wt = (vt = lt({
            "config": (yt = {}).config,
            "channel": yt.channel
        }),
        bt = new ft.a({
            "mode": "history",
            "fallback": !1,
            "routes": [{
                "path": "/",
                "redirect": "/text",
                "name": "translate",
                "component": function() {
                    return n.e(15).then(n.bind(null, 459))
                },
                "children": [{
                    "path": "/text",
                    "name": "text",
                    "meta": {
                        "mtype": ["textTranslate", "language", "voice", "writing"]
                    },
                    "component": function() {
                        return n.e(27).then(n.bind(null, 457))
                    }
                }, {
                    "path": "/writing",
                    "name": "writing",
                    "meta": {
                        "mtype": ["writing"]
                    },
                    "component": function() {
                        return n.e(30).then(n.bind(null, 458))
                    }
                }]
            }, {
                "title": "用户手册",
                "path": "/app/userAgreement",
                "name": "userAgreement",
                "meta": {
                    "mtype": []
                },
                "component": function() {
                    return n.e(5).then(n.bind(null, 460))
                }
            }, {
                "title": "个人隐私",
                "path": "/app/privacyPolicy",
                "name": "privacyPolicy",
                "meta": {
                    "mtype": []
                },
                "component": function() {
                    return n.e(18).then(n.bind(null, 461))
                }
            }, {
                "title": "第三方SDK目录",
                "path": "/app/privacySDK",
                "name": "privacySDK",
                "meta": {
                    "mtype": []
                },
                "component": function() {
                    return n.e(19).then(n.bind(null, 462))
                }
            }, {
                "title": "第三方共享信息清单",
                "path": "/app/privacyShare",
                "name": "privacyshare",
                "meta": {
                    "mtype": []
                },
                "component": function() {
                    return n.e(20).then(n.bind(null, 463))
                }
            }, {
                "title": "个人信息收集清单",
                "path": "/app/inforCollectList",
                "name": "inforcollectlist",
                "meta": {
                    "mtype": []
                },
                "component": function() {
                    return n.e(16).then(n.bind(null, 464))
                }
            }, {
                "title": "隐私政策",
                "path": "/app/privacyNew",
                "name": "privacynew",
                "meta": {
                    "mtype": []
                },
                "component": function() {
                    return n.e(21).then(n.bind(null, 465))
                }
            }, {
                "title": "隐私政策简明版",
                "path": "/app/privacyNewSimple",
                "name": "privacynewsimple",
                "meta": {
                    "mtype": []
                },
                "component": function() {
                    return n.e(22).then(n.bind(null, 466))
                }
            }, {
                "title": "权限说明",
                "path": "/app/authority",
                "name": "authority",
                "meta": {
                    "mtype": []
                },
                "component": function() {
                    return n.e(8).then(n.bind(null, 467))
                }
            }, {
                "title": "权限说明安卓系统",
                "path": "/app/authorityAndroid",
                "name": "authorityAndroid",
                "meta": {
                    "mtype": []
                },
                "component": function() {
                    return n.e(9).then(n.bind(null, 468))
                }
            }, {
                "title": "权限说明IOS系统",
                "path": "/app/authorityIos",
                "name": "authorityIOS",
                "meta": {
                    "mtype": []
                },
                "component": function() {
                    return n.e(10).then(n.bind(null, 469))
                }
            }, {
                "path": "/app/explain/desc",
                "title": "使用说明",
                "name": "explain",
                "component": function() {
                    return n.e(7).then(n.bind(null, 470))
                }
            }, {
                "path": "/qbyouth/explain/desc",
                "title": "使用说明",
                "name": "qbyouthexplain",
                "component": function() {
                    return n.e(25).then(n.bind(null, 471))
                }
            }, {
                "path": "/qb/explain/desc",
                "title": "使用说明",
                "name": "qbexplain",
                "component": function() {
                    return n.e(24).then(n.bind(null, 472))
                }
            }, {
                "path": "/app/explain/pc",
                "title": "pc文档翻译",
                "name": "pc",
                "component": function() {
                    return n.e(13).then(n.bind(null, 473))
                }
            }, {
                "path": "/app/explain/app",
                "title": "跳App文档翻译",
                "name": "app",
                "component": function() {
                    return n.e(12).then(n.bind(null, 474))
                }
            }, {
                "path": "/app/quickapp/faq",
                "title": "跳App文档翻译",
                "name": "quickapp",
                "component": function() {
                    return n.e(26).then(n.bind(null, 475))
                }
            }, {
                "title": "feed流",
                "path": "/feedId/:feedid",
                "meta": {
                    "mtype": []
                },
                "component": function() {
                    return n.e(14).then(n.bind(null, 448))
                }
            }, {
                "props": !0,
                "path": "/download/wap/:stype",
                "meta": {
                    "mtype": []
                },
                "component": function() {
                    return n.e(29).then(n.bind(null, 476))
                }
            }, {
                "title": "书影音",
                "path": "/bookPage",
                "name": "bookPage",
                "meta": {
                    "mtype": []
                },
                "component": function() {
                    return n.e(11).then(n.bind(null, 477))
                }
            }, {
                "path": "*",
                "redirect": "/"
            }]
        }),
        Object(ht.sync)(vt, bt),
        {
            "app": new i.a({
                "router": bt,
                "store": vt,
                "render": function(t) {
                    return t(m)
                }
            }),
            "router": bt,
            "store": vt
        }), _t = wt.app, St = wt.router, At = wt.store;
        window.__INITIAL_STATE__ && At.replaceState(window.__INITIAL_STATE__),
        St.onReady((function() {
            St.beforeResolve((function(t, e, n) {
                if (1 === t.query.isclient)
                    return n();
                var r = St.getMatchedComponents(t)
                  , o = St.getMatchedComponents(e)
                  , a = !1
                  , i = r.filter((function(t, e) {
                    return a || (a = o[e] !== t)
                }
                )).map((function(t) {
                    return t.asyncData
                }
                )).filter((function(t) {
                    return t
                }
                ));
                if (!i.length)
                    return n();
                Promise.all(i.map((function(e) {
                    return e({
                        "store": At,
                        "route": t
                    })
                }
                ))).then((function() {
                    n()
                }
                )).catch(n)
            }
            )),
            _t.$mount("#app")
        }
        ))
    },
    "44": function(t, e) {
        t.exports = window.Axios
    },
    "52": function(t, e) {
        t.exports = window.Vuex
    },
    "57": function(t, e) {
        t.exports = window.VueRouter
    },
    "73": function(t, e, n) {
        var r = n(147)
          , o = n(342)
          , a = {
            "encryptKey": r.enc.Utf8.parse("7c2e52d43aad8720315ab624b9c9fa0f"),
            "decryptKey": r.enc.Utf8.parse("cf8d51685b1374cb22329bbf0af3905a"),
            "encryptOther": {
                "iv": r.enc.Utf8.parse(o("AAAAAAAAAAAAAAAAAAAAAA==") || "7c2e52d43aad8720315ab624b9c9fa0f"),
                "mode": r.mode.CBC,
                "pad": r.pad.Pkcs7
            },
            "decryptOther": {
                "iv": r.enc.Utf8.parse(o("AAAAAAAAAAAAAAAAAAAAAA==") || "cf8d51685b1374cb22329bbf0af3905a"),
                "mode": r.mode.CBC,
                "pad": r.pad.Pkcs7
            },
            "encryptKeyVoice": r.enc.Utf8.parse("76350b1840ff9832eb6244ac6d444366"),
            "encryptOtherVoice": {
                "iv": r.enc.Utf8.parse(o("AAAAAAAAAAAAAAAAAAAAAA==") || "76350b1840ff9832eb6244ac6d444366"),
                "mode": r.mode.CBC,
                "pad": r.pad.Pkcs7
            }
        };
        t.exports = {
            "encrypt": function(t) {
                return r.AES.encrypt(t, a.encryptKey, a.encryptOther).toString()
            },
            "decrypt": function(t, e) {
                var n = null;
                try {
                    n = r.enc.Utf8.stringify(r.AES.decrypt(decodeURIComponent(t), a.decryptKey, a.decryptOther) || ""),
                    e || (n = JSON.parse(n))
                } catch (t) {}
                return n
            },
            "encryptVoice": function(t) {
                return r.AES.encrypt(t, a.encryptKeyVoice, a.encryptOtherVoice).toString()
            },
            "escapeStr": function(t) {
                return t.replace(/&nbsp;/gi, " ").replace(/&gt;/gi, ">").replace(/&lt;/gi, "<").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
            },
            "getStr": function(t) {
                var e = t;
                return "string" != typeof t && (e = t.join("")),
                e = e.replace(/<span class="num(.*?)<\/span>/gi, "").replace(/<span class="error(.*?)<\/span>\s{0,1}/gi, "").replace(/(<br([\s\S])*?>)|(<div\s*\/?>)/gi, "\n").replace(/<\/{0,1}(div|p|span)[^>]*>/gi, ""),
                this.escapeStr(e)
            }
        }
    }
});

// console.log(heng)




function get_s(data){
    var d = 'auto';
    var h = 'zh-CHS';
    var k = 109984457;
    H = heng(105);
    K = heng.n(H);
    return K.a.cal("".concat(d).concat(h).concat(data).concat(k)).toString()
}

data = 'open'

console.log(get_s(data))