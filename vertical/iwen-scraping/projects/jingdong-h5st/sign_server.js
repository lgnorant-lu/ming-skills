// sign_server.js - Node.js 签名服务（子进程模式）
// 通过 stdin/stdout 与 Python 通信
// 输入: page,s_val (如 "1,23")
// 输出: JSON 结果

var CryptoJS = require('crypto-js');
var console = { log: function() {} };

require('./env.js');
require('./源码.js');

// 初始化 ParamsSign
window.PSign = new window.ParamsSign({
    appId: 'f06cc',
    preRequest: false,
    onSign: function() {},
    onRequestTokenRemotely: function() {},
});

function sleep(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
}

async function waitForToken(maxMs) {
    var start = Date.now();
    while (Date.now() - start < maxMs) {
        // 检查 _defaultToken 是否已填充（XHR 返回的 token 存这里）
        var dt = window.PSign._defaultToken;
        if (dt && typeof dt === 'string' && dt.length > 10) {
            return true;
        }
        // 也检查 _fingerprint
        var fp = window.PSign._fingerprint;
        if (fp && typeof fp === 'string' && fp.length > 5 && dt && typeof dt === 'string' && dt.length > 10) {
            return true;
        }
        await sleep(300);
    }
    return false; // timeout
}

function get_c(page, s_val) {
    if (typeof s_val === 'undefined') s_val = 23;
    var data = {
        "enc": "utf-8",
        "area": "6_379_0_0",
        "page": page,
        "mode": null,
        "concise": false,
        "new_interval": true,
        "s": s_val
    };
    var ts = Date.now();
    var c = {
        appid: "search-pc-java",
        functionId: 'pc_search_searchWare',
        client: "pc",
        clientVersion: "1.0.0",
        t: ts
    };
    c.body = CryptoJS.SHA256(JSON.stringify(data)).toString();
    return { signParams: c, rawData: data };
}

var tokenReady = false;

async function ensureToken() {
    if (tokenReady) return;
    var ok = await waitForToken(10000);
    tokenReady = ok;
}

async function get_sign_result(page, s_val) {
    await ensureToken();
    var result = get_c(page, s_val);
    var ret = window.PSign.signSync(result.signParams);
    return {
        h5st: ret['h5st'],
        t: result.signParams.t,
        body: result.signParams.body,
        rawData: result.rawData
    };
}

// 通信协议：stdin 读入，stdout 输出 JSON
// 格式: page,s_val,token  或 page,s_val (token为空时用XHR获取)
var readline = require('readline');
var rl = readline.createInterface({ input: process.stdin });

// 存储注入的token
var injectedToken = null;

rl.on('line', async function(line) {
    line = line.trim();
    if (!line) return;
    if (line === 'EXIT') { process.exit(0); }

    // TOKEN:xxx 命令注入token
    if (line.startsWith('TOKEN:')) {
        injectedToken = line.substring(6).trim();
        window.PSign._defaultToken = injectedToken;
        window.PSign._fingerprint = injectedToken;  // JD sometimes uses this too
        tokenReady = true;
        process.stdout.write(JSON.stringify({status: 'token_injected', len: injectedToken.length}) + '\n');
        return;
    }

    var parts = line.split(',');
    var page = parseInt(parts[0]) || 1;
    var s_val = parts.length > 1 ? parseInt(parts[1]) : 23;

    try {
        var result = await get_sign_result(page, s_val);
        process.stdout.write(JSON.stringify(result) + '\n');
    } catch(e) {
        process.stdout.write(JSON.stringify({error: e.message || String(e)}) + '\n');
    }
});
