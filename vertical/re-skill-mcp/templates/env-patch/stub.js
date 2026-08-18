// stub.js — minimal browser env stub for {TARGET_DOMAIN}
// Strategy: start with EMPTY navigator/document/window stubs, run runner.js,
// read the "ReferenceError: X is not defined" / "Cannot read X of undefined",
// add ONLY the field that just blew up, repeat. End state = exactly the env
// the signer actually reads, nothing more. That is your pure-algo input set.
//
// Rule 9 (SKILL.md): 环境伪装最小化 —— 只补 trace 证明真读过的 API
// Rule 34 (SKILL.md): Phase 4 Step 2 输出物就是这个文件

'use strict';

// ── window ────────────────────────────────────────────────────────────────
const window = {};
window.window = window;
window.self   = window;
window.top    = window;

// ── navigator (UA must self-consistent with platform/language) ───────────
const navigator = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
             '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  platform:  'Win32',
  language:  'zh-CN',
  languages: ['zh-CN', 'zh', 'en'],
  hardwareConcurrency: 8,
  deviceMemory: 8,
  webdriver: false,
  vendor: 'Google Inc.',
  appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  plugins: { length: 0 },
  mimeTypes: { length: 0 },
};
window.navigator = navigator;

// ── document (only what the signer touches; expand on demand) ────────────
const document = {
  cookie: '',                            // ← fill from config/cookies.json if signer reads it
  referrer: 'https://{TARGET_DOMAIN}/',
  title: '',
  URL: 'https://{TARGET_DOMAIN}/',
  domain: '{TARGET_DOMAIN}',
  readyState: 'complete',
  hidden: false,
  visibilityState: 'visible',
  createElement: function (tag) {
    return { tagName: String(tag).toUpperCase(), style: {}, setAttribute(){}, getAttribute(){return null;}, appendChild(){}, };
  },
  getElementsByTagName: function () { return []; },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  removeEventListener: function () {},
  hasFocus: function () { return true; },
};
window.document = document;

// ── location ─────────────────────────────────────────────────────────────
const location = {
  href:     'https://{TARGET_DOMAIN}/',
  origin:   'https://{TARGET_DOMAIN}',
  protocol: 'https:',
  host:     '{TARGET_DOMAIN}',
  hostname: '{TARGET_DOMAIN}',
  pathname: '/',
  search:   '',
  hash:     '',
};
window.location = location;
document.location = location;

// ── localStorage / sessionStorage ────────────────────────────────────────
function makeStorage(initial) {
  const m = Object.assign({}, initial || {});
  return {
    get length()         { return Object.keys(m).length; },
    key(i)               { return Object.keys(m)[i] || null; },
    getItem(k)           { return k in m ? m[k] : null; },
    setItem(k, v)        { m[k] = String(v); },
    removeItem(k)        { delete m[k]; },
    clear()              { for (const k of Object.keys(m)) delete m[k]; },
  };
}
window.localStorage   = makeStorage(/* fill from config/storage.json */);
window.sessionStorage = makeStorage();

// ── screen ───────────────────────────────────────────────────────────────
window.screen = {
  width: 1920, height: 1080, availWidth: 1920, availHeight: 1040,
  colorDepth: 24, pixelDepth: 24,
};

// ── timers + console ─────────────────────────────────────────────────────
window.setTimeout    = setTimeout;
window.setInterval   = setInterval;
window.clearTimeout  = clearTimeout;
window.clearInterval = clearInterval;
window.console       = console;

// ── crypto.subtle / msCrypto / getRandomValues (if signer uses WebCrypto) ─
const { webcrypto } = require('crypto');
window.crypto = webcrypto;

// ── btoa / atob ──────────────────────────────────────────────────────────
window.btoa = function (s) { return Buffer.from(s, 'binary').toString('base64'); };
window.atob = function (s) { return Buffer.from(s, 'base64').toString('binary'); };

// ── XMLHttpRequest / fetch — signer typically does NOT need network ─────
//   If the signer reads .open() / .send() of XHR (e.g. for url tag), expose
//   a recording stub here. By default we leave them undefined so a real
//   network call from inside the signer crashes loudly = bug not feature.

// ── expose for vm.runInContext ───────────────────────────────────────────
module.exports = { window, navigator, document, location };
