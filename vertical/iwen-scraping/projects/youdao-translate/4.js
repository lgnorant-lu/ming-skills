var crypto = require('crypto')

function _(e) {
    return crypto.createHash("md5").update(e.toString()).digest("hex")
}

function S(e, t) {
    return _(`client=fanyideskweb&mysticTime=${e}&product=webfanyi&key=${t}`)
}

function k(danci) {
    const t = 'Vy4EQ1uwPkUoqvcP1nIu6WiAjxFeA3Y3'
    const a = (new Date).getTime();
    return {
        "sign": S(a, t),
        "client": "fanyideskweb",
        "product": "webfanyi",
        "appVersion": "1.0.0",
        "vendor": "web",
        "pointParam": "client,mysticTime,product",
        "mysticTime": a,
        "keyfrom": "fanyi.web",
        "mid": 1,
        "screen": 1,
        "model": 1,
        "network": "wifi",
        "abtest": 0,
        "yduuid": "abcdefg",
        "i": danci,
        "from": "en",
        "to": "zh-CHS",
        "useTerm": false,
        "domain": "0",
        "dictResult": true,
        "keyid": "webfanyi"
    }
}

function T(e) {
    return crypto.createHash("md5").update(e).digest()
}

function O(e) {
    var t = 'ydsecret://query/key/B*RGygVywfNBwpmBaZg*WT7SIOUP2T0C9WHMZN39j^DAdaZhAnxvGcCY6VYFwnHl';
    var a = 'ydsecret://query/iv/C@lZe2YzHtZ2CYgaXKSVfsb7Y4QWHjITPPZ0nQp87fBeJ!Iv6v^6fvi2WN@bYpJ4';
    if (!e)
        return null;
    const o = Buffer.alloc(16, T(t))
        , n = Buffer.alloc(16, T(a))
        , r = crypto.createDecipheriv("aes-128-cbc", o, n);
    let s = r.update(e, "base64", "utf-8");
    return s += r.final("utf-8"),
        s
}


