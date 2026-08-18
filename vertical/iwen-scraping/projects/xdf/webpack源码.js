(window.webpackJsonp_N_E = window.webpackJsonp_N_E || []).push([[6], {
    "/0+H": function(e, t, n) {
        "use strict";
        t.__esModule = !0,
        t.isInAmpMode = i,
        t.useAmp = function() {
            return i(o.default.useContext(a.AmpStateContext))
        }
        ;
        var r, o = (r = n("q1tI")) && r.__esModule ? r : {
            default: r
        }, a = n("lwAK");
        function i() {
            var e = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : {}
              , t = e.ampFirst
              , n = void 0 !== t && t
              , r = e.hybrid
              , o = void 0 !== r && r
              , a = e.hasQuery
              , i = void 0 !== a && a;
            return n || o && i
        }
    },
    "20a2": function(e, t, n) {
        e.exports = n("nOHt")
    },
    "48fX": function(e, t, n) {
        var r = n("qhzo");
        e.exports = function(e, t) {
            if ("function" !== typeof t && null !== t)
                throw new TypeError("Super expression must either be null or a function");
            e.prototype = Object.create(t && t.prototype, {
                constructor: {
                    value: e,
                    writable: !0,
                    configurable: !0
                }
            }),
            t && r(e, t)
        }
    },
    "5M6V": function(e, t, n) {
        "use strict";
        var r = n("nKUr")
          , o = n("cpVT")
          , a = n("vJKn")
          , i = n.n(a)
          , c = n("rg98")
          , s = n("q1tI")
          , u = n("g4pe")
          , d = n.n(u)
          , f = n("qjqm")
          , l = n("DTmv")
          , p = function() {
            var e = Object(f.e)("xdf-common-ecommerce-abtest20250215-group")
              , t = "cookie";
            return e || (e = function() {
                var e = Math.random();
                return e < .3 ? "A" : e < .6 ? "B" : "C"
            }(),
            t = "assign"),
            Object(f.o)("xdf-common-ecommerce-abtest20250215-group", e, 365),
            {
                group: e,
                source: t
            }
        }
          , h = function() {
            var e = Object(c.a)(i.a.mark((function e(t) {
                return i.a.wrap((function(e) {
                    for (; ; )
                        switch (e.prev = e.next) {
                        case 0:
                            return e.abrupt("return", Object(c.a)(i.a.mark((function e() {
                                return i.a.wrap((function(e) {
                                    for (; ; )
                                        switch (e.prev = e.next) {
                                        case 0:
                                            return e.next = 2,
                                            Promise.all([n.e(10), n.e(14)]).then(n.bind(null, "BMYk"));
                                        case 2:
                                            return e.abrupt("return", e.sent.default);
                                        case 3:
                                        case "end":
                                            return e.stop()
                                        }
                                }
                                ), e)
                            }
                            )))().then(function() {
                                var e = Object(c.a)(i.a.mark((function e(n) {
                                    var r, o, a, c;
                                    return i.a.wrap((function(e) {
                                        for (; ; )
                                            switch (e.prev = e.next) {
                                            case 0:
                                                return o = n({
                                                    signType: "dsapi"
                                                }, {
                                                    baseURL: l.d
                                                }),
                                                e.next = 3,
                                                o.get("/base/v1/define-city/list");
                                            case 3:
                                                if (a = e.sent,
                                                !((null === (r = a.data.data) || void 0 === r ? void 0 : r.abtest20250215) || []).includes("".concat(t))) {
                                                    e.next = 7;
                                                    break
                                                }
                                                return c = p(),
                                                e.abrupt("return", c);
                                            case 7:
                                                return e.abrupt("return", {
                                                    group: void 0
                                                });
                                            case 8:
                                            case "end":
                                                return e.stop()
                                            }
                                    }
                                    ), e)
                                }
                                )));
                                return function(t) {
                                    return e.apply(this, arguments)
                                }
                            }()));
                        case 1:
                        case "end":
                            return e.stop()
                        }
                }
                ), e)
            }
            )));
            return function(t) {
                return e.apply(this, arguments)
            }
        }();
        n("iFgM");
        function m(e, t) {
            var n;
            if ("undefined" === typeof Symbol || null == e[Symbol.iterator]) {
                if (Array.isArray(e) || (n = function(e, t) {
                    if (!e)
                        return;
                    if ("string" === typeof e)
                        return v(e, t);
                    var n = Object.prototype.toString.call(e).slice(8, -1);
                    "Object" === n && e.constructor && (n = e.constructor.name);
                    if ("Map" === n || "Set" === n)
                        return Array.from(e);
                    if ("Arguments" === n || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n))
                        return v(e, t)
                }(e)) || t && e && "number" === typeof e.length) {
                    n && (e = n);
                    var r = 0
                      , o = function() {};
                    return {
                        s: o,
                        n: function() {
                            return r >= e.length ? {
                                done: !0
                            } : {
                                done: !1,
                                value: e[r++]
                            }
                        },
                        e: function(e) {
                            throw e
                        },
                        f: o
                    }
                }
                throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")
            }
            var a, i = !0, c = !1;
            return {
                s: function() {
                    n = e[Symbol.iterator]()
                },
                n: function() {
                    var e = n.next();
                    return i = e.done,
                    e
                },
                e: function(e) {
                    c = !0,
                    a = e
                },
                f: function() {
                    try {
                        i || null == n.return || n.return()
                    } finally {
                        if (c)
                            throw a
                    }
                }
            }
        }
        function v(e, t) {
            (null == t || t > e.length) && (t = e.length);
            for (var n = 0, r = new Array(t); n < t; n++)
                r[n] = e[n];
            return r
        }
        var g = n("aCH8")
          , b = {
            detail: "pc-detail",
            search: "pc-list"
        }
          , w = function(e) {
            var t = e.hotKeywordList
              , n = e.cityCode
              , o = e.telephone
              , a = e.cityList
              , u = e.getSerachClass
              , d = e.kw
              , p = e.isHiddenHeaderSearch
              , h = e.page
              , v = void 0 === h ? "" : h
              , w = e.searchId
              , y = e.searchKeywordId
              , x = Object(s.useState)("")
              , O = x[0]
              , j = x[1]
              , C = Object(s.useState)(d || "")
              , k = C[0]
              , S = C[1]
              , _ = Object(s.useState)("")
              , A = _[0]
              , M = _[1]
              , E = Object(s.useState)("")
              , I = E[0]
              , P = E[1]
              , T = Object(s.useState)("")
              , D = (T[0],
            T[1]);
            Object(s.useEffect)((function() {
                D("detail" == v ? "" : window.xdfCommonCitySelect.BUTTON_CLASS_NAME),
                window.xdfCommonCitySelect.init("pc"),
                window.xdfCommonCitySelect.onChange((function(e) {
                    var t = e.detail;
                    if (t.code != n) {
                        var r = []
                          , o = function() {
                            for (var e = ((arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : window.location.href).split("?")[1] || "").split("&"), t = {}, n = 0; n < e.length; n++) {
                                var r = e[n].split("=")
                                  , o = r[0];
                                o && (t[o] = r[1])
                            }
                            return t
                        }();
                        delete o.cid,
                        o.cityCode = t.code;
                        for (var a = 0, i = Object.keys(o); a < i.length; a++) {
                            var c = i[a];
                            r.push("".concat(c, "=").concat(o[c]))
                        }
                        var s = "".concat(window.location.origin).concat(window.location.pathname, "?").concat(r.join("&"));
                        window.location.replace(s)
                    }
                }
                )),
                n || "teacher-detail" == v || "detail" == v || window.xdfCommonCitySelect.open()
            }
            ), []),
            Object(s.useEffect)((function() {
                ("teacher-detail" != v && "detail" != v || n) && window.xdfCommonCitySelect.getAsync(n).then((function(e) {
                    n == e.code || "teacher-detail" == v ? (window.xdfCommonCitySelect.close(),
                    j(e.name),
                    Object(f.o)("soukecityid", e.code),
                    Object(f.o)("cityName", e.name)) : setTimeout((function() {
                        window.xdfCommonCitySelect.open()
                    }
                    ), 300)
                }
                )).catch((function(e) {
                    window.xdfCommonCitySelect.open()
                }
                ))
            }
            ), [n]);
            var N = function() {
                var e = Object(c.a)(i.a.mark((function e(t) {
                    var r, o, a, c, s, u;
                    return i.a.wrap((function(e) {
                        for (; ; )
                            switch (e.prev = e.next) {
                            case 0:
                                if (r = !1,
                                !/^[0-9a-zA-Z]*$/i.test(t)) {
                                    e.next = 11;
                                    break
                                }
                                return o = "appId=".concat(l.a, "&cityCode=").concat(n, "&t=").concat((new Date).getTime(), "&classCodes=").concat(t),
                                e.next = 6,
                                fetch("".concat(l.d, "/product/v1/class/list?").concat(o), {
                                    headers: {
                                        "Content-Type": "application/json",
                                        sign: g("".concat(o).concat(l.b))
                                    }
                                });
                            case 6:
                                return a = e.sent,
                                e.next = 9,
                                a.json();
                            case 9:
                                200 == (c = e.sent).code && c.data.length >= 1 && (s = c.data[0],
                                u = "/item/".concat(s.cityCode, "-").concat(s.schoolId, "-").concat(s.code, ".html"),
                                r = !0,
                                window.location.href = u);
                            case 11:
                                return e.next = 13,
                                r;
                            case 13:
                                return e.abrupt("return", e.sent);
                            case 14:
                            case "end":
                                return e.stop()
                            }
                    }
                    ), e)
                }
                )));
                return function(t) {
                    return e.apply(this, arguments)
                }
            }()
              , R = function() {
                var e, t = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : k;
                t != k && S(t),
                null === (e = window.xdfCommonReportData) || void 0 === e || e.send({
                    module: "".concat(b[v], "-search"),
                    action: "search",
                    thirdParty: !0
                }, {
                    reportData: {
                        citycode: n,
                        cityname: O,
                        islogin: A ? "\u662f" : "\u5426",
                        userid: I || null,
                        itemTitle: t
                    }
                }),
                N(t),
                window.location.pathname.indexOf("/search") >= 0 ? u && u(1, t, !0) : window.open("/search?searchResult=true&cityCode=".concat(n, "&kw=").concat(t))
            };
            return Object(s.useEffect)((function() {
                M(Object(f.e)("U2NickName")),
                P(Object(f.e)("U2AT")),
                k && N(k)
            }
            ), []),
            Object(r.jsx)("div", {
                className: "header",
                children: p ? "" : Object(r.jsx)("div", {
                    className: "bgWhite",
                    children: Object(r.jsxs)("div", {
                        className: "wrap1200".concat(" ", "searchCon"),
                        children: [Object(r.jsxs)("span", {
                            className: "leap-info",
                            onClick: function() {
                                var e, t = {}, n = m(a);
                                try {
                                    for (n.s(); !(e = n.n()).done; ) {
                                        var r = e.value;
                                        parseInt(r.id) === parseInt(Object(f.e)("soukecityid")) && (t = r)
                                    }
                                } catch (o) {
                                    n.e(o)
                                } finally {
                                    n.f()
                                }
                                t.sitePath ? (Object(f.o)("soukecityid", t.id),
                                Object(f.o)("cityName", t.name),
                                window.open("https://www.xdf.cn/".concat(t.sitePath, "/"))) : (Object(f.o)("soukecityid", t.id),
                                Object(f.o)("cityName", t.name),
                                window.open("https://www.xdf.cn/"))
                            },
                            children: [Object(r.jsx)("img", {
                                src: "http://file.xdf.cn/citysite/images/xdfLOGO.png",
                                className: "logo"
                            }), O && Object(r.jsx)("span", {
                                className: "inseachcity",
                                "data-city-select-offset": "[15, 15]",
                                id: "inseachcity",
                                children: O
                            })]
                        }), o && Object(r.jsx)("p", {
                            className: "phone",
                            children: o
                        }), Object(r.jsxs)("div", {
                            className: "searForm",
                            id: "searchBar",
                            children: [Object(r.jsx)("div", {
                                className: "formCon",
                                id: w,
                                children: Object(r.jsxs)("div", {
                                    className: "form",
                                    children: [Object(r.jsx)("input", {
                                        type: "text",
                                        value: k,
                                        className: "inpTxt",
                                        id: "txtKeyWord",
                                        placeholder: "\u641c\u7d22\u611f\u5174\u8da3\u7684\u5185\u5bb9/\u8bfe\u7a0b/\u73ed\u53f7",
                                        onKeyUp: function(e) {
                                            !function(e) {
                                                13 == (e.keyCode ? e.keyCode : e.which ? e.which : e.charCode) && "" != k && R()
                                            }(e)
                                        },
                                        onChange: function(e) {
                                            S(e.target.value)
                                        }
                                    }), Object(r.jsx)("input", {
                                        type: "button",
                                        className: "inpSub",
                                        id: "btnSearchBar",
                                        onClick: function() {
                                            R()
                                        },
                                        value: "\u641c \u7d22"
                                    })]
                                })
                            }), t.length > 0 && Object(r.jsxs)("p", {
                                className: "keyword",
                                id: y,
                                children: ["\u70ed\u95e8\u641c\u7d22\uff1a", t.map((function(e, t) {
                                    return Object(r.jsx)("a", {
                                        href: "/search?cityCode=".concat(n, "&categoryCode=").concat(e.categoryCode),
                                        target: "_blank",
                                        onClick: function() {},
                                        children: e.categoryName
                                    }, "keyword-".concat(t))
                                }
                                ))]
                            })]
                        })]
                    })
                })
            })
        }
          , y = function() {
            return Object(r.jsx)("div", {
                className: "footer",
                children: Object(r.jsxs)("div", {
                    className: "wrap1200 reserved",
                    children: [Object(r.jsxs)("p", {
                        className: "reservedP",
                        children: ["\u7ecf\u8425\u8bb8\u53ef\u8bc1\u7f16\u53f7\uff1a", Object(r.jsx)("a", {
                            rel: "nofollow",
                            href: "http://beian.miit.gov.cn",
                            target: "_blank",
                            children: "\u4eacICP\u590705067667\u53f7-32"
                        }), " | \u4eacICP\u8bc1060601\u53f7 | \u4eac\u516c\u7f51\u5b89\u590711010802021790\u53f7"]
                    }), Object(r.jsxs)("p", {
                        className: "reservedP",
                        children: ["Copyright 2011-", Object(r.jsx)("span", {
                            id: "nowYear",
                            children: "2021"
                        }), " \u65b0\u4e1c\u65b9\u6559\u80b2\u79d1\u6280\u96c6\u56e2\u6709\u9650\u516c\u53f8, All Rights Reserved"]
                    }), Object(r.jsx)("div", {
                        className: "bottomImgs",
                        id: "kx_logo",
                        children: Object(r.jsx)("a", {
                            href: "https://ss.knet.cn/verifyseal.dll?sn=2011050300100008297&ct=df&a=1&pa=0.12573011522181332",
                            children: Object(r.jsx)("img", {
                                className: "img".concat(" ", "last"),
                                src: "http://file.xdf.cn/201501/cnnic.png",
                                alt: "\u53ef\u4fe1\u7f51\u7ad9"
                            })
                        })
                    })]
                })
            })
        }
          , x = n("TRbW")
          , O = n("20a2");
        function j(e, t) {
            var n = Object.keys(e);
            if (Object.getOwnPropertySymbols) {
                var r = Object.getOwnPropertySymbols(e);
                t && (r = r.filter((function(t) {
                    return Object.getOwnPropertyDescriptor(e, t).enumerable
                }
                ))),
                n.push.apply(n, r)
            }
            return n
        }
        function C(e) {
            for (var t = 1; t < arguments.length; t++) {
                var n = null != arguments[t] ? arguments[t] : {};
                t % 2 ? j(Object(n), !0).forEach((function(t) {
                    Object(o.a)(e, t, n[t])
                }
                )) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(n)) : j(Object(n)).forEach((function(t) {
                    Object.defineProperty(e, t, Object.getOwnPropertyDescriptor(n, t))
                }
                ))
            }
            return e
        }
        function k(e, t) {
            var n;
            if ("undefined" === typeof Symbol || null == e[Symbol.iterator]) {
                if (Array.isArray(e) || (n = function(e, t) {
                    if (!e)
                        return;
                    if ("string" === typeof e)
                        return S(e, t);
                    var n = Object.prototype.toString.call(e).slice(8, -1);
                    "Object" === n && e.constructor && (n = e.constructor.name);
                    if ("Map" === n || "Set" === n)
                        return Array.from(e);
                    if ("Arguments" === n || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n))
                        return S(e, t)
                }(e)) || t && e && "number" === typeof e.length) {
                    n && (e = n);
                    var r = 0
                      , o = function() {};
                    return {
                        s: o,
                        n: function() {
                            return r >= e.length ? {
                                done: !0
                            } : {
                                done: !1,
                                value: e[r++]
                            }
                        },
                        e: function(e) {
                            throw e
                        },
                        f: o
                    }
                }
                throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")
            }
            var a, i = !0, c = !1;
            return {
                s: function() {
                    n = e[Symbol.iterator]()
                },
                n: function() {
                    var e = n.next();
                    return i = e.done,
                    e
                },
                e: function(e) {
                    c = !0,
                    a = e
                },
                f: function() {
                    try {
                        i || null == n.return || n.return()
                    } finally {
                        if (c)
                            throw a
                    }
                }
            }
        }
        function S(e, t) {
            (null == t || t > e.length) && (t = e.length);
            for (var n = 0, r = new Array(t); n < t; n++)
                r[n] = e[n];
            return r
        }
        var _ = n("aCH8")
          , A = {
            detail: "pc-detail",
            search: "pc-list"
        }
          , M = [];
        t.a = function(e) {
            var t = e.children
              , o = e.siteTitle
              , a = e.siteDescription
              , u = e.siteKeywords
              , p = e.cityCode
              , m = e.getSerachClass
              , v = e.kw
              , g = e.parentPhone
              , b = e.deptCode
              , j = e.getCityName
              , S = e.getConnectionConfig
              , E = e.page
              , I = e.categoryCode
              , P = e.id
              , T = e.searchId
              , D = e.searchKeywordId
              , N = Object(s.useState)([])
              , R = N[0]
              , H = N[1]
              , B = Object(s.useState)([])
              , F = B[0]
              , W = B[1]
              , U = Object(s.useState)([])
              , L = U[0]
              , K = U[1]
              , Y = Object(s.useState)([])
              , q = (Y[0],
            Y[1])
              , X = Object(s.useState)({})
              , G = (X[0],
            X[1],
            Object(O.useRouter)())
              , V = Object(s.useState)({
                group: "undefined"
            })
              , z = V[0]
              , J = V[1]
              , Q = Object(s.useState)("")
              , $ = (Q[0],
            Q[1])
              , Z = !!e.isHiddenHeaderSearch && e.isHiddenHeaderSearch;
            Object(s.useEffect)((function() {
                /Android|webOS|iPhone|Windows Phone|iPod|BlackBerry|SymbianOS/i.test(navigator.userAgent);
                if (Object(x.b)().env.isMobile && 0 == window.location.pathname.indexOf("/area/")) {
                    var e = "".concat(l.e).concat(window.location.pathname).concat(window.location.pathname.indexOf(".html") > 0 ? "" : ".html").concat(window.location.search);
                    window.location.href = e
                } else if (Object(x.b)().env.isMobile && 0 == window.location.pathname.indexOf("/item/")) {
                    var t = "".concat(l.e).concat(window.location.pathname).concat(window.location.pathname.indexOf(".html") > 0 ? "" : ".html").concat(window.location.search);
                    setTimeout((function() {
                        window.location.href = t
                    }
                    ), 1e3)
                } else if (Object(x.b)().env.isMobile && 0 == window.location.pathname.indexOf("/search")) {
                    var n = "".concat(l.e).concat(window.location.pathname).concat(window.location.search);
                    window.location.href = n
                } else
                    "search" !== E && "detail" !== E || h(p).then((function(e) {
                        var t;
                        (J(e),
                        e.group) && (null === (t = window.xdfCommonReportData) || void 0 === t || t.sendNamedEvent("abtest20250215", {
                            event: "abtest",
                            group: {
                                abtest20250215: e.group
                            }
                        }, "recommend"))
                    }
                    )),
                    ee()
            }
            ), []),
            Object(s.useEffect)((function() {
                Object(x.b)().env.isMobile || g && H(g)
            }
            ), [g]);
            var ee = function() {
                var e = Object(c.a)(i.a.mark((function e() {
                    var t, n, r, o, a, c, s, u, d, l, p, h, m, v, g;
                    return i.a.wrap((function(e) {
                        for (; ; )
                            switch (e.prev = e.next) {
                            case 0:
                                if (!Object(x.b)().env.isMobile) {
                                    e.next = 2;
                                    break
                                }
                                return e.abrupt("return");
                            case 2:
                                if (!(t = window.location.href.match(/\/(item|area)\/(.*?)\.html/)) || !t[2]) {
                                    e.next = 37;
                                    break
                                }
                                if (n = t[2].split("-"),
                                !("item" == t[1] && n[1] && n[2] && n[0] && n[0].length < 6)) {
                                    e.next = 13;
                                    break
                                }
                                return e.next = 8,
                                window.xdfCommonCitySelect.getCityListAsync();
                            case 8:
                                o = e.sent,
                                a = null === (r = o.find((function(e) {
                                    return e.id == n[0] || e.code == n[0]
                                }
                                ))) || void 0 === r ? void 0 : r.code,
                                window.location.replace("".concat(window.location.origin, "/item/").concat(a || "", "-").concat(n[1], "-").concat(n[2], ".html")),
                                e.next = 37;
                                break;
                            case 13:
                                if ("area" != t[1]) {
                                    e.next = 37;
                                    break
                                }
                                return e.next = 16,
                                window.xdfCommonCitySelect.getCityListAsync();
                            case 16:
                                if (c = e.sent,
                                n[1] && n[2] && n[0].length < 6 && (u = null === (s = c.find((function(e) {
                                    return e.id == n[0] || e.code == n[0]
                                }
                                ))) || void 0 === s ? void 0 : s.code,
                                window.location.replace("".concat(window.location.origin, "/area/").concat(u, "-").concat(n[1], "-").concat(n[2], ".html"))),
                                n[1] || n[2] || !(n[0].length < 6)) {
                                    e.next = 37;
                                    break
                                }
                                if ("0" != n[0]) {
                                    e.next = 32;
                                    break
                                }
                                if (!(d = Object(f.e)("cityCode"))) {
                                    e.next = 29;
                                    break
                                }
                                return e.next = 24,
                                window.xdfCommonCitySelect.getCityListAsync();
                            case 24:
                                p = e.sent,
                                h = null === (l = p.find((function(e) {
                                    return e.id == d || e.code == d
                                }
                                ))) || void 0 === l ? void 0 : l.code,
                                window.location.replace("".concat(window.location.origin, "/area/").concat(h, ".html")),
                                e.next = 30;
                                break;
                            case 29:
                                window.location.replace("https://www.xdf.cn?redirectUrl=".concat(encodeURIComponent(window.location.href.replace("/0.html", "/{cityId}.html"))));
                            case 30:
                                e.next = 37;
                                break;
                            case 32:
                                return e.next = 34,
                                window.xdfCommonCitySelect.getCityListAsync();
                            case 34:
                                v = e.sent,
                                g = null === (m = v.find((function(e) {
                                    return e.id == n[0] || e.code == n[0]
                                }
                                ))) || void 0 === m ? void 0 : m.code,
                                window.location.replace("".concat(window.location.origin, "/area/").concat(g, ".html"));
                            case 37:
                            case "end":
                                return e.stop()
                            }
                    }
                    ), e)
                }
                )));
                return function() {
                    return e.apply(this, arguments)
                }
            }()
              , te = function() {
                var e = Object(c.a)(i.a.mark((function e() {
                    var t, n, r, o;
                    return i.a.wrap((function(e) {
                        for (; ; )
                            switch (e.prev = e.next) {
                            case 0:
                                if (p) {
                                    e.next = 2;
                                    break
                                }
                                return e.abrupt("return", !1);
                            case 2:
                                return t = "appId=".concat(l.a, "&cityCode=").concat(p, "&t=").concat((new Date).getTime()),
                                n = _("".concat(t).concat(l.b)),
                                e.next = 6,
                                fetch("".concat(l.d, "/portal/v1/pc/city/list?").concat(t), {
                                    headers: {
                                        "Content-Type": "application/json",
                                        sign: n
                                    }
                                });
                            case 6:
                                return r = e.sent,
                                e.next = 9,
                                r.json();
                            case 9:
                                (o = e.sent).status && 1 == o.status && o.data && K(o.data || []);
                            case 11:
                            case "end":
                                return e.stop()
                            }
                    }
                    ), e)
                }
                )));
                return function() {
                    return e.apply(this, arguments)
                }
            }()
              , ne = function() {
                var e = Object(c.a)(i.a.mark((function e() {
                    return i.a.wrap((function(e) {
                        for (; ; )
                            switch (e.prev = e.next) {
                            case 0:
                                if (p) {
                                    e.next = 2;
                                    break
                                }
                                return e.abrupt("return");
                            case 2:
                                Object(c.a)(i.a.mark((function e() {
                                    return i.a.wrap((function(e) {
                                        for (; ; )
                                            switch (e.prev = e.next) {
                                            case 0:
                                                return e.next = 2,
                                                Promise.all([n.e(10), n.e(14)]).then(n.bind(null, "BMYk"));
                                            case 2:
                                                return e.abrupt("return", e.sent.default);
                                            case 3:
                                            case "end":
                                                return e.stop()
                                            }
                                    }
                                    ), e)
                                }
                                )))().then((function(e) {
                                    e().get("".concat(l.d, "/portal/v2/hot-keyword/list"), {
                                        params: {
                                            cityCode: p,
                                            categoryCode: I
                                        }
                                    }).then((function(e) {
                                        "200" == e.data.code && W(e.data.data || [])
                                    }
                                    )).catch((function(e) {
                                        console.log(e)
                                    }
                                    ))
                                }
                                ));
                            case 3:
                            case "end":
                                return e.stop()
                            }
                    }
                    ), e)
                }
                )));
                return function() {
                    return e.apply(this, arguments)
                }
            }()
              , re = function() {
                var e = Object(c.a)(i.a.mark((function e() {
                    var t, n, r, o, a, c, s, u, d;
                    return i.a.wrap((function(e) {
                        for (; ; )
                            switch (e.prev = e.next) {
                            case 0:
                                if (window.gio) {
                                    e.next = 3;
                                    break
                                }
                                return setTimeout((function() {
                                    re()
                                }
                                ), 500),
                                e.abrupt("return");
                            case 3:
                                t = G.pathname,
                                n = "",
                                e.t0 = t,
                                e.next = "/area/[id]" === e.t0 ? 8 : "/search" === e.t0 ? 10 : "/item/[id]" === e.t0 ? 13 : 15;
                                break;
                            case 8:
                                return n = "\u9996\u9875",
                                e.abrupt("break", 16);
                            case 10:
                                return n = "\u73ed\u7ea7\u5217\u8868",
                                Object.keys(G.query).hasOwnProperty("kw") && (n = "\u641c\u7d22\u7ed3\u679c"),
                                e.abrupt("break", 16);
                            case 13:
                                return n = "\u73ed\u7ea7\u8be6\u60c5",
                                e.abrupt("break", 16);
                            case 15:
                                return e.abrupt("break", 16);
                            case 16:
                                "PC",
                                r = "";
                                try {
                                    if (n)
                                        try {
                                            gio("page.set", {
                                                pagetype: n
                                            })
                                        } catch (i) {
                                            console.log("err", i)
                                        }
                                    if (G.query) {
                                        o = "",
                                        G.query.schoolId ? o = G.query.schoolId : G.query.id ? (a = String(G.query.id).split("-"),
                                        o = a[1]) : o = G.query.cityCode;
                                        try {
                                            gio("visitor.set", {
                                                schoolid: o,
                                                platform: "PC"
                                            })
                                        } catch (i) {
                                            console.log("err", i)
                                        }
                                    }
                                } catch (i) {
                                    console.log(i)
                                }
                                return c = Object(f.e)("U2AT"),
                                $(c),
                                s = _("/common/check/wx?14e1b600b1fd579f47433b88e8d85291"),
                                e.prev = 22,
                                e.next = 25,
                                fetch("".concat(l.c, "/common/check/wx"), {
                                    headers: {
                                        "Content-Type": "application/json",
                                        sign: s,
                                        appId: "api_app_wechat"
                                    }
                                });
                            case 25:
                                return u = e.sent,
                                e.next = 28,
                                u.json();
                            case 28:
                                200 == (d = e.sent).code && d.data && (r = d.data.userId,
                                window.xdfCommonReportData.sendLoginInfo({
                                    _U2AT: c,
                                    U2userId: r
                                })),
                                e.next = 35;
                                break;
                            case 32:
                                e.prev = 32,
                                e.t1 = e.catch(22),
                                console.log(e.t1);
                            case 35:
                            case "end":
                                return e.stop()
                            }
                    }
                    ), e, null, [[22, 32]])
                }
                )));
                return function() {
                    return e.apply(this, arguments)
                }
            }();
            Object(s.useEffect)((function() {
                Object(x.b)().env.isMobile || (re(),
                te(),
                ae())
            }
            ), []),
            Object(s.useEffect)((function() {
                Object(x.b)().env.isMobile || ne()
            }
            ), [I]),
            Object(s.useEffect)((function() {
                Object(x.b)().env.isMobile || L.forEach((function(e) {
                    e.code == p && (q(e.name),
                    j && j(e.name))
                }
                ))
            }
            ), [L]);
            var oe = function() {
                if (p && b && !function(e) {
                    if (M.length != e.length)
                        return M = e,
                        !1;
                    var t, n = k(e);
                    try {
                        var r = function() {
                            var n = t.value;
                            if (M.findIndex((function(e) {
                                return e == n
                            }
                            )) < 0)
                                return M = e,
                                {
                                    v: !1
                                }
                        };
                        for (n.s(); !(t = n.n()).done; ) {
                            var o = r();
                            if ("object" === typeof o)
                                return o.v
                        }
                    } catch (a) {
                        n.e(a)
                    } finally {
                        n.f()
                    }
                    return !0
                }(b || [])) {
                    var e = G.pathname;
                    if (!("/item/[id]" != e && "/search" != e || Z)) {
                        var t = "class_list";
                        switch (e) {
                        case "/search":
                            t = "class_list";
                            break;
                        case "/item/[id]":
                            t = "class_detail";
                            break;
                        default:
                            t = "class_list"
                        }
                        var n = new x.a({
                            id: "chat_ai",
                            name: "\u673a\u5668\u4eba\u5b9e\u9a8c\u843d\u5730",
                            variants: [{
                                id: 1,
                                weight: 10,
                                isControl: !0
                            }, {
                                id: 0,
                                weight: 90
                            }]
                        })
                          , r = C(C({
                            mode: "pc",
                            pageType: t,
                            client: "xdf_pc",
                            deptCode: b,
                            showItems: {
                                pc: ["onlineService", "hotline", "form", "wechatQr"]
                            },
                            cityCode: p
                        }, "C" === z.group || "120100" === p || "320500" === p ? {
                            version: 2
                        } : {}), "320500" === p ? {
                            isGray: n.getVariant()
                        } : {});
                        setTimeout((function() {
                            var e;
                            window.xdfCommonConnection.init(r).then((function(e) {
                                var n, r;
                                (S && S(e || {}),
                                e) && ("class_detail" === t && null !== (n = e.hotlineList[0]) && void 0 !== n && n.telephone && H(null === (r = e.hotlineList[0]) || void 0 === r ? void 0 : r.telephone))
                            }
                            )),
                            null === (e = window.xdfCommonConnection) || void 0 === e || e.onHandleItemDialog((function(e) {
                                var t, n = e.detail, r = n.data, o = void 0 === r ? [] : r, a = n.type, i = n.id, c = [], s = k(o);
                                try {
                                    for (s.s(); !(t = s.n()).done; ) {
                                        var u = t.value;
                                        c.push(u.name)
                                    }
                                } catch (l) {
                                    s.e(l)
                                } finally {
                                    s.f()
                                }
                                var d, f = {
                                    hotline_show: "telephone_service_layer",
                                    online_service_show: "online_service_layer",
                                    form_click: "freecourse_righyside",
                                    online_service_click: "online_service_layer"
                                }["".concat(i, "_").concat(a)];
                                f && (null === (d = window.xdfCommonReportData) || void 0 === d || d.send({
                                    action: a,
                                    id: f
                                }, {
                                    firsttypename: c.join(","),
                                    reportData: {
                                        firsttypename: c.join(",")
                                    }
                                }))
                            }
                            ))
                        }
                        ), 500)
                    }
                }
            };
            Object(s.useEffect)((function() {
                Object(x.b)().env.isMobile || ("undefined" !== z.group || "search" !== E && "detail" !== E) && oe()
            }
            ), [z, b]);
            var ae = function e() {
                var t, n, r, o;
                if (window.XDF_COMMON_ADD_PUBLIC_HEADER || null === (t = document) || void 0 === t || !t.getElementById("search-xdf-header-common")) {
                    var a = {
                        id: "".concat(A[E], "-login"),
                        item: "login,official,online",
                        continer: null === (n = document) || void 0 === n ? void 0 : n.getElementById("search-xdf-header-common")
                    };
                    (null === (r = window.XDF_COMMON_ADD_PUBLIC_HEADER) || void 0 === r ? void 0 : r.init) && (null === (o = window.XDF_COMMON_ADD_PUBLIC_HEADER) || void 0 === o || o.init(a))
                } else
                    setTimeout((function() {
                        e()
                    }
                    ), 200)
            };
            return Object(r.jsxs)("div", {
                className: "container",
                id: P,
                children: [Object(r.jsx)("div", {
                    id: "search-xdf-header-common"
                }), Object(r.jsxs)(d.a, {
                    children: [Object(r.jsx)("link", {
                        rel: "icon",
                        href: "/favicon.ico"
                    }), Object(r.jsx)("meta", {
                        name: "description",
                        content: a || "\u65b0\u4e1c\u65b9\u7f51\uff08www.xdf.cn\uff09\u662f\u65b0\u4e1c\u65b9\u6559\u80b2\u79d1\u6280\u96c6\u56e2\u63a8\u51fa\u7684\u4e00\u7ad9\u5f0f\u5b66\u4e60\u4e92\u52a8\u4ea4\u6d41\u5e73\u53f0\uff0c\u65b0\u4e1c\u65b9\u7f51\u7684\u5185\u5bb9\u6db5\u76d6\u4e86\u82f1\u8bed\u5b66\u4e60\u89c4\u5212\u3001\u6210\u957f\u5bfc\u822a\u3001\u65b0\u4e1c\u65b9\u641c\u8bfe\u3001\u65b0\u4e1c\u65b9\u8001\u5e08\u7b54\u95ee\u3001\u5728\u7ebf\u54a8\u8be2\u3001\u7f51\u4e0a\u6d4b\u8bc4\u3001\u5b66\u4e60\u8d44\u8baf\u3001\u65b0\u4e1c\u65b9\u5b66\u5458\u670d\u52a1\u3001\u65b0\u4e1c\u65b9\u793e\u533a\u7b49\uff0c\u66f4\u591a\u7cbe\u5f69\u5185\u5bb9\u5c3d\u5728\u65b0\u4e1c\u65b9\u7f51\u3002"
                    }), Object(r.jsx)("meta", {
                        name: "keywords",
                        content: u || "\u65b0\u4e1c\u65b9,\u65b0\u4e1c\u65b9\u7f51,\u65b0\u4e1c\u65b9\u6559\u80b2\u95e8\u6237,\u65b0\u4e1c\u65b9\u82f1\u8bed,\u65b0\u4e1c\u65b9\u5b98\u7f51,\u65b0\u4e1c\u65b9\u82f1\u8bed\u57f9\u8bad,\u65b0\u4e1c\u65b9\u6559\u80b2\u79d1\u6280\u96c6\u56e2,\u65b0\u4e1c\u65b9\u5b98\u65b9\u7f51\u7ad9,\u65b0\u4e1c\u65b9\u57f9\u8bad,\u65b0\u4e1c\u65b9\u96c6\u56e2"
                    }), Object(r.jsx)("meta", {
                        property: "og:image",
                        content: "https://og-image.now.sh/".concat(encodeURI(o), ".png?theme=light&md=0&fontSize=75px&images=https%3A%2F%2Fassets.vercel.com%2Fimage%2Fupload%2Ffront%2Fassets%2Fdesign%2Fnextjs-black-logo.svg")
                    }), Object(r.jsx)("meta", {
                        name: "og:title",
                        content: o
                    }), Object(r.jsx)("meta", {
                        content: "always",
                        name: "referrer"
                    }), Object(r.jsx)("meta", {
                        name: "twitter:card",
                        content: "summary_large_image"
                    }), Object(r.jsx)("title", {
                        children: o
                    })]
                }), Object(r.jsxs)("div", {
                    children: [!Z && Object(r.jsx)(w, {
                        hotKeywordList: F,
                        cityCode: p,
                        telephone: R,
                        cityList: L,
                        getSerachClass: m,
                        kw: v,
                        isHiddenHeaderSearch: Z,
                        page: E,
                        searchId: T,
                        searchKeywordId: D
                    }), Object(r.jsx)("main", {
                        children: t
                    }), Object(r.jsx)(y, {})]
                })]
            })
        }
    },
    "5fIB": function(e, t, n) {
        var r = n("7eYB");
        e.exports = function(e) {
            if (Array.isArray(e))
                return r(e)
        }
    },
    "8Kt/": function(e, t, n) {
        "use strict";
        var r = n("oI91");
        function o(e, t) {
            var n = Object.keys(e);
            if (Object.getOwnPropertySymbols) {
                var r = Object.getOwnPropertySymbols(e);
                t && (r = r.filter((function(t) {
                    return Object.getOwnPropertyDescriptor(e, t).enumerable
                }
                ))),
                n.push.apply(n, r)
            }
            return n
        }
        t.__esModule = !0,
        t.defaultHead = l,
        t.default = void 0;
        var a, i = function(e) {
            if (e && e.__esModule)
                return e;
            if (null === e || "object" !== typeof e && "function" !== typeof e)
                return {
                    default: e
                };
            var t = f();
            if (t && t.has(e))
                return t.get(e);
            var n = {}
              , r = Object.defineProperty && Object.getOwnPropertyDescriptor;
            for (var o in e)
                if (Object.prototype.hasOwnProperty.call(e, o)) {
                    var a = r ? Object.getOwnPropertyDescriptor(e, o) : null;
                    a && (a.get || a.set) ? Object.defineProperty(n, o, a) : n[o] = e[o]
                }
            n.default = e,
            t && t.set(e, n);
            return n
        }(n("q1tI")), c = (a = n("Xuae")) && a.__esModule ? a : {
            default: a
        }, s = n("lwAK"), u = n("FYa8"), d = n("/0+H");
        function f() {
            if ("function" !== typeof WeakMap)
                return null;
            var e = new WeakMap;
            return f = function() {
                return e
            }
            ,
            e
        }
        function l() {
            var e = arguments.length > 0 && void 0 !== arguments[0] && arguments[0]
              , t = [i.default.createElement("meta", {
                charSet: "utf-8"
            })];
            return e || t.push(i.default.createElement("meta", {
                name: "viewport",
                content: "width=device-width"
            })),
            t
        }
        function p(e, t) {
            return "string" === typeof t || "number" === typeof t ? e : t.type === i.default.Fragment ? e.concat(i.default.Children.toArray(t.props.children).reduce((function(e, t) {
                return "string" === typeof t || "number" === typeof t ? e : e.concat(t)
            }
            ), [])) : e.concat(t)
        }
        var h = ["name", "httpEquiv", "charSet", "itemProp"];
        function m(e, t) {
            return e.reduce((function(e, t) {
                var n = i.default.Children.toArray(t.props.children);
                return e.concat(n)
            }
            ), []).reduce(p, []).reverse().concat(l(t.inAmpMode)).filter(function() {
                var e = new Set
                  , t = new Set
                  , n = new Set
                  , r = {};
                return function(o) {
                    var a = !0
                      , i = !1;
                    if (o.key && "number" !== typeof o.key && o.key.indexOf("$") > 0) {
                        i = !0;
                        var c = o.key.slice(o.key.indexOf("$") + 1);
                        e.has(c) ? a = !1 : e.add(c)
                    }
                    switch (o.type) {
                    case "title":
                    case "base":
                        t.has(o.type) ? a = !1 : t.add(o.type);
                        break;
                    case "meta":
                        for (var s = 0, u = h.length; s < u; s++) {
                            var d = h[s];
                            if (o.props.hasOwnProperty(d))
                                if ("charSet" === d)
                                    n.has(d) ? a = !1 : n.add(d);
                                else {
                                    var f = o.props[d]
                                      , l = r[d] || new Set;
                                    "name" === d && i || !l.has(f) ? (l.add(f),
                                    r[d] = l) : a = !1
                                }
                        }
                    }
                    return a
                }
            }()).reverse().map((function(e, n) {
                var a = e.key || n;
                if (!t.inAmpMode && "link" === e.type && e.props.href && ["https://fonts.googleapis.com/css"].some((function(t) {
                    return e.props.href.startsWith(t)
                }
                ))) {
                    var c = function(e) {
                        for (var t = 1; t < arguments.length; t++) {
                            var n = null != arguments[t] ? arguments[t] : {};
                            t % 2 ? o(Object(n), !0).forEach((function(t) {
                                r(e, t, n[t])
                            }
                            )) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(n)) : o(Object(n)).forEach((function(t) {
                                Object.defineProperty(e, t, Object.getOwnPropertyDescriptor(n, t))
                            }
                            ))
                        }
                        return e
                    }({}, e.props || {});
                    return c["data-href"] = c.href,
                    c.href = void 0,
                    i.default.cloneElement(e, c)
                }
                return i.default.cloneElement(e, {
                    key: a
                })
            }
            ))
        }
        function v(e) {
            var t = e.children
              , n = (0,
            i.useContext)(s.AmpStateContext)
              , r = (0,
            i.useContext)(u.HeadManagerContext);
            return i.default.createElement(c.default, {
                reduceComponentsToState: m,
                headManager: r,
                inAmpMode: (0,
                d.isInAmpMode)(n)
            }, t)
        }
        v.rewind = function() {}
        ;
        var g = v;
        t.default = g
    },
    ANhw: function(e, t) {
        !function() {
            var t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
              , n = {
                rotl: function(e, t) {
                    return e << t | e >>> 32 - t
                },
                rotr: function(e, t) {
                    return e << 32 - t | e >>> t
                },
                endian: function(e) {
                    if (e.constructor == Number)
                        return 16711935 & n.rotl(e, 8) | 4278255360 & n.rotl(e, 24);
                    for (var t = 0; t < e.length; t++)
                        e[t] = n.endian(e[t]);
                    return e
                },
                randomBytes: function(e) {
                    for (var t = []; e > 0; e--)
                        t.push(Math.floor(256 * Math.random()));
                    return t
                },
                bytesToWords: function(e) {
                    for (var t = [], n = 0, r = 0; n < e.length; n++,
                    r += 8)
                        t[r >>> 5] |= e[n] << 24 - r % 32;
                    return t
                },
                wordsToBytes: function(e) {
                    for (var t = [], n = 0; n < 32 * e.length; n += 8)
                        t.push(e[n >>> 5] >>> 24 - n % 32 & 255);
                    return t
                },
                bytesToHex: function(e) {
                    for (var t = [], n = 0; n < e.length; n++)
                        t.push((e[n] >>> 4).toString(16)),
                        t.push((15 & e[n]).toString(16));
                    return t.join("")
                },
                hexToBytes: function(e) {
                    for (var t = [], n = 0; n < e.length; n += 2)
                        t.push(parseInt(e.substr(n, 2), 16));
                    return t
                },
                bytesToBase64: function(e) {
                    for (var n = [], r = 0; r < e.length; r += 3)
                        for (var o = e[r] << 16 | e[r + 1] << 8 | e[r + 2], a = 0; a < 4; a++)
                            8 * r + 6 * a <= 8 * e.length ? n.push(t.charAt(o >>> 6 * (3 - a) & 63)) : n.push("=");
                    return n.join("")
                },
                base64ToBytes: function(e) {
                    e = e.replace(/[^A-Z0-9+\/]/gi, "");
                    for (var n = [], r = 0, o = 0; r < e.length; o = ++r % 4)
                        0 != o && n.push((t.indexOf(e.charAt(r - 1)) & Math.pow(2, -2 * o + 8) - 1) << 2 * o | t.indexOf(e.charAt(r)) >>> 6 - 2 * o);
                    return n
                }
            };
            e.exports = n
        }()
    },
    BEtg: function(e, t) {
        function n(e) {
            return !!e.constructor && "function" === typeof e.constructor.isBuffer && e.constructor.isBuffer(e)
        }
        e.exports = function(e) {
            return null != e && (n(e) || function(e) {
                return "function" === typeof e.readFloatLE && "function" === typeof e.slice && n(e.slice(0, 0))
            }(e) || !!e._isBuffer)
        }
    },
    DTmv: function(e, t, n) {
        "use strict";
        n.d(t, "d", (function() {
            return a
        }
        )),
        n.d(t, "c", (function() {
            return i
        }
        )),
        n.d(t, "a", (function() {
            return r
        }
        )),
        n.d(t, "b", (function() {
            return o
        }
        )),
        n.d(t, "e", (function() {
            return c
        }
        )),
        n.d(t, "f", (function() {
            return s
        }
        ));
        var r = 5053
          , o = "750F82C2-D8F6-49F6-878C-1E7EBEBC8DA2"
          , a = "//dsapi.xdf.cn"
          , i = "//capi.xdf.cn"
          , c = "https://m.souke.xdf.cn";
        window && "m.xdf.cn" !== window.location.host && "//tppss.staff.xdf.cn";
        var s = !0;
        s || (c = "https://msouke.test.xdf.cn",
        "https://laoshi.test.xdf.cn",
        a = "//dsapi.xdf.cn",
        "//nsale-ecommerce-dsapi-souke-test2.test.xdf.cn",
        i = "//capi.test.xdf.cn",
        r = 5053,
        o = "750F82C2-D8F6-49F6-878C-1E7EBEBC8DA2",
        4446,
        "PC\u5b98\u7f51",
        4443,
        "\u5b98\u7f51")
    },
    FYa8: function(e, t, n) {
        "use strict";
        var r;
        t.__esModule = !0,
        t.HeadManagerContext = void 0;
        var o = ((r = n("q1tI")) && r.__esModule ? r : {
            default: r
        }).default.createContext({});
        t.HeadManagerContext = o
    },
    T0f4: function(e, t) {
        function n(t) {
            return e.exports = n = Object.setPrototypeOf ? Object.getPrototypeOf : function(e) {
                return e.__proto__ || Object.getPrototypeOf(e)
            }
            ,
            n(t)
        }
        e.exports = n
    },
    TRbW: function(e, t, n) {
        "use strict";
        n.d(t, "a", (function() {
            return s
        }
        )),
        n.d(t, "b", (function() {
            return j
        }
        ));
        var r = function() {
            return (r = Object.assign || function(e) {
                for (var t, n = 1, r = arguments.length; n < r; n++)
                    for (var o in t = arguments[n])
                        Object.prototype.hasOwnProperty.call(t, o) && (e[o] = t[o]);
                return e
            }
            ).apply(this, arguments)
        };
        function o(e) {
            try {
                var t = document.cookie.split(";").find((function(t) {
                    return t.trim().startsWith("".concat(e, "="))
                }
                ));
                return t ? decodeURIComponent(t.split("=")[1].trim()) : null
            } catch (n) {
                return console.error("Error reading cookie:", n),
                null
            }
        }
        function a(e, t, n) {
            void 0 === n && (n = {});
            try {
                var r = "".concat(e, "=").concat(encodeURIComponent(t));
                if (n.expires) {
                    var o = new Date;
                    o.setTime(o.getTime() + 24 * n.expires * 60 * 60 * 1e3),
                    r += "; expires=".concat(o.toUTCString())
                }
                var a = n.path || "/";
                r += "; path=".concat(a);
                var i = n.domain || "xdf.cn";
                r += "; domain=".concat(i),
                n.secure && (r += "; secure"),
                n.sameSite && (r += "; samesite=".concat(n.sameSite)),
                document.cookie = r
            } catch (c) {
                console.error("Error setting cookie:", c)
            }
        }
        function i(e, t) {
            void 0 === t && (t = {});
            try {
                if (t.domain)
                    return void a(e, "", r(r({}, t), {
                        expires: -1
                    }));
                for (var n = function() {
                    var e = window.location.hostname
                      , t = [];
                    t.push(e);
                    for (var n = e.split("."), r = 0; r < n.length - 1; r++) {
                        var o = n.slice(r).join(".");
                        t.push(o),
                        r > 0 && t.push("." + o)
                    }
                    return e.includes("xdf.cn") && (t.push("xdf.cn"),
                    t.push(".xdf.cn")),
                    Array.from(new Set(t))
                }(), o = t.path || "/", i = 0, c = n; i < c.length; i++) {
                    var s = c[i];
                    try {
                        a(e, "", {
                            domain: s,
                            path: o,
                            expires: -1,
                            secure: t.secure,
                            sameSite: t.sameSite
                        })
                    } catch (d) {
                        console.debug("Failed to remove cookie ".concat(e, " for domain ").concat(s, ":"), d)
                    }
                }
                try {
                    var u = "".concat(e, "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=").concat(o);
                    t.secure && (u += "; secure"),
                    t.sameSite && (u += "; samesite=".concat(t.sameSite)),
                    document.cookie = u
                } catch (d) {
                    console.debug("Failed to remove cookie ".concat(e, " for current domain:"), d)
                }
            } catch (d) {
                console.error("Error removing cookie:", d)
            }
        }
        "function" === typeof SuppressedError && SuppressedError;
        !function() {
            function e() {}
            e.format = function(e, t) {
                void 0 === t && (t = {});
                var n = new Date(e)
                  , r = t.format || "YYYY-MM-DD HH:mm:ss"
                  , o = {
                    YYYY: n.getFullYear(),
                    MM: String(n.getMonth() + 1).padStart(2, "0"),
                    DD: String(n.getDate()).padStart(2, "0"),
                    HH: String(n.getHours()).padStart(2, "0"),
                    hh: String(n.getHours() % 12 || 12).padStart(2, "0"),
                    mm: String(n.getMinutes()).padStart(2, "0"),
                    ss: String(n.getSeconds()).padStart(2, "0"),
                    SSS: String(n.getMilliseconds()).padStart(3, "0")
                };
                return r.replace(/YYYY|MM|DD|HH|hh|mm|ss|SSS/g, (function(e) {
                    return String(o[e])
                }
                ))
            }
            ,
            e.getRelativeTime = function(e, t) {
                void 0 === t && (t = new Date);
                var n = new Date(e)
                  , r = new Date(t).getTime() - n.getTime()
                  , o = Math.floor(r / 1e3)
                  , a = Math.floor(o / 60)
                  , i = Math.floor(a / 60)
                  , c = Math.floor(i / 24);
                return c > 365 ? "".concat(Math.floor(c / 365), "\u5e74\u524d") : c > 30 ? "".concat(Math.floor(c / 30), "\u4e2a\u6708\u524d") : c > 0 ? "".concat(c, "\u5929\u524d") : i > 0 ? "".concat(i, "\u5c0f\u65f6\u524d") : a > 0 ? "".concat(a, "\u5206\u949f\u524d") : o >= 0 ? "\u521a\u521a" : "\u672a\u6765"
            }
            ,
            e.isSameDay = function(e, t) {
                var n = new Date(e)
                  , r = new Date(t);
                return n.getFullYear() === r.getFullYear() && n.getMonth() === r.getMonth() && n.getDate() === r.getDate()
            }
        }();
        var c, s = function() {
            function e(e, t, n, o) {
                void 0 === t && (t = "xdf_commom_ecommerce_ab_test"),
                void 0 === n && (n = {}),
                void 0 === o && (o = "_"),
                this.validateConfig(e),
                this.config = e,
                this.cookieKey = "".concat(t).concat(o).concat(e.id),
                this.cookieOptions = r(r({
                    path: "/",
                    sameSite: "Lax",
                    domain: ".xdf.cn"
                }, n), {
                    expires: e.expires
                })
            }
            return e.prototype.getVariant = function() {
                var e = o(this.cookieKey);
                if (e)
                    return e;
                var t = this.assignVariant();
                return a(this.cookieKey, t, this.cookieOptions),
                t
            }
            ,
            e.prototype.reset = function() {
                i(this.cookieKey, {
                    path: this.cookieOptions.path,
                    domain: this.cookieOptions.domain
                })
            }
            ,
            e.prototype.getControlVariant = function() {
                var e = this.config.variants.find((function(e) {
                    return e.isControl
                }
                ));
                return e ? e.id : this.config.variants[0].id
            }
            ,
            e.prototype.isInVariant = function(e) {
                return this.getVariant() === e
            }
            ,
            e.prototype.validateConfig = function(e) {
                if (!e.id || !e.name || !Array.isArray(e.variants))
                    throw new Error("Invalid AB test configuration");
                if (0 === e.variants.length)
                    throw new Error("At least one variant is required");
                var t = e.variants.reduce((function(e, t) {
                    if ("number" !== typeof t.weight || t.weight < 0 || t.weight > 100)
                        throw new Error("Invalid weight for variant ".concat(t.id));
                    return e + t.weight
                }
                ), 0);
                if (Math.abs(t - 100) > .01)
                    throw new Error("Total weight must be 100")
            }
            ,
            e.prototype.assignVariant = function() {
                for (var e = 100 * Math.random(), t = 0, n = 0, r = this.config.variants; n < r.length; n++) {
                    var o = r[n];
                    if (e <= (t += o.weight))
                        return o.id
                }
                return this.config.variants[this.config.variants.length - 1].id
            }
            ,
            e
        }();
        !function(e) {
            e.UNKNOWN = "unknown",
            e.IOS = "ios",
            e.ANDROID = "android",
            e.HARMONY = "harmony",
            e.PC = "pc",
            e.WAP = "wap",
            e.WECHAT_BROWSER = "wechat_browser",
            e.WECHAT_MINIPROGRAM = "wechat_miniprogram",
            e.APP = "app",
            e.XDF_APP = "xdf_app",
            e.XDF_TEACHER_APP = "xdf_teacher_app",
            e.CRAWLER = "crawler"
        }(c || (c = {}));
        var u, d = ["bot", "spider", "crawler", "scraper", "slurp", "baiduspider", "googlebot", "bingbot", "yandexbot", "duckduckbot", "facebookexternalhit", "twitterbot", "rogerbot", "linkedinbot", "embedly", "quora link preview", "showyoubot", "outbrain", "pinterest", "slackbot", "vkshare", "whatsapp", "semrushbot", "screaming frog", "ahrefsbot", "validator", "w3c_validator", "lighthouse", "favicon"];
        function f(e) {
            var t = (e || ("undefined" !== typeof navigator ? navigator.userAgent : "")).toLowerCase();
            return /ipad|iphone|ipod/i.test(t) || /mac/i.test(t) && "undefined" !== typeof navigator && navigator.maxTouchPoints > 1
        }
        function l(e) {
            var t = (e || ("undefined" !== typeof navigator ? navigator.userAgent : "")).toLowerCase();
            return /android/i.test(t)
        }
        function p(e) {
            var t = (e || ("undefined" !== typeof navigator ? navigator.userAgent : "")).toLowerCase();
            return /harmonyos|hongmengos/i.test(t)
        }
        function h(e) {
            var t = (e || ("undefined" !== typeof navigator ? navigator.userAgent : "")).toLowerCase();
            if (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series[46]0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino|android|ipad|playbook|silk|harmonyos|hongmengos/i.test(t) || /mobile/i.test(t))
                return !0;
            if ("undefined" !== typeof navigator && navigator.maxTouchPoints > 1 && -1 !== t.indexOf("macintosh") && -1 !== t.indexOf("safari"))
                return !0;
            if ("undefined" !== typeof window) {
                if (window.innerWidth <= 768 && (-1 !== t.indexOf("iphone") || -1 !== t.indexOf("ipad") || -1 !== t.indexOf("android") || -1 !== t.indexOf("mobile") || /macintosh|windows/i.test(t) && /iphone|android|mobile/i.test(t)))
                    return !0;
                if (window.innerWidth >= 320 && window.innerWidth <= 480)
                    return !0
            }
            return !!/tablet|ipad|playbook|silk|android(?!.*mobile)/i.test(t)
        }
        function m(e) {
            return !h(e)
        }
        function v(e) {
            var t = (e || ("undefined" !== typeof navigator ? navigator.userAgent : "")).toLowerCase();
            return /micromessenger/i.test(t) && !/miniprogram/i.test(t)
        }
        function g(e) {
            var t = (e || ("undefined" !== typeof navigator ? navigator.userAgent : "")).toLowerCase();
            return /micromessenger/i.test(t) && /miniprogram/i.test(t)
        }
        function b(e) {
            var t, n = (e || ("undefined" !== typeof navigator ? navigator.userAgent : "")).toLowerCase();
            return /yourappname/i.test(n) || /xdf/i.test(n) || /xdfwoxueteacher/i.test(n) || "undefined" !== typeof window && (!!window.isInApp || !!window.isInNativeApp || !!(null === (t = window.webkit) || void 0 === t ? void 0 : t.messageHandlers))
        }
        function w(e) {
            var t = (e || ("undefined" !== typeof navigator ? navigator.userAgent : "")).toLowerCase();
            return /xdf/i.test(t)
        }
        function y(e) {
            var t = (e || ("undefined" !== typeof navigator ? navigator.userAgent : "")).toLowerCase();
            return /xdfwoxueteacher/i.test(t)
        }
        function x(e) {
            var t = (e || ("undefined" !== typeof navigator ? navigator.userAgent : "")).toLowerCase();
            return d.some((function(e) {
                return t.includes(e)
            }
            ))
        }
        function O(e) {
            return x(e) ? c.CRAWLER : y(e) ? c.XDF_TEACHER_APP : w(e) ? c.XDF_APP : b(e) ? c.APP : g(e) ? c.WECHAT_MINIPROGRAM : v(e) ? c.WECHAT_BROWSER : h(e) ? f(e) ? c.IOS : l(e) ? c.ANDROID : p(e) ? c.HARMONY : c.WAP : m(e) ? c.PC : c.UNKNOWN
        }
        function j(e) {
            return {
                os: {
                    isIOS: f(e),
                    isAndroid: l(e),
                    isHarmony: p(e)
                },
                env: {
                    isPC: m(e),
                    isMobile: h(e),
                    isApp: b(e),
                    isXDFApp: w(e),
                    isXDFTeacherApp: y(e),
                    isWechatBrowser: v(e),
                    isWechatMiniprogram: g(e)
                },
                isCrawler: x(e),
                type: O(e)
            }
        }
        !function(e) {
            e.WEAK = "weak",
            e.MEDIUM = "medium",
            e.STRONG = "strong",
            e.VERY_STRONG = "very_strong"
        }(u || (u = {}));
        var C = [{
            name: "\u5927\u5b66/\u6210\u4eba",
            code: 1,
            children: [{
                name: "\u5927\u4e00",
                code: 929
            }, {
                name: "\u5927\u4e8c",
                code: 930
            }, {
                name: "\u5927\u4e09",
                code: 931
            }, {
                name: "\u5927\u56db",
                code: 932
            }, {
                name: "\u5927\u4e94",
                code: 933
            }, {
                name: "\u7814\u7a76\u751f\u53ca\u4ee5\u4e0a",
                code: 7
            }, {
                name: "\u5728\u804c",
                code: 937
            }]
        }, {
            name: "\u9ad8\u4e2d",
            code: 2,
            children: [{
                name: "\u9ad8\u4e00",
                code: 866
            }, {
                name: "\u9ad8\u4e8c",
                code: 867
            }, {
                name: "\u9ad8\u4e09",
                code: 868
            }]
        }, {
            name: "\u521d\u4e2d",
            code: 3,
            children: [{
                name: "\u521d\u4e00",
                code: 863
            }, {
                name: "\u521d\u4e8c",
                code: 864
            }, {
                name: "\u521d\u4e09",
                code: 865
            }]
        }, {
            name: "\u5c11\u513f",
            code: 4,
            children: [{
                name: "\u5b66\u9f84\u524d",
                code: 1
            }, {
                name: "\u4e00\u5e74\u7ea7",
                code: 857
            }, {
                name: "\u4e8c\u5e74\u7ea7",
                code: 858
            }, {
                name: "\u4e09\u5e74\u7ea7",
                code: 859
            }, {
                name: "\u56db\u5e74\u7ea7",
                code: 860
            }, {
                name: "\u4e94\u5e74\u7ea7",
                code: 861
            }, {
                name: "\u516d\u5e74\u7ea7",
                code: 862
            }]
        }]
          , k = [2, 3, 4];
        function S(e, t) {
            if (void 0 !== e) {
                var n = "string" === typeof e ? parseInt(e, 10) : e;
                return k.includes(n)
            }
            if (void 0 !== t)
                for (var r = "string" === typeof t ? parseInt(t, 10) : t, o = 0, a = C; o < a.length; o++) {
                    n = a[o];
                    if (k.includes(n.code) && n.children)
                        for (var i = 0, c = n.children; i < c.length; i++) {
                            if (c[i].code === r)
                                return !0
                        }
                }
            return !1
        }
        var _ = Object.freeze({
            __proto__: null,
            isK12: S,
            stageData: C
        })
          , A = {
            1: "\u6625",
            2: "\u6691",
            3: "\u79cb",
            4: "\u5bd2"
        }
          , M = {
            211: "\u9762\u6388",
            223: "\u53cc\u5e08",
            227: "\u5f55\u64ad",
            229: "\u76f4\u64ad",
            233: "\u7ebf\u4e0a",
            239: "\u667a\u6167\u5b66\u4e60"
        }
          , E = {
            1: "\u672a\u5f00\u8bfe",
            2: "\u5df2\u5f00\u8bfe/\u53ef\u63d2\u73ed",
            3: "\u5df2\u5f00\u8bfe/\u53ef\u63d2\u73ed",
            4: "\u5df2\u5f00\u8bfe",
            5: "\u4e0d\u652f\u6301\u7f51\u62a5",
            6: "\u5df2\u62a5\u6ee1"
        }
          , I = {
            undefined: "\u5168\u90e8",
            1: "\u5468\u4e00",
            2: "\u5468\u4e8c",
            3: "\u5468\u4e09",
            4: "\u5468\u56db",
            5: "\u5468\u4e94",
            6: "\u5468\u516d",
            7: "\u5468\u65e5"
        }
          , P = {
            undefined: "\u5168\u90e8",
            0: "\u5047\u671f\u524d",
            1: "\u4e00\u671f",
            2: "\u4e8c\u671f",
            3: "\u4e09\u671f",
            4: "\u56db\u671f",
            5: "\u4e94\u671f",
            6: "\u516d\u671f",
            7: "\u4e03\u671f",
            8: "\u516b\u671f",
            9: "\u4e5d\u671f",
            10: "\u5341\u671f",
            11: "\u5341\u4e00\u671f",
            12: "\u5341\u4e8c\u671f"
        };
        function T(e) {
            return K(A, e)
        }
        function D(e) {
            return Y(A, e)
        }
        function N(e) {
            return K(M, e)
        }
        function R(e) {
            return Y(M, e)
        }
        function H(e) {
            return K(E, e)
        }
        function B(e) {
            return Y(E, e)
        }
        function F(e) {
            return K(I, e)
        }
        function W(e) {
            return Y(I, e)
        }
        function U(e) {
            return K(P, e)
        }
        function L(e) {
            return Y(P, e)
        }
        function K(e, t) {
            return void 0 === t || null === t || "" === t ? "" : String(t).split(",").map((function(t) {
                var n = t.trim();
                if ("undefined" === n)
                    return e[void 0] || "";
                if ("0" === n)
                    return e[0] || "";
                var r = Number(n);
                return e[r] || ""
            }
            )).filter(Boolean).join(",")
        }
        function Y(e, t) {
            if (!t)
                return "";
            var n = t.split(",")
              , r = {};
            return Object.entries(e).forEach((function(e) {
                var t = e[0]
                  , n = e[1];
                r[n] = t
            }
            )),
            n.map((function(e) {
                var t = e.trim();
                return void 0 !== r[t] ? String(r[t]) : ""
            }
            )).filter(Boolean).join(",")
        }
        var q = {
            SeasonEnum: A,
            TeachingMethodEnum: M,
            CourseStatusEnum: E,
            WeekEnum: I,
            PeriodEnum: P,
            getSeasonName: T,
            getSeasonCode: D,
            getTeachingMethodName: N,
            getTeachingMethodCode: R,
            getCourseStatusName: H,
            getCourseStatusCode: B,
            getWeekName: F,
            getWeekCode: W,
            getPeriodName: U,
            getPeriodCode: L
        }
          , X = Object.freeze({
            __proto__: null,
            CourseStatusEnum: E,
            PeriodEnum: P,
            SeasonEnum: A,
            TeachingMethodEnum: M,
            WeekEnum: I,
            default: q,
            getCourseStatusCode: B,
            getCourseStatusName: H,
            getPeriodCode: L,
            getPeriodName: U,
            getSeasonCode: D,
            getSeasonName: T,
            getTeachingMethodCode: R,
            getTeachingMethodName: N,
            getWeekCode: W,
            getWeekName: F
        });
        r(r({}, _), X);
        new (function() {
            function e() {
                this.callbacks = {},
                this.inApp = !1,
                this.inApp = w()
            }
            return e.prototype.generateUUID = function() {
                var e = (new Date).getTime();
                return "undefined" !== typeof performance && "function" === typeof performance.now && (e += performance.now()),
                "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (function(t) {
                    var n = (e + 16 * Math.random()) % 16 | 0;
                    return e = Math.floor(e / 16),
                    ("x" === t ? n : 3 & n | 8).toString(16)
                }
                ))
            }
            ,
            e.prototype.packFunction = function(e, t, n) {
                e = e || "",
                t = t || {};
                var r = "";
                n && (r = this.generateUUID(),
                this.callbacks[r] = n);
                var o = {
                    function: e,
                    param: t,
                    callbackId: r
                };
                if (this.inApp)
                    if ("undefined" === typeof window.xdfhybirdAndroid) {
                        var a = window.webkit
                          , i = null === a || void 0 === a ? void 0 : a.messageHandlers
                          , c = null === i || void 0 === i ? void 0 : i.xdfhybirdiOS;
                        c && c.postMessage(o)
                    } else
                        window.xdfhybirdAndroid.postMessage(JSON.stringify(o))
            }
            ,
            e.prototype.openURL = function(e, t) {
                t = t || {},
                this.packFunction("openURL", {
                    url: e,
                    param: t
                })
            }
            ,
            e.prototype.receiveCallback = function(e, t) {
                e && this.callbacks[e] && (this.callbacks[e](t),
                delete this.callbacks[e])
            }
            ,
            e
        }())
    },
    Xuae: function(e, t, n) {
        "use strict";
        var r = n("mPvQ")
          , o = n("/GRZ")
          , a = n("i2R6")
          , i = (n("qXWd"),
        n("48fX"))
          , c = n("tCBg")
          , s = n("T0f4");
        function u(e) {
            var t = function() {
                if ("undefined" === typeof Reflect || !Reflect.construct)
                    return !1;
                if (Reflect.construct.sham)
                    return !1;
                if ("function" === typeof Proxy)
                    return !0;
                try {
                    return Date.prototype.toString.call(Reflect.construct(Date, [], (function() {}
                    ))),
                    !0
                } catch (e) {
                    return !1
                }
            }();
            return function() {
                var n, r = s(e);
                if (t) {
                    var o = s(this).constructor;
                    n = Reflect.construct(r, arguments, o)
                } else
                    n = r.apply(this, arguments);
                return c(this, n)
            }
        }
        t.__esModule = !0,
        t.default = void 0;
        var d = n("q1tI")
          , f = function(e) {
            i(n, e);
            var t = u(n);
            function n(e) {
                var a;
                return o(this, n),
                (a = t.call(this, e))._hasHeadManager = void 0,
                a.emitChange = function() {
                    a._hasHeadManager && a.props.headManager.updateHead(a.props.reduceComponentsToState(r(a.props.headManager.mountedInstances), a.props))
                }
                ,
                a._hasHeadManager = a.props.headManager && a.props.headManager.mountedInstances,
                a
            }
            return a(n, [{
                key: "componentDidMount",
                value: function() {
                    this._hasHeadManager && this.props.headManager.mountedInstances.add(this),
                    this.emitChange()
                }
            }, {
                key: "componentDidUpdate",
                value: function() {
                    this.emitChange()
                }
            }, {
                key: "componentWillUnmount",
                value: function() {
                    this._hasHeadManager && this.props.headManager.mountedInstances.delete(this),
                    this.emitChange()
                }
            }, {
                key: "render",
                value: function() {
                    return null
                }
            }]),
            n
        }(d.Component);
        t.default = f
    },
    aCH8: function(e, t, n) {
        !function() {
            var t = n("ANhw")
              , r = n("mmNF").utf8
              , o = n("BEtg")
              , a = n("mmNF").bin
              , i = function(e, n) {
                e.constructor == String ? e = n && "binary" === n.encoding ? a.stringToBytes(e) : r.stringToBytes(e) : o(e) ? e = Array.prototype.slice.call(e, 0) : Array.isArray(e) || e.constructor === Uint8Array || (e = e.toString());
                for (var c = t.bytesToWords(e), s = 8 * e.length, u = 1732584193, d = -271733879, f = -1732584194, l = 271733878, p = 0; p < c.length; p++)
                    c[p] = 16711935 & (c[p] << 8 | c[p] >>> 24) | 4278255360 & (c[p] << 24 | c[p] >>> 8);
                c[s >>> 5] |= 128 << s % 32,
                c[14 + (s + 64 >>> 9 << 4)] = s;
                var h = i._ff
                  , m = i._gg
                  , v = i._hh
                  , g = i._ii;
                for (p = 0; p < c.length; p += 16) {
                    var b = u
                      , w = d
                      , y = f
                      , x = l;
                    u = h(u, d, f, l, c[p + 0], 7, -680876936),
                    l = h(l, u, d, f, c[p + 1], 12, -389564586),
                    f = h(f, l, u, d, c[p + 2], 17, 606105819),
                    d = h(d, f, l, u, c[p + 3], 22, -1044525330),
                    u = h(u, d, f, l, c[p + 4], 7, -176418897),
                    l = h(l, u, d, f, c[p + 5], 12, 1200080426),
                    f = h(f, l, u, d, c[p + 6], 17, -1473231341),
                    d = h(d, f, l, u, c[p + 7], 22, -45705983),
                    u = h(u, d, f, l, c[p + 8], 7, 1770035416),
                    l = h(l, u, d, f, c[p + 9], 12, -1958414417),
                    f = h(f, l, u, d, c[p + 10], 17, -42063),
                    d = h(d, f, l, u, c[p + 11], 22, -1990404162),
                    u = h(u, d, f, l, c[p + 12], 7, 1804603682),
                    l = h(l, u, d, f, c[p + 13], 12, -40341101),
                    f = h(f, l, u, d, c[p + 14], 17, -1502002290),
                    u = m(u, d = h(d, f, l, u, c[p + 15], 22, 1236535329), f, l, c[p + 1], 5, -165796510),
                    l = m(l, u, d, f, c[p + 6], 9, -1069501632),
                    f = m(f, l, u, d, c[p + 11], 14, 643717713),
                    d = m(d, f, l, u, c[p + 0], 20, -373897302),
                    u = m(u, d, f, l, c[p + 5], 5, -701558691),
                    l = m(l, u, d, f, c[p + 10], 9, 38016083),
                    f = m(f, l, u, d, c[p + 15], 14, -660478335),
                    d = m(d, f, l, u, c[p + 4], 20, -405537848),
                    u = m(u, d, f, l, c[p + 9], 5, 568446438),
                    l = m(l, u, d, f, c[p + 14], 9, -1019803690),
                    f = m(f, l, u, d, c[p + 3], 14, -187363961),
                    d = m(d, f, l, u, c[p + 8], 20, 1163531501),
                    u = m(u, d, f, l, c[p + 13], 5, -1444681467),
                    l = m(l, u, d, f, c[p + 2], 9, -51403784),
                    f = m(f, l, u, d, c[p + 7], 14, 1735328473),
                    u = v(u, d = m(d, f, l, u, c[p + 12], 20, -1926607734), f, l, c[p + 5], 4, -378558),
                    l = v(l, u, d, f, c[p + 8], 11, -2022574463),
                    f = v(f, l, u, d, c[p + 11], 16, 1839030562),
                    d = v(d, f, l, u, c[p + 14], 23, -35309556),
                    u = v(u, d, f, l, c[p + 1], 4, -1530992060),
                    l = v(l, u, d, f, c[p + 4], 11, 1272893353),
                    f = v(f, l, u, d, c[p + 7], 16, -155497632),
                    d = v(d, f, l, u, c[p + 10], 23, -1094730640),
                    u = v(u, d, f, l, c[p + 13], 4, 681279174),
                    l = v(l, u, d, f, c[p + 0], 11, -358537222),
                    f = v(f, l, u, d, c[p + 3], 16, -722521979),
                    d = v(d, f, l, u, c[p + 6], 23, 76029189),
                    u = v(u, d, f, l, c[p + 9], 4, -640364487),
                    l = v(l, u, d, f, c[p + 12], 11, -421815835),
                    f = v(f, l, u, d, c[p + 15], 16, 530742520),
                    u = g(u, d = v(d, f, l, u, c[p + 2], 23, -995338651), f, l, c[p + 0], 6, -198630844),
                    l = g(l, u, d, f, c[p + 7], 10, 1126891415),
                    f = g(f, l, u, d, c[p + 14], 15, -1416354905),
                    d = g(d, f, l, u, c[p + 5], 21, -57434055),
                    u = g(u, d, f, l, c[p + 12], 6, 1700485571),
                    l = g(l, u, d, f, c[p + 3], 10, -1894986606),
                    f = g(f, l, u, d, c[p + 10], 15, -1051523),
                    d = g(d, f, l, u, c[p + 1], 21, -2054922799),
                    u = g(u, d, f, l, c[p + 8], 6, 1873313359),
                    l = g(l, u, d, f, c[p + 15], 10, -30611744),
                    f = g(f, l, u, d, c[p + 6], 15, -1560198380),
                    d = g(d, f, l, u, c[p + 13], 21, 1309151649),
                    u = g(u, d, f, l, c[p + 4], 6, -145523070),
                    l = g(l, u, d, f, c[p + 11], 10, -1120210379),
                    f = g(f, l, u, d, c[p + 2], 15, 718787259),
                    d = g(d, f, l, u, c[p + 9], 21, -343485551),
                    u = u + b >>> 0,
                    d = d + w >>> 0,
                    f = f + y >>> 0,
                    l = l + x >>> 0
                }
                return t.endian([u, d, f, l])
            };
            i._ff = function(e, t, n, r, o, a, i) {
                var c = e + (t & n | ~t & r) + (o >>> 0) + i;
                return (c << a | c >>> 32 - a) + t
            }
            ,
            i._gg = function(e, t, n, r, o, a, i) {
                var c = e + (t & r | n & ~r) + (o >>> 0) + i;
                return (c << a | c >>> 32 - a) + t
            }
            ,
            i._hh = function(e, t, n, r, o, a, i) {
                var c = e + (t ^ n ^ r) + (o >>> 0) + i;
                return (c << a | c >>> 32 - a) + t
            }
            ,
            i._ii = function(e, t, n, r, o, a, i) {
                var c = e + (n ^ (t | ~r)) + (o >>> 0) + i;
                return (c << a | c >>> 32 - a) + t
            }
            ,
            i._blocksize = 16,
            i._digestsize = 16,
            e.exports = function(e, n) {
                if (void 0 === e || null === e)
                    throw new Error("Illegal argument " + e);
                var r = t.wordsToBytes(i(e, n));
                return n && n.asBytes ? r : n && n.asString ? a.bytesToString(r) : t.bytesToHex(r)
            }
        }()
    },
    g4pe: function(e, t, n) {
        e.exports = n("8Kt/")
    },
    iFgM: function(e, t, n) {},
    kG2m: function(e, t) {
        e.exports = function() {
            throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")
        }
    },
    lwAK: function(e, t, n) {
        "use strict";
        var r;
        t.__esModule = !0,
        t.AmpStateContext = void 0;
        var o = ((r = n("q1tI")) && r.__esModule ? r : {
            default: r
        }).default.createContext({});
        t.AmpStateContext = o
    },
    mPvQ: function(e, t, n) {
        var r = n("5fIB")
          , o = n("rlHP")
          , a = n("KckH")
          , i = n("kG2m");
        e.exports = function(e) {
            return r(e) || o(e) || a(e) || i()
        }
    },
    mmNF: function(e, t) {
        var n = {
            utf8: {
                stringToBytes: function(e) {
                    return n.bin.stringToBytes(unescape(encodeURIComponent(e)))
                },
                bytesToString: function(e) {
                    return decodeURIComponent(escape(n.bin.bytesToString(e)))
                }
            },
            bin: {
                stringToBytes: function(e) {
                    for (var t = [], n = 0; n < e.length; n++)
                        t.push(255 & e.charCodeAt(n));
                    return t
                },
                bytesToString: function(e) {
                    for (var t = [], n = 0; n < e.length; n++)
                        t.push(String.fromCharCode(e[n]));
                    return t.join("")
                }
            }
        };
        e.exports = n
    },
    qXWd: function(e, t) {
        e.exports = function(e) {
            if (void 0 === e)
                throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
            return e
        }
    },
    tCBg: function(e, t, n) {
        var r = n("C+bE")
          , o = n("qXWd");
        e.exports = function(e, t) {
            return !t || "object" !== r(t) && "function" !== typeof t ? o(e) : t
        }
    }
}]);
