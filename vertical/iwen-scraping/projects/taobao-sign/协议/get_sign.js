
function c(e) {
    function t(e, t) {
        return e << t | e >>> 32 - t
    }
    function n(e, t) {
        var n, r, o, i, a;
        return o = 2147483648 & e,
        i = 2147483648 & t,
        a = (1073741823 & e) + (1073741823 & t),
        (n = 1073741824 & e) & (r = 1073741824 & t) ? 2147483648 ^ a ^ o ^ i : n | r ? 1073741824 & a ? 3221225472 ^ a ^ o ^ i : 1073741824 ^ a ^ o ^ i : a ^ o ^ i
    }
    function r(e, t, n) {
        return e & t | ~e & n
    }
    function o(e, t, n) {
        return e & n | t & ~n
    }
    function i(e, t, n) {
        return e ^ t ^ n
    }
    function a(e, t, n) {
        return t ^ (e | ~n)
    }
    function s(e, o, i, a, s, u, c) {
        return e = n(e, n(n(r(o, i, a), s), c)),
        n(t(e, u), o)
    }
    function u(e, r, i, a, s, u, c) {
        return e = n(e, n(n(o(r, i, a), s), c)),
        n(t(e, u), r)
    }
    function c(e, r, o, a, s, u, c) {
        return e = n(e, n(n(i(r, o, a), s), c)),
        n(t(e, u), r)
    }
    function l(e, r, o, i, s, u, c) {
        return e = n(e, n(n(a(r, o, i), s), c)),
        n(t(e, u), r)
    }
    function f(e) {
        for (var t, n = e.length, r = n + 8, o, i = 16 * ((r - r % 64) / 64 + 1), a = new Array(i - 1), s = 0, u = 0; n > u; )
            s = u % 4 * 8,
            a[t = (u - u % 4) / 4] = a[t] | e.charCodeAt(u) << s,
            u++;
        return s = u % 4 * 8,
        a[t = (u - u % 4) / 4] = a[t] | 128 << s,
        a[i - 2] = n << 3,
        a[i - 1] = n >>> 29,
        a
    }
    function d(e) {
        var t, n, r = "", o = "";
        for (n = 0; 3 >= n; n++)
            r += (o = "0" + (t = e >>> 8 * n & 255).toString(16)).substr(o.length - 2, 2);
        return r
    }
    function p(e) {
        e = e.replace(/\r\n/g, "\n");
        for (var t = "", n = 0; n < e.length; n++) {
            var r = e.charCodeAt(n);
            128 > r ? t += String.fromCharCode(r) : r > 127 && 2048 > r ? (t += String.fromCharCode(r >> 6 | 192),
            t += String.fromCharCode(63 & r | 128)) : (t += String.fromCharCode(r >> 12 | 224),
            t += String.fromCharCode(r >> 6 & 63 | 128),
            t += String.fromCharCode(63 & r | 128))
        }
        return t
    }
    var h, m, y, v, g, b, _, w, S, x = [], k = 7, E = 12, L = 17, M = 22, T = 5, O = 9, C = 14, P = 20, j = 4, A = 11, D = 16, I = 23, N = 6, R = 10, Y = 15, F = 21, H;
    for (x = f(e = p(e)),
    b = 1732584193,
    _ = 4023233417,
    w = 2562383102,
    S = 271733878,
    h = 0; h < x.length; h += 16)
        m = b,
        y = _,
        v = w,
        g = S,
        b = s(b, _, w, S, x[h + 0], 7, 3614090360),
        S = s(S, b, _, w, x[h + 1], E, 3905402710),
        w = s(w, S, b, _, x[h + 2], L, 606105819),
        _ = s(_, w, S, b, x[h + 3], M, 3250441966),
        b = s(b, _, w, S, x[h + 4], 7, 4118548399),
        S = s(S, b, _, w, x[h + 5], E, 1200080426),
        w = s(w, S, b, _, x[h + 6], L, 2821735955),
        _ = s(_, w, S, b, x[h + 7], M, 4249261313),
        b = s(b, _, w, S, x[h + 8], 7, 1770035416),
        S = s(S, b, _, w, x[h + 9], E, 2336552879),
        w = s(w, S, b, _, x[h + 10], L, 4294925233),
        _ = s(_, w, S, b, x[h + 11], M, 2304563134),
        b = s(b, _, w, S, x[h + 12], 7, 1804603682),
        S = s(S, b, _, w, x[h + 13], E, 4254626195),
        w = s(w, S, b, _, x[h + 14], L, 2792965006),
        b = u(b, _ = s(_, w, S, b, x[h + 15], M, 1236535329), w, S, x[h + 1], 5, 4129170786),
        S = u(S, b, _, w, x[h + 6], 9, 3225465664),
        w = u(w, S, b, _, x[h + 11], C, 643717713),
        _ = u(_, w, S, b, x[h + 0], P, 3921069994),
        b = u(b, _, w, S, x[h + 5], 5, 3593408605),
        S = u(S, b, _, w, x[h + 10], 9, 38016083),
        w = u(w, S, b, _, x[h + 15], C, 3634488961),
        _ = u(_, w, S, b, x[h + 4], P, 3889429448),
        b = u(b, _, w, S, x[h + 9], 5, 568446438),
        S = u(S, b, _, w, x[h + 14], 9, 3275163606),
        w = u(w, S, b, _, x[h + 3], C, 4107603335),
        _ = u(_, w, S, b, x[h + 8], P, 1163531501),
        b = u(b, _, w, S, x[h + 13], 5, 2850285829),
        S = u(S, b, _, w, x[h + 2], 9, 4243563512),
        w = u(w, S, b, _, x[h + 7], C, 1735328473),
        b = c(b, _ = u(_, w, S, b, x[h + 12], P, 2368359562), w, S, x[h + 5], 4, 4294588738),
        S = c(S, b, _, w, x[h + 8], A, 2272392833),
        w = c(w, S, b, _, x[h + 11], D, 1839030562),
        _ = c(_, w, S, b, x[h + 14], I, 4259657740),
        b = c(b, _, w, S, x[h + 1], 4, 2763975236),
        S = c(S, b, _, w, x[h + 4], A, 1272893353),
        w = c(w, S, b, _, x[h + 7], D, 4139469664),
        _ = c(_, w, S, b, x[h + 10], I, 3200236656),
        b = c(b, _, w, S, x[h + 13], 4, 681279174),
        S = c(S, b, _, w, x[h + 0], A, 3936430074),
        w = c(w, S, b, _, x[h + 3], D, 3572445317),
        _ = c(_, w, S, b, x[h + 6], I, 76029189),
        b = c(b, _, w, S, x[h + 9], 4, 3654602809),
        S = c(S, b, _, w, x[h + 12], A, 3873151461),
        w = c(w, S, b, _, x[h + 15], D, 530742520),
        b = l(b, _ = c(_, w, S, b, x[h + 2], I, 3299628645), w, S, x[h + 0], 6, 4096336452),
        S = l(S, b, _, w, x[h + 7], R, 1126891415),
        w = l(w, S, b, _, x[h + 14], Y, 2878612391),
        _ = l(_, w, S, b, x[h + 5], F, 4237533241),
        b = l(b, _, w, S, x[h + 12], 6, 1700485571),
        S = l(S, b, _, w, x[h + 3], R, 2399980690),
        w = l(w, S, b, _, x[h + 10], Y, 4293915773),
        _ = l(_, w, S, b, x[h + 1], F, 2240044497),
        b = l(b, _, w, S, x[h + 8], 6, 1873313359),
        S = l(S, b, _, w, x[h + 15], R, 4264355552),
        w = l(w, S, b, _, x[h + 6], Y, 2734768916),
        _ = l(_, w, S, b, x[h + 13], F, 1309151649),
        b = l(b, _, w, S, x[h + 4], 6, 4149444226),
        S = l(S, b, _, w, x[h + 11], R, 3174756917),
        w = l(w, S, b, _, x[h + 2], Y, 718787259),
        _ = l(_, w, S, b, x[h + 9], F, 3951481745),
        b = n(b, m),
        _ = n(_, y),
        w = n(w, v),
        S = n(S, g);
    return (d(b) + d(_) + d(w) + d(S)).toLowerCase()
}