// console.log(k('Z21kD9ZK1ke6ugku2ccWu-MeDWh3z252xRTQv-wZ6jddVo3tJLe7gIXz4PyxGl73nSfLAADyElSjjvrYdCvEP4pfohVVEX1DxoI0yhm36ytQNvu-WLU94qULZQ72aml6JUQEHTKW7BHoKTaeLCbOzFijM5BJCQg9mykRYYekCmVGphhCsEK7V51HW3U5nauic8t1UpJyJQpelRRegTm4mjMVWMoA_zZig3CGx89ZV2l-N9uRpxJCE5T62_Rp2vj9JDKIsaurohGMX3ZcGlIF29VbjCSjwTKXwKTZjbvi7E-QikoUSMZYt8RWM0ITFIVacCAIajauUis7dM5JxLUW1SW6ePtGUsXwjrGxlswIy4J_fkyclig3wq7EejW-q78dLz0NdlJaDCBUbUyjSjkSoFLZSdTaVmWbQm15IOj_xhMNalH3VDAhj5TfRSMN1wPWYgdeFCqDDAYHWj5sLp8hghXsUqG3LXJeGJ431oxN7uGtNaiVkAVSh7KN8FgPu1sTFGZXErw4SBj-OZPAmmB1FrMN9P5xUqL0-nC7jHXXS2h-aNPfOM-lVWiucInINiDXRXK1fOHdcHzDRzRyT0zlHU0MvG1jYMPy2XALVHPwVoPr-IS7AgsEZmJKkDXjRxMxo60z1m_v_-5 v0eH4cZyFlwCSwP2ObPEjGyo3UocK64dUo8xs41p5qspZvQde1qrRBWLDz-CppHOGMXlD1GS0ILzlXNbT0eO3gCUemRGkrbJh-niOAFJxfcTemfoaCHEfb_kRhuLopPmIxqvLzix0y-umIkcQUL1axfQ8VcyKmsiy00-wSlTPmzUxufGg-mxEgmKq0wPzMmKT_gcxBQUt9twP4bg8T5HXWbxIJkWhf78Nenk_IUTYMU4V2K2zrPGLi6bnrZ5opywwnCF01XSRAYLY7OOHOVkfx02uiVuUUa8dhaqZsN5I59RK_lfdcjVUr8-ckGzKsbgZGTqtCdQHir7VLbD26u0-ErearaphJUCaFS5Z50Cnb-_Q8BZ_Q5nwH4p0DTqA5TqL-6 kEQq1rIOdZIR7K_47zoJ0ZvqiANg7G5Z4RfvdvawCpbRlO0AGUoF-MrgwiAFA5M3maVzM8aonebbk6xyxrVxM5YWdm3dA8Z38b-S5dCDTSmXnfDtHb5raLhRKaFHo4FpiQCZbh2_6HMcVja88nedOO-Q8Xzc9hxjlab3b7BKfT4VCbMoh_zajNcY7IJV9a88FXigkW_JLFI5ZTLXb18C7pb3x7x02r4JrcMPVArEkgjpKEwL0YxidJPUxsTETh70dGi8nb9MwIffTCXToENr1MIqPF8ZRRTWnk2Il2Bra9b7yzMhgZSKLyf0jRWtRiPghTUMbsAHNnaPMvvD1rlQy7lyy_6cr66iy0sA37vXiAZyY2vNkk8E76nslydC1lQ5OXRoNvOFwMTIoQ23yQfEfE8lrTbG6WTONGMSUWXe_uPnLxVnUM2XKCGh8y11z9exlRXC1EbwsfM55ccqbkMHMX7SufiaTmpRMdqWVx_9rvuI5HBye9BDROmLUPt6u-N-R5vdy9zUDcvUZOEKlGTRARaPaJD21DzJBNM9e195bCDdLN4AAbJPlp9qGPWo-RqJG9PSVm870J15lwL3Ya03PvGw-E8IgkBzoje78O07RrI1ORWHd6RLmLZwbitdH42hWLO4D4wbYTwC8UdT_c0KVLrBqUufpBu00znwVusJdaFf7dY7hn4w1T0rbIG9AyL1AsA__cAx4nNAQd8_MKhliNVjodznkXuClc51tu4NT3c3V50W3xqYohV8uYBAfHisfVW9OMwyAEySqQU_g74pTMtAwv-jHmzFep7j7XFA6THNExpfq8mtvonSNilp9LZNDJyQe7Xjdn5kgn-XCACELtLItAm8r0_6D4U9G2lyLnz-qgJ9k12JjWUeHF0Gt9BPmuDS0pJRtjiIRQJXdLppuoR-_9MwcSmlwkaZA7hXE_JETULThol8NGcH08T2G23WP8pPV4CBpe9bgxgGpfHPP-EYF7cSC6yIy4Y9sc-yCdL11fLoJTPwBJx3h9gRdZdUiBbztH8LC1P9WXPC3a5WxfRQkfbGMafWRAb39BIYLgFqe6kh45v_fs9SLBMSNpbrbMj6PihVMIC7B63VotSICYeSIsXW54eCit7_fmxcrIvbdKkiVzFx6hY4HoqP7nRlQNSNqmD8SBeN69qOE1UNToZINM81obFELAxK45e_acg6VPLOBqP1-HCoFdO8VRtNYsFqt4tFtoeNh443Q5JSPdJa0ZvBcoCrvBMdschOdBb4BWo-ygau__5mY4NmVFDJXKnSoo4_Yibh-13 gqyas4bSX5gwIAgMqQBody-qsMazB_TDjISl95ykC8Pn3TLUBQQh1hvycFebIsSez-uZmIuDrFdNMiEwZsBg2FYG1lelujmGPSUm7wRwZCXm2yyooGzMMOIUbdPUslLs57rm5zHer-yusI='))
// console.log(O('Z21kD9ZK1ke6ugku2ccWuwRmpItPkRr5XcmzOgAKD0GcaHTZL9kyNKkN2aYY6yiO5XjH3NKRkigLcRiYQgImS7OVzxxj4cwFPKgwlR1Pznwrh-B8t5_X_qscs_15wHjiebFpJP-EfkgkBBbvF0ckOmv9IrvCQ2yFouSUJ0ST5QyLUOB7mtpmB2AxzNXjOEcUEnYNODJ3kXeG3dCKcAFO3g=='))


// function C(e, t) {
//     n.H("https://dict.youdao.com/webtranslate", o.A(o.A)({}, e), k(t), {
//         headers: {
//             "Content-Type": "application/x-www-form-urlencoded"
//         }
//     })
// }