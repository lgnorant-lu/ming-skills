// aaa = function (p, a, c, k, e, r) {
//   e = function (c) { return (c < a ? '' : e(parseInt(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36)) };
//   if (!''.replace(/^/, String)) {
//     while (c--) r[e(c)] = k[c] || e(c);
//     k = [function (e) { return r[e] }];
//     e = function () { return '\\w+' };
//     c = 1
//   };
//   while (c--)
//     if (k[c]) p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]);
//   return p
// }('p y(){i="J+/=";O.D=p(c){s a="",b,d,h,f,g,e=0;C(c=c.z(/[^A-G-H-9\\+\\/\\=]/g,"");e<c.k;)b=i.l(c.m(e++)),d=i.l(c.m(e++)),f=i.l(c.m(e++)),g=i.l(c.m(e++)),b=b<<2|d>>4,d=(d&15)<<4|f>>2,h=(f&3)<<6|g,a+=7.5(b),w!=f&&(a+=7.5(d)),w!=g&&(a+=7.5(h));v a=u(a)};u=p(c){C(s a="",b=0,d=17=8=0;b<c.k;)d=c.o(b),Q>d?(a+=7.5(d),b++):R<d&&S>d?(8=c.o(b+1),a+=7.5((d&F)<<6|8&r),b+=2):(8=c.o(b+1),x=c.o(b+2),a+=7.5((d&15)<<12|(8&r)<<6|x&r),b+=3);v a}}s B=I y(),T=W[\'K\'+\'L\'].M(\'\'),N=W[\'n\'+\'P\'+\'e\'],j,t,q;N=N.U(/\\d+[a-V-Z]+/g);j=N.k;X(j--){t=Y(N[j])&10;q=N[j].z(/\\d+/g,\'\');T.11(t,q.k)}T=T.13(\'\');14=16.E(B.D(T));', 62, 70, '|||||fromCharCode||String|c2||||||||||_keyStr|len|length|indexOf|charAt||charCodeAt|function|str|63|var|locate|_utf8_decode|return|64|c3|Base|replace|||for|decode|parse|31|Za|z0|new|ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789|DA|TA|split||this|onc|128|191|224||match|zA||while|parseInt||255|splice||join|_v||JSON|c1'.split('|'), 0, {})
//
// console.log(aaa)


var W = {};
function Base() {
    _keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    this.decode = function (c) {
        var a = "", b, d, h, f, g, e = 0;
        for (c = c.replace(/[^A-Za-z0-9\\+\\/\\=]/g, ""); e < c.length;) b = _keyStr.indexOf(c.charAt(e++)), d = _keyStr.indexOf(c.charAt(e++)), f = _keyStr.indexOf(c.charAt(e++)), g = _keyStr.indexOf(c.charAt(e++)), b = b << 2 | d >> 4, d = (d & 15) << 4 | f >> 2, h = (f & 3) << 6 | g, a += String.fromCharCode(b), 64 != f && (a += String.fromCharCode(d)), 64 != g && (a += String.fromCharCode(h));
        return a = _utf8_decode(a)
    };
    _utf8_decode = function (c) {
        for (var a = "", b = 0, d = c1 = c2 = 0; b < c.length;) d = c.charCodeAt(b), 128 > d ? (a += String.fromCharCode(d), b++) : 191 < d && 224 > d ? (c2 = c.charCodeAt(b + 1), a += String.fromCharCode((d & 31) << 6 | c2 & 63), b += 2) : (c2 = c.charCodeAt(b + 1), c3 = c.charCodeAt(b + 2), a += String.fromCharCode((d & 15) << 12 | (c2 & 63) << 6 | c3 & 63), b += 3);
        return a
    }
}


function get_ming_data(DATA,nonce){
    W['DATA'] = DATA;
    W['nonce'] = nonce;

    var B = new Base(), T = W['DATA'].split(''), N = W['nonce'], len, locate, str;
    N = N.match(/\d+[a-zA-Z]+/g);
    len = N.length;
    while (len--) {
        locate = parseInt(N[len]) & 255;
        str = N[len].replace(/\d+/g, '');
        T.splice(locate, str.length)
    }
    T = T.join('');
    _v = JSON.parse(B.decode(T));
    // _v = B.decode(T);
    return _v
}