function get_sign(u,data){
    token = '22690abcbe2eaa9ec5239f4b454f9076'
    var s = '12574478'
    var sign = c(token + "&" + u + "&" + s + "&" + data)

    return {
        'sign':sign,
        't':u
    }
}

// data = '{"appId":"43356","params":"{\\"device\\":\\"HMA-AL00\\",\\"isBeta\\":\\"false\\",\\"grayHair\\":\\"false\\",\\"from\\":\\"nt_history\\",\\"brand\\":\\"HUAWEI\\",\\"info\\":\\"wifi\\",\\"index\\":\\"4\\",\\"rainbow\\":\\"\\",\\"schemaType\\":\\"auction\\",\\"elderHome\\":\\"false\\",\\"isEnterSrpSearch\\":\\"true\\",\\"newSearch\\":\\"false\\",\\"network\\":\\"wifi\\",\\"subtype\\":\\"\\",\\"hasPreposeFilter\\":\\"false\\",\\"prepositionVersion\\":\\"v2\\",\\"client_os\\":\\"Android\\",\\"gpsEnabled\\":\\"false\\",\\"searchDoorFrom\\":\\"srp\\",\\"debug_rerankNewOpenCard\\":\\"false\\",\\"homePageVersion\\":\\"v7\\",\\"searchElderHomeOpen\\":\\"false\\",\\"search_action\\":\\"initiative\\",\\"sugg\\":\\"_4_1\\",\\"sversion\\":\\"13.6\\",\\"style\\":\\"list\\",\\"ttid\\":\\"600000@taobao_pc_10.7.0\\",\\"needTabs\\":\\"true\\",\\"areaCode\\":\\"CN\\",\\"vm\\":\\"nw\\",\\"countryNum\\":\\"156\\",\\"m\\":\\"pc_sem\\",\\"page\\":4,\\"n\\":48,\\"q\\":\\"%E6%AF%9B%E7%BB%92%E7%8E%A9%E5%85%B7\\",\\"qSource\\":\\"manual\\",\\"pageSource\\":\\"tbpc.pc_sem_alimama/a.search_manual.0\\",\\"tab\\":\\"all\\",\\"pageSize\\":\\"48\\",\\"totalPage\\":\\"100\\",\\"totalResults\\":\\"5000\\",\\"sourceS\\":\\"192\\",\\"sort\\":\\"_coefp\\",\\"filterTag\\":\\"\\",\\"service\\":\\"\\",\\"prop\\":\\"\\",\\"loc\\":\\"\\",\\"start_price\\":null,\\"end_price\\":null,\\"startPrice\\":null,\\"endPrice\\":null,\\"p4pIds\\":\\"769207094813,990059841604,820190715445,990176455770,934002053062,745027688607,649956736833,846959601955,908724985062,986535371728,988408666413,991198243203,667966471595,936489247243,714066346129,850853197509,948536756530,825918780142,983498706859,651028056388,626526514409,870780461926,926899469065,837664621080,969192444306,901843494772,858062874999,966787906242,799327022265,898943073090,770876296882,957731837519,637995060336,669143546206,982180456978,891643639658,639213446688,859345916781,938052824928,709052928524,750274353792,922302965922,859138565119,746231728461,676662340942,672700321848,979287138460,898355948671\\",\\"categoryp\\":\\"\\",\\"myCNA\\":\\"aTahIPqeOHMCAXjPqiowBZ/9\\",\\"clk1\\":\\"4aedd185dde2dc9abdb80b8f0938a611\\",\\"refpid\\":\\"mm_26632258_3504122_32538762\\"}"}'

// console.log(get_sign(data))