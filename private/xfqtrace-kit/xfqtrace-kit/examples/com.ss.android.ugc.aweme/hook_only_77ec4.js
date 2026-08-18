// app_version: 34.6.0
function hook_dlopen() {
    var targetSoName = "libmetasec_ml.so";
    Interceptor.attach(Module.findExportByName(null, "android_dlopen_ext"), {
        onEnter: function (args) {
            this.fileName = args[0].readCString();
            if (!targetSoName || this.fileName.indexOf(targetSoName) >= 0) {
                console.log(`[+] dlopen onEnter ==> ${this.fileName}`);
                this.isMatch = true;
            }
        },
        onLeave: function () {
            if (this.isMatch) {
                var base = Module.findBaseAddress(targetSoName);
                console.log(`[+] ${targetSoName} base ==> ${base}`);

                Interceptor.attach(base.add(0x77ec4), {
                    onEnter: function () {
                        console.log(`[+] hook onEnter ==> ${targetSoName} + 0x77ec4`);
                    },
                    onLeave: function () {
                        console.log(`[-] hook onLeave <== ${targetSoName} + 0x77ec4`);
                    }
                });

                Interceptor.attach(base.add(0x134934), {
                    onEnter() {
                        var calcX8 = this.context.x0.sub(0xe9);
                        console.log(`[134934] raw_x0=${this.context.x0} calc_x8=${calcX8} x1=${this.context.x1} x2=${this.context.x2} x3=${this.context.x3}`);
                    }
                });
            }
        }
    });
}

hook_dlopen();
