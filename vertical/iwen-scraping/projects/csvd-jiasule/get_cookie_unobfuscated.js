// 解混淆后的CSVD国家信息安全漏洞平台Cookie获取脚本

/**
 * SHA1哈希函数实现
 * @param {string} message - 要哈希的消息
 * @returns {string} SHA1哈希结果的十六进制字符串
 */
function sha1(message) {
    // 左旋转函数
    function rotateLeft(x, n) {
        return (x << n) | (x >>> (32 - n));
    }

    // 填充消息
    const byteLength = message.length;
    const bitLength = byteLength * 8;
    let paddedMessage = message + String.fromCharCode(0x80);
    
    // 填充0，直到长度满足要求
    while ((paddedMessage.length % 64) !== 56) {
        paddedMessage += String.fromCharCode(0x00);
    }
    
    // 添加原始消息长度（64位，大端序）
    for (let i = 7; i >= 0; i--) {
        paddedMessage += String.fromCharCode((bitLength >>> (i * 8)) & 0xff);
    }

    // 初始化哈希值
    let h0 = 0x67452301;
    let h1 = 0xefcdab89;
    let h2 = 0x98badcfe;
    let h3 = 0x10325476;
    let h4 = 0xc3d2e1f0;

    // 处理每个512位块
    for (let blockStart = 0; blockStart < paddedMessage.length; blockStart += 64) {
        // 提取16个32位字并扩展为80个
        const w = new Array(80);
        
        // 提取前16个字
        for (let j = 0; j < 16; j++) {
            w[j] = (
                (paddedMessage.charCodeAt(blockStart + j * 4) << 24) |
                (paddedMessage.charCodeAt(blockStart + j * 4 + 1) << 16) |
                (paddedMessage.charCodeAt(blockStart + j * 4 + 2) << 8) |
                (paddedMessage.charCodeAt(blockStart + j * 4 + 3))
            ) >>> 0;
        }

        // 扩展为80个字
        for (let j = 16; j < 80; j++) {
            w[j] = rotateLeft(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1) >>> 0;
        }

        // 初始化工作变量
        let a = h0, b = h1, c = h2, d = h3, e = h4;

        // 主循环
        for (let j = 0; j < 80; j++) {
            let f, k;
            
            // 根据轮次选择不同的函数和常量
            if (j < 20) {
                f = (b & c) | (~b & d);
                k = 0x5a827999;
            } else if (j < 40) {
                f = b ^ c ^ d;
                k = 0x6ed9eba1;
            } else if (j < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8f1bbcdc;
            } else {
                f = b ^ c ^ d;
                k = 0xca62c1d6;
            }

            // 更新变量
            const temp = (rotateLeft(a, 5) + f + e + k + w[j]) >>> 0;
            e = d;
            d = c;
            c = rotateLeft(b, 30) >>> 0;
            b = a;
            a = temp;
        }

        // 更新哈希值
        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
    }

    // 将哈希值转换为十六进制字符串
    function toHex(n) {
        let hex = '';
        for (let i = 7; i >= 0; i--) {
            hex += ((n >>> (i * 4)) & 0xf).toString(16);
        }
        return hex;
    }

    return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}

/**
 * 反爬虫检测函数
 * @returns {boolean} - 如果检测到爬虫，返回true
 */
function detectBot() {
    // 快速检测：检查是否有自动化工具的全局变量
    const automationGlobals = [
        'callPhantom', '_phantom', 'phantom', '__nightmare', 'nightmare', 
        'webdriver', '__webdriver'
    ];
    
    for (const globalName of automationGlobals) {
        if (window[globalName]) {
            return true;
        }
    }
    
    // 检测navigator.webdriver标志（Selenium等工具设置）
    if (navigator.webdriver) {
        return true;
    }
    
    // 检测Chrome浏览器的特殊特征
    if (window.chrome && window.chrome.webstore === undefined) {
        return true;
    }
    
    // 检测navigator.plugins为空（常见于无头浏览器）
    if (window.navigator.plugins && window.navigator.plugins.length === 0) {
        return true;
    }
    
    // 检测User-Agent中的爬虫特征
    const userAgent = window.navigator.userAgent.toLowerCase();
    const botSignatures = ['python', 'wget', 'curl', 'httpie', 'scrapy', 'splash', 
                          'phantom', 'slimer', 'robot', 'spider', 'crawler', 'bot'];
    
    return botSignatures.some(sig => userAgent.includes(sig));
}

/**
 * 主函数，用于生成cookie并重定向
 * @param {Object} config - 配置参数
 */
function generateCookie(config) {
    // 检查是否为爬虫环境
    if (detectBot()) {
        return;
    }

    const startTime = Date.now();
    let foundString = null;
    
    // 尝试找到正确的字符串组合
    const chars = config.chars;
    const prefix = config.bts[0];
    const suffix = config.bts[1];
    
    // 双重循环查找正确的字符组合
    for (let i = 0; i < chars.length && !foundString; i++) {
        for (let j = 0; j < chars.length; j++) {
            const testString = prefix + chars[i] + chars[j] + suffix;
            const hashResult = sha1(testString);
            
            if (hashResult === config.ct) {
                foundString = testString;
                break;
            }
        }
    }

    // 如果找到匹配的字符串，设置cookie并重定向
    if (foundString) {
        // 计算实际执行时间和需要的等待时间
        const executionTime = Date.now() - startTime;
        const targetWaitTime = config.wt ? parseInt(config.wt, 10) : 1500;
        const waitTime = Math.max(0, targetWaitTime - executionTime);

        // 设置超时，然后设置cookie并重定向
        setTimeout(() => {
            // 构建cookie字符串
            let cookieStr = `${config.tn}=${foundString};Max-Age=${config.vt};path=/`;
            if (config.is) {
                cookieStr += ';secure';
            }
            
            // 设置cookie并刷新页面
            document.cookie = cookieStr;
            location.href = location.pathname + location.search;
        }, waitTime);
    } else {
        // 如果未找到匹配项，显示错误
        alert('验证失败');
    }
}

// 执行主函数，配置参数
window.onload = function() {
    generateCookie({
        "bts": ["1763825417.931|0|hoF", "192egLzSGH9fMOPQnpC8Vk%3D"],
        "chars": "KgpsgYeNOTktdkQAbMVWmJ",
        "ct": "1656a5d5358cd0d97db26396347b267e727888c5",
        "ha": "sha1",
        "is": true,
        "tn": "__jsl_clearance_s",
        "vt": "3600",
        "wt": "1500"
    });
};