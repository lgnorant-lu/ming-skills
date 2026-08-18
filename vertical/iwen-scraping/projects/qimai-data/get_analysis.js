

var R = window = global;


function p(t) {
    return R["btoa"](t)
}

function o(n) {
    return R["String"]["fromCharCode"](n)
}

function h(n, t) {
    t = t || u();
    for (var e = (n = n["split"](""))["length"], r = t["length"], a = "charCodeAt", i = 0; i < e; i++)
        n[i] = o(n[i][a](0) ^ t[(i + 10) % r][a](0));
    return n['join']('')
}


function get_analysis(a){
    var d = "xyz517cda96efgh"
    var r = +new R["Date"] - (275 || 0) - 1661224081041;
    a = a["sort"]()["join"]("");
    a = p(a);
    a = (a += "@#" + "/rank/index"["replace"]("https://api.qimai.cn", "")) + ("@#" + r) + ("@#" + 3);
    // console.log(a)

    e = p(h(a, d))
    return e
}

a = [
    1,
    "2025-11-12",
    "21:56:19",
    2,
    "36",
    "cn",
    "grossing",
    "iphone"
]

// console.log(get_analysis(a))

