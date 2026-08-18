/**
 * sign_helper.js — 模板: 调用小程序原始模块计算签名。
 *
 * 用法: node sign_helper.js <METHOD> <PATH> '<JSON_PARAMS>'
 * 输出: JSON { sign, body, timestamp, headers }
 *
 * 适配说明:
 *   1. 修改 OUTPUT_DIR 指向反编译产物目录
 *   2. 修改 wx 小程序 ID (getAccountInfoSync)
 *   3. 修改 getApp() 返回的医院/用户参数
 *   4. 修改 MODULE_NAME 为实际的 request 模块文件名
 *   5. 按需调整 wx.login mock 的 code 来源
 */
const path = require('path'); const fs = require('fs');
const Module = require('module'); const origRequire = Module.prototype.require;

// ── 配置 ──────────────────────────────────────────────
const OUTPUT_DIR = path.resolve(__dirname, '..', 'wx_reverse_output');
const MODULE_NAME = '1A00C6860766B0CF7C66AE816D76D7E6.js'; // request 模块

// ── 全局变量 (mini-program runtime mock) ──────────────
global.window = global;
global.document = { createElement() { return {}; } };
global.navigator = { appName: 'Netscape' };
global.location = { href: 'https://servicewechat.com/' };
global.screen = { width: 375, height: 667 };
global.XMLHttpRequest = function() {};
global.WebSocket = function() {};
global.alert = ()=>{};
global.frames = undefined;
global.Caches = {}; global.history = {}; global.Reporter = function() {};
global.webkit = {}; global.WeixinJSCore = {};
global.localStorage = { getItem(){}, setItem(){} };

let _capturedRequest = null;
let _originalParams = {};

global.wx = {
    getStorageSync(k) { return ''; },
    setStorageSync(k,v) {},
    removeStorageSync(k) {},
    getAccountInfoSync() { return { miniProgram: { appId: 'wxREPLACE_ME' } }; },
    request(opts) {
        _capturedRequest = opts;
        if (opts.success) opts.success({ data: {}, header:{}, statusCode: 200 });
    },
    login(opts) {
        // 使用原始参数中的 jsCode，不要用硬编码值
        const code = _originalParams.jsCode || _originalParams.code || '';
        if (opts.success) opts.success({ code: code });
    },
    hideLoading(){}, showToast(){}, showModal(){},
};

global.getApp = function() {
    return {
        // 填入实际的医院配置
        hospitalId: 'REPLACE', synUserName: 'REPLACE', synKey: 'REPLACE',
        sipUrl: 'https://REPLACE.com/sip',
        sipServiceURL: 'https://REPLACE.com/sip',
        LOGINSTATUS: true, accessToken: '',
        signInUserInfo: { hmpi: '', isArrivalFlag: '' },
        userId: '', WxOpenId: '', characteristic: 0,
    };
};
global.getCurrentPages = function() { return []; };
global.App = function() {}; global.Page = function() {}; global.Component = function() {};

// ── Module loader ──────────────────────────────────────
Module.prototype.require = function(id) {
    try { return origRequire.apply(this, arguments); } catch(e) {
        if (id.includes('@babel')) {
            const name = path.basename(id.replace(/\\/g, '/'), '.js');
            const hp = path.resolve(OUTPUT_DIR, '@babel/runtime/helpers', name + '.js');
            if (fs.existsSync(hp)) return origRequire(hp);
        }
        if (id.endsWith('.js')) {
            const fp = path.resolve(OUTPUT_DIR, path.basename(id));
            if (fs.existsSync(fp)) return origRequire(fp);
        }
        return {};
    }
};

// 预加载 (Node.js 会缓存)
const reqMod = origRequire(path.resolve(OUTPUT_DIR, MODULE_NAME));

// ── Main ───────────────────────────────────────────────
function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log(JSON.stringify({ error: 'Usage: node sign_helper.js <method> <path> [json_params]' }));
        process.exit(1);
    }

    const method = args[0].toUpperCase();
    const urlPath = args[1];
    let params = {};
    try { if (args[2]) params = JSON.parse(args[2]); } catch(e) {}

    // 深拷贝原始参数 (请求模块会原地修改)
    _originalParams = JSON.parse(JSON.stringify(params));

    try {
        const result = reqMod.default({
            method: method.toLowerCase(), url: urlPath,
            data: params, params: {},
        });

        const finish = () => {
            if (!_capturedRequest) {
                console.log(JSON.stringify({ error: 'No request captured' }));
                process.exit(1);
            }
            const opts = _capturedRequest;
            const headers = opts.header || {};
            const dataObj = opts.data || {};
            let sign = dataObj.sign || '';
            let timestamp = headers.Requestsigntime || headers.requestsigntime || '';
            let authorization = headers.Authorization || headers.authorization || '';

            // 合并原始参数 (请求模块可能删除了 jsCode 等字段)
            const qs = require('querystring');
            const mergedData = {};
            for (const k of Object.keys(_originalParams)) mergedData[k] = _originalParams[k];
            for (const k of Object.keys(dataObj)) {
                if (dataObj[k] !== undefined) mergedData[k] = dataObj[k];
            }
            if (sign) mergedData.sign = sign;
            const bodyStr = qs.stringify(mergedData);

            console.log(JSON.stringify({
                sign, timestamp, authorization,
                body: bodyStr, signLength: sign.length,
                headers: { Sign: headers.Sign || headers.sign || sign,
                           Requestsigntime: timestamp, Authorization: authorization }
            }));
        };

        if (result && result.then) {
            result.then(finish).catch(e => { console.log(JSON.stringify({ error: e.message })); process.exit(1); });
        } else {
            finish();
        }
    } catch(e) {
        console.log(JSON.stringify({ error: e.message || String(e) }));
        process.exit(1);
    }
}

main();
