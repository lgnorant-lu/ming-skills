window = global



const crypto = require('crypto');


(function(t) {
                var e, n, r;
                n = (e = t).lib.Base,
                r = e.enc.Utf8,
                e.algo.HMAC = n.extend({
                    init: function(t, e) {
                        t = this._hasher = new t.init,
                        "string" == typeof e && (e = r.parse(e));
                        var n = t.blockSize
                          , o = 4 * n;
                        e.sigBytes > o && (e = t.finalize(e)),
                        e.clamp();
                        for (var i = this._oKey = e.clone(), a = this._iKey = e.clone(), s = i.words, u = a.words, f = 0; f < n; f++)
                            s[f] ^= 1549556828,
                            u[f] ^= 909522486;
                        i.sigBytes = a.sigBytes = o,
                        this.reset()
                    },
                    reset: function() {
                        var t = this._hasher;
                        t.reset(),
                        t.update(this._iKey)
                    },
                    update: function(t) {
                        return this._hasher.update(t),
                        this
                    },
                    finalize: function(t) {
                        var e = this._hasher
                          , n = e.finalize(t);
                        return e.reset(),
                        e.finalize(this._oKey.clone().concat(n))
                    }
                })
            })

// 算法
_xl = (0, (function() {
                var t = t || function(t, e) {
                    var n = Object.create || function() {
                        function t() {}
                        return function(e) {
                            var n;
                            return t.prototype = e,
                            n = new t,
                            t.prototype = null,
                            n
                        }
                    }()
                      , r = {}
                      , o = r.lib = {}
                      , i = o.Base = {
                        extend: function(t) {
                            var e = n(this);
                            return t && e.mixIn(t),
                            e.hasOwnProperty("init") && this.init !== e.init || (e.init = function() {
                                e.$super.init.apply(this, arguments)
                            }
                            ),
                            e.init.prototype = e,
                            e.$super = this,
                            e
                        },
                        create: function() {
                            var t = this.extend();
                            return t.init.apply(t, arguments),
                            t
                        },
                        init: function() {},
                        mixIn: function(t) {
                            for (var e in t)
                                t.hasOwnProperty(e) && (this[e] = t[e]);
                            t.hasOwnProperty("toString") && (this.toString = t.toString)
                        },
                        clone: function() {
                            return this.init.prototype.extend(this)
                        }
                    }
                      , a = o.WordArray = i.extend({
                        init: function(t, n) {
                            t = this.words = t || [],
                            this.sigBytes = n != e ? n : 4 * t.length
                        },
                        toString: function(t) {
                            return (t || u).stringify(this)
                        },
                        concat: function(t) {
                            var e = this.words
                              , n = t.words
                              , r = this.sigBytes
                              , o = t.sigBytes;
                            if (this.clamp(),
                            r % 4)
                                for (var i = 0; i < o; i++) {
                                    var a = n[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                                    e[r + i >>> 2] |= a << 24 - (r + i) % 4 * 8
                                }
                            else
                                for (i = 0; i < o; i += 4)
                                    e[r + i >>> 2] = n[i >>> 2];
                            return this.sigBytes += o,
                            this
                        },
                        clamp: function() {
                            var e = this.words
                              , n = this.sigBytes;
                            e[n >>> 2] &= 4294967295 << 32 - n % 4 * 8,
                            e.length = t.ceil(n / 4)
                        },
                        clone: function() {
                            var t = i.clone.call(this);
                            return t.words = this.words.slice(0),
                            t
                        },
                        random: function(e) {
                            for (var n, r = [], o = function(e) {
                                var n = 987654321
                                  , r = 4294967295;
                                return function() {
                                    var o = ((n = 36969 * (65535 & n) + (n >> 16) & r) << 16) + (e = 18e3 * (65535 & e) + (e >> 16) & r) & r;
                                    return o /= 4294967296,
                                    (o += .5) * (t.random() > .5 ? 1 : -1)
                                }
                            }, i = 0; i < e; i += 4) {
                                var s = o(4294967296 * (n || t.random()));
                                n = 987654071 * s(),
                                r.push(4294967296 * s() | 0)
                            }
                            return new a.init(r,e)
                        }
                    })
                      , s = r.enc = {}
                      , u = s.Hex = {
                        stringify: function(t) {
                            for (var e = t.words, n = t.sigBytes, r = [], o = 0; o < n; o++) {
                                var i = e[o >>> 2] >>> 24 - o % 4 * 8 & 255;
                                r.push((i >>> 4).toString(16)),
                                r.push((15 & i).toString(16))
                            }
                            return r.join("")
                        },
                        parse: function(t) {
                            for (var e = t.length, n = [], r = 0; r < e; r += 2)
                                n[r >>> 3] |= parseInt(t.substr(r, 2), 16) << 24 - r % 8 * 4;
                            return new a.init(n,e / 2)
                        }
                    }
                      , f = s.Latin1 = {
                        stringify: function(t) {
                            for (var e = t.words, n = t.sigBytes, r = [], o = 0; o < n; o++) {
                                var i = e[o >>> 2] >>> 24 - o % 4 * 8 & 255;
                                r.push(String.fromCharCode(i))
                            }
                            return r.join("")
                        },
                        parse: function(t) {
                            for (var e = t.length, n = [], r = 0; r < e; r++)
                                n[r >>> 2] |= (255 & t.charCodeAt(r)) << 24 - r % 4 * 8;
                            return new a.init(n,e)
                        }
                    }
                      , l = s.Utf8 = {
                        stringify: function(t) {
                            try {
                                return decodeURIComponent(escape(f.stringify(t)))
                            } catch (t) {
                                throw new Error("Malformed UTF-8 data")
                            }
                        },
                        parse: function(t) {
                            return f.parse(unescape(encodeURIComponent(t)))
                        }
                    }
                      , c = o.BufferedBlockAlgorithm = i.extend({
                        reset: function() {
                            this._data = new a.init,
                            this._nDataBytes = 0
                        },
                        _append: function(t) {
                            "string" == typeof t && (t = l.parse(t)),
                            this._data.concat(t),
                            this._nDataBytes += t.sigBytes
                        },
                        _process: function(e) {
                            var n = this._data
                              , r = n.words
                              , o = n.sigBytes
                              , i = this.blockSize
                              , s = o / (4 * i)
                              , u = (s = e ? t.ceil(s) : t.max((0 | s) - this._minBufferSize, 0)) * i
                              , f = t.min(4 * u, o);
                            if (u) {
                                for (var l = 0; l < u; l += i)
                                    this._doProcessBlock(r, l);
                                var c = r.splice(0, u);
                                n.sigBytes -= f
                            }
                            return new a.init(c,f)
                        },
                        clone: function() {
                            var t = i.clone.call(this);
                            return t._data = this._data.clone(),
                            t
                        },
                        _minBufferSize: 0
                    })
                      , p = (o.Hasher = c.extend({
                        cfg: i.extend(),
                        init: function(t) {
                            this.cfg = this.cfg.extend(t),
                            this.reset()
                        },
                        reset: function() {
                            c.reset.call(this),
                            this._doReset()
                        },
                        update: function(t) {
                            return this._append(t),
                            this._process(),
                            this
                        },
                        finalize: function(t) {
                            return t && this._append(t),
                            this._doFinalize()
                        },
                        blockSize: 16,
                        _createHelper: function(t) {
                            return function(e, n) {
                                return new t.init(n).finalize(e)
                            }
                        },
                        _createHmacHelper: function(t) {
                            return function(e, n) {
                                return new p.HMAC.init(t,n).finalize(e)
                            }
                        }
                    }),
                    r.algo = {});
                    return r
                }(Math);

                return function(e) {
                    var n = t
                      , r = n.lib
                      , o = r.Base
                      , i = r.WordArray
                      , a = n.x64 = {};
                    a.Word = o.extend({
                        init: function(t, e) {
                            this.high = t,
                            this.low = e
                        }
                    }),
                    a.WordArray = o.extend({
                        init: function(t, n) {
                            t = this.words = t || [],
                            this.sigBytes = n != e ? n : 8 * t.length
                        },
                        toX32: function() {
                            for (var t = this.words, e = t.length, n = [], r = 0; r < e; r++) {
                                var o = t[r];
                                n.push(o.high),
                                n.push(o.low)
                            }
                            return i.create(n, this.sigBytes)
                        },
                        clone: function() {
                            for (var t = o.clone.call(this), e = t.words = this.words.slice(0), n = e.length, r = 0; r < n; r++)
                                e[r] = e[r].clone();
                            return t
                        }
                    })
                }(), function() {
                    var e = t
                      , n = e.lib.Hasher
                      , r = e.x64
                      , o = r.Word
                      , i = r.WordArray
                      , a = e.algo;
                    function s() {
                        return o.create.apply(o, arguments)
                    }
                    var u = [s(1116352408, 3609767458), s(1899447441, 602891725), s(3049323471, 3964484399), s(3921009573, 2173295548), s(961987163, 4081628472), s(1508970993, 3053834265), s(2453635748, 2937671579), s(2870763221, 3664609560), s(3624381080, 2734883394), s(310598401, 1164996542), s(607225278, 1323610764), s(1426881987, 3590304994), s(1925078388, 4068182383), s(2162078206, 991336113), s(2614888103, 633803317), s(3248222580, 3479774868), s(3835390401, 2666613458), s(4022224774, 944711139), s(264347078, 2341262773), s(604807628, 2007800933), s(770255983, 1495990901), s(1249150122, 1856431235), s(1555081692, 3175218132), s(1996064986, 2198950837), s(2554220882, 3999719339), s(2821834349, 766784016), s(2952996808, 2566594879), s(3210313671, 3203337956), s(3336571891, 1034457026), s(3584528711, 2466948901), s(113926993, 3758326383), s(338241895, 168717936), s(666307205, 1188179964), s(773529912, 1546045734), s(1294757372, 1522805485), s(1396182291, 2643833823), s(1695183700, 2343527390), s(1986661051, 1014477480), s(2177026350, 1206759142), s(2456956037, 344077627), s(2730485921, 1290863460), s(2820302411, 3158454273), s(3259730800, 3505952657), s(3345764771, 106217008), s(3516065817, 3606008344), s(3600352804, 1432725776), s(4094571909, 1467031594), s(275423344, 851169720), s(430227734, 3100823752), s(506948616, 1363258195), s(659060556, 3750685593), s(883997877, 3785050280), s(958139571, 3318307427), s(1322822218, 3812723403), s(1537002063, 2003034995), s(1747873779, 3602036899), s(1955562222, 1575990012), s(2024104815, 1125592928), s(2227730452, 2716904306), s(2361852424, 442776044), s(2428436474, 593698344), s(2756734187, 3733110249), s(3204031479, 2999351573), s(3329325298, 3815920427), s(3391569614, 3928383900), s(3515267271, 566280711), s(3940187606, 3454069534), s(4118630271, 4000239992), s(116418474, 1914138554), s(174292421, 2731055270), s(289380356, 3203993006), s(460393269, 320620315), s(685471733, 587496836), s(852142971, 1086792851), s(1017036298, 365543100), s(1126000580, 2618297676), s(1288033470, 3409855158), s(1501505948, 4234509866), s(1607167915, 987167468), s(1816402316, 1246189591)]
                      , f = [];
                    !function() {
                        for (var t = 0; t < 80; t++)
                            f[t] = s()
                    }();
                    var l = a.SHA512 = n.extend({
                        _doReset: function() {
                            this._hash = new i.init([new o.init(1779033703,4089235720), new o.init(3144134277,2227873595), new o.init(1013904242,4271175723), new o.init(2773480762,1595750129), new o.init(1359893119,2917565137), new o.init(2600822924,725511199), new o.init(528734635,4215389547), new o.init(1541459225,327033209)])
                        },
                        _doProcessBlock: function(t, e) {
                            for (var n = this._hash.words, r = n[0], o = n[1], i = n[2], a = n[3], s = n[4], l = n[5], c = n[6], p = n[7], d = r.high, h = r.low, v = o.high, y = o.low, g = i.high, m = i.low, b = a.high, _ = a.low, w = s.high, x = s.low, T = l.high, S = l.low, O = c.high, E = c.low, k = p.high, A = p.low, j = d, C = h, P = v, M = y, R = g, D = m, I = b, F = _, N = w, L = x, $ = T, B = S, U = O, W = E, z = k, Y = A, H = 0; H < 80; H++) {
                                var V = f[H];
                                if (H < 16)
                                    var q = V.high = 0 | t[e + 2 * H]
                                      , X = V.low = 0 | t[e + 2 * H + 1];
                                else {
                                    var G = f[H - 15]
                                      , K = G.high
                                      , J = G.low
                                      , Z = (K >>> 1 | J << 31) ^ (K >>> 8 | J << 24) ^ K >>> 7
                                      , Q = (J >>> 1 | K << 31) ^ (J >>> 8 | K << 24) ^ (J >>> 7 | K << 25)
                                      , tt = f[H - 2]
                                      , et = tt.high
                                      , nt = tt.low
                                      , rt = (et >>> 19 | nt << 13) ^ (et << 3 | nt >>> 29) ^ et >>> 6
                                      , ot = (nt >>> 19 | et << 13) ^ (nt << 3 | et >>> 29) ^ (nt >>> 6 | et << 26)
                                      , it = f[H - 7]
                                      , at = it.high
                                      , st = it.low
                                      , ut = f[H - 16]
                                      , ft = ut.high
                                      , lt = ut.low;
                                    q = (q = (q = Z + at + ((X = Q + st) >>> 0 < Q >>> 0 ? 1 : 0)) + rt + ((X += ot) >>> 0 < ot >>> 0 ? 1 : 0)) + ft + ((X += lt) >>> 0 < lt >>> 0 ? 1 : 0),
                                    V.high = q,
                                    V.low = X
                                }
                                var ct, pt = N & $ ^ ~N & U, dt = L & B ^ ~L & W, ht = j & P ^ j & R ^ P & R, vt = C & M ^ C & D ^ M & D, yt = (j >>> 28 | C << 4) ^ (j << 30 | C >>> 2) ^ (j << 25 | C >>> 7), gt = (C >>> 28 | j << 4) ^ (C << 30 | j >>> 2) ^ (C << 25 | j >>> 7), mt = (N >>> 14 | L << 18) ^ (N >>> 18 | L << 14) ^ (N << 23 | L >>> 9), bt = (L >>> 14 | N << 18) ^ (L >>> 18 | N << 14) ^ (L << 23 | N >>> 9), _t = u[H], wt = _t.high, xt = _t.low, Tt = z + mt + ((ct = Y + bt) >>> 0 < Y >>> 0 ? 1 : 0), St = gt + vt;
                                z = U,
                                Y = W,
                                U = $,
                                W = B,
                                $ = N,
                                B = L,
                                N = I + (Tt = (Tt = (Tt = Tt + pt + ((ct += dt) >>> 0 < dt >>> 0 ? 1 : 0)) + wt + ((ct += xt) >>> 0 < xt >>> 0 ? 1 : 0)) + q + ((ct += X) >>> 0 < X >>> 0 ? 1 : 0)) + ((L = F + ct | 0) >>> 0 < F >>> 0 ? 1 : 0) | 0,
                                I = R,
                                F = D,
                                R = P,
                                D = M,
                                P = j,
                                M = C,
                                j = Tt + (yt + ht + (St >>> 0 < gt >>> 0 ? 1 : 0)) + ((C = ct + St | 0) >>> 0 < ct >>> 0 ? 1 : 0) | 0
                            }
                            h = r.low = h + C,
                            r.high = d + j + (h >>> 0 < C >>> 0 ? 1 : 0),
                            y = o.low = y + M,
                            o.high = v + P + (y >>> 0 < M >>> 0 ? 1 : 0),
                            m = i.low = m + D,
                            i.high = g + R + (m >>> 0 < D >>> 0 ? 1 : 0),
                            _ = a.low = _ + F,
                            a.high = b + I + (_ >>> 0 < F >>> 0 ? 1 : 0),
                            x = s.low = x + L,
                            s.high = w + N + (x >>> 0 < L >>> 0 ? 1 : 0),
                            S = l.low = S + B,
                            l.high = T + $ + (S >>> 0 < B >>> 0 ? 1 : 0),
                            E = c.low = E + W,
                            c.high = O + U + (E >>> 0 < W >>> 0 ? 1 : 0),
                            A = p.low = A + Y,
                            p.high = k + z + (A >>> 0 < Y >>> 0 ? 1 : 0)
                        },
                        _doFinalize: function() {
                            var t = this._data
                              , e = t.words
                              , n = 8 * this._nDataBytes
                              , r = 8 * t.sigBytes;
                            return e[r >>> 5] |= 128 << 24 - r % 32,
                            e[30 + (r + 128 >>> 10 << 5)] = Math.floor(n / 4294967296),
                            e[31 + (r + 128 >>> 10 << 5)] = n,
                            t.sigBytes = 4 * e.length,
                            this._process(),
                            this._hash.toX32()
                        },
                        clone: function() {
                            var t = n.clone.call(this);
                            return t._hash = this._hash.clone(),
                            t
                        },
                        blockSize: 32
                    });
                    e.SHA512 = n._createHelper(l),
                    e.HmacSHA512 = n._createHmacHelper(l)
                }(),
                    t
            }))



_codes = {
    "n": 20,
    "codes": {
        "0": "W",
        "1": "l",
        "2": "k",
        "3": "B",
        "4": "Q",
        "5": "g",
        "6": "f",
        "7": "i",
        "8": "i",
        "9": "r",
        "10": "v",
        "11": "6",
        "12": "A",
        "13": "K",
        "14": "N",
        "15": "k",
        "16": "4",
        "17": "L",
        "18": "1",
        "19": "8"
    }
}

function _hamc(arg1,arg2){
    return crypto.createHmac('sha512', arg2).update(arg1).digest('hex');
}

var a =  function(e, t) {
                // 这里算法  进行数据加密
                return _hamc(e, t).toString()
            }


var o = function() {
    for (var e = (arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : "/").toLowerCase(), t = e + e, n = "", i = 0; i < t.length; ++i) {
        var o = t[i].charCodeAt() % _codes.n;
        n += _codes.codes[o]
    }
    return n;
}

var s = function (){
    var e = {}
      , t = (arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : "/").toLowerCase()
      , n = JSON.stringify(e).toLowerCase();
    return a(t + n, o(t)).toLowerCase().substr(8, 20)
    // return o(t)
}

t = '/api/datalist/mainmember?isnewagg=true&keyno=5dffb644394922f9073544a08f38be9f&nodename=ipoemployees&pageindex=1'

var i = s(t, undefined)

var _default = function _default() {
    var list = ["w", "i", "n", "d", "o", "w", ".", "t", "i", "d"];
    return eval(list.join(""))
}

var e = function () {
    var e = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : {}
        , t = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : ""
        , n = (arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : "/").toLowerCase()
        , i = JSON.stringify(e).toLowerCase();
    return a(n + "pathString" + i + t, o(n))
}


var u = e(t, undefined, _default());


console.log(i)
console.log(u)


// var u = r.default(t, e.data, (s.default)())

// headers加密位置
// e.headers[i] = u