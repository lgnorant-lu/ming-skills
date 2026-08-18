var crypto = require('crypto');

function S(e, t) {
    return _(`client=fanyideskweb&mysticTime=${e}&product=webfanyi&key=${t}`)
}

function _(e) {
    return crypto.createHash("md5").update(e.toString()).digest("hex")
}

function k(word) {
    const e = 'Vy4EQ1uwPkUoqvcP1nIu6WiAjxFeA3Y9';
    const a = (new Date).getTime();
    return {
        "sign": S(a, e),
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
        "i": word,
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
    const o = Buffer.alloc(16, T(t))
      , n = Buffer.alloc(16, T(a))
      , r = crypto.createDecipheriv("aes-128-cbc", o, n);
    let s = r.update(e, "base64", "utf-8");
    return s += r.final("utf-8"),
    s
}

// console.log(O('Z21kD9ZK1ke6ugku2ccWu-MeDWh3z252xRTQv-wZ6jddVo3tJLe7gIXz4PyxGl73nSfLAADyElSjjvrYdCvEP4pfohVVEX1DxoI0yhm36yswyZt_QBUqGyys3jGytX5wcDhRPNsku_c-W6JWromCl1Iu-_uaOekTO-gxau8G6sz4SuwcsyLUdWn5BI_nvWvXAtGGmFsM9We6KyKX30gg4WN7oqcFWpbfb_qatxsgXVTEcRyggIyFc63hwGQq5Qq28EKIsaXngdEBa2ZG5aD1GXcRN3drvyxBcP9hNErxvs1IMlyJYg5GmzV2aoRGB7uPXIf8cpHU7522OJgFDdRz6C1twRf7al3wc4bYmPNI0f7CArXx_ECMIv3DXqnhBX8xEDSbSA0qoPxaMkdLAQm-1 wqBwwoU-mM2nzexxxZ3kc7omS9xhGE3PGZHOJNbvYTnIfVdGvzPHQUGbpyoIHOcuvxejwa5fZu_xSfCosHpA24VpTw0CQpB5bv__ZXes9BaDmzn3kFU6UQz58Olo6LFEbP3aR86s0d_dO07Ki1KhK3qC9k-pyvmLGquPp3lUi2-BkdrHoF1GvvoCJ4T6ABO3oCY1_ySVFUwSP5e0sjJUBLVr6HoobjKpyDFMupP0TCm9BZJPR9ESn3EmMWJUo5PL_c3JFvbXgtAEbIEcs38x7M4geJBnZs2qHO39JYUREzvdcQEFUiEAF8Obc-D3t88yOvjIqHfjWFrwkwTFPVQidl7PwrRwPqXHIna2y9LBX9gsAB9bmLnpONYwBqhuus6wO_VevEVyDtuKRxW-libieW8TOdt0inZ3T_3d5eZzUP9W63ibXoZ3v4Qn6DIKMnWZbL7nM85j-7 bXeWwM04vpDoV7xXoBsCb3IMV6uiYsabdzmEfQ7e0YLVy3JU6ZFY-laQyQNPyf4diHjGv7zahZ9fPC8ervsa1l89xaKx1yU5UNAw48uEM3Oq9bmNqzPupQrQBkFz44rry_gGgdACLHzoGoIjbTXymf31eSGffoImPNZuQVJwR8oDa9cVYu1Org-i-MZ6rWqAEVg4LIWZHlwqcMKp4pk4BywaLXoMG_F4ue-Von0_R5pBhswHm7jqVTqaWM2SpevT26L_PS4P8-YjAxZjSYI4Ta7fpvRhW9SkjamuoZdp5QUwEkkGWaROZXWX8Kjx6cfMd5TYCZf5DoSUTD_KdWhFmPLVtlBECLMu8AYDrBjsSaA229zNd0hRdRKsCdmrHzT3XaqZ8Ty3ZuNmgOS6MQX3VLAsimoZp07JoE_a05F2MS-l4JcLSsRKljXdWMQ-uIsfzsrtMob3MBNOR_2-SSIdCjyT15azVHVjnY6vH_ZCYn5dQJkGIBQMy5zqFR9nA7HRSHPpdh-yq_JKoCLdRm1IaF_O_UoQHf2CRHlapuhasehWtHw5aNmiyrEcPfvUhUFU0JjTojsHoFhEnm9VNZZ4zMys4m44mA9Ml6DMf477ODDzwGk6mTfw2hav_Ik8-_IsGS4P7y9Fx_thFiQs-Su8YsLkoMm6yyyf99WWuq2TttQydvTAVQeci-ozlfCAaqRUFM9kZcaN6qQSbLwn0sRkEbpvAo7tADOn-'))