// app_version: 3.71.31
// Shopee Vietnam (com.shopee.vn) direct invoke verifier
// Purpose:
// 1. Do not load xfqtrace engine
// 2. Call the Java/JNI entry directly from Frida
// 3. Print the real return value for comparison with trace mode

const CONFIG = {
    package: "com.shopee.vn",
    trigger: {
        delay_ms: 1000,
        class_name: "com.shopee.shpssdk.wvvvuwwu",
        method_name: "vuwuuwvw",
        arg_types: ["[B", "[B"],
        url: "https://mall.shopee.vn/api/v4/native/homepage",
        payload: "{\"screen_height\":737,\"view_session_id\":\"1775302845502\",\"screen_width\":393,\"ls_req_context\":\"{\\\"scene\\\":2,\\\"previous_impr_list\\\":[]}\",\"fs_tracker_info_version\":1,\"device_model\":\"Pixel 3\",\"device_os\":\"android\",\"battery\":100,\"charging_status\":2,\"device_brand\":\"google\",\"x_ls_is_new_user\":\"false\",\"client_info\":\"device_id=RFpQ6z82s7ogkzx8ipStwCbFZ1qAqCEEanBsi5gArL8%3D;device_model=Pixel+3;os=0;os_version=31;client_version=36626;network=1;platform=1;rn_version=6.86.8;api_source=na;cpu_model=Qualcomm+Technologies%2C+Inc+SDM845;live_device_model=google+blueline\",\"pixel_ratio\":\"2.75\",\"location\":\"[]\",\"lat\":\"\",\"lon\":\"\",\"fs_need_personalize\":true,\"fs_sort_soldout\":true,\"fs_with_mega_sale_items\":false,\"ft_dp_quick_buy\":true,\"home_carousel_space_key\":\"NT-VN-HOME_CAROUSEL_01\",\"skinny_space_key\":\"NT-VN-HOME_SKINNY_01\",\"fs_with_shopee_food_items\":true,\"network_type\":\"wifi\",\"fs_need_mfs_personalize\":true,\"tms_session_id\":\"7a04a78e-2e03-4cc8-88d3-8889b8c269b4\",\"sp_need_search_suggest\":true,\"sp_trending_search_limit\":8,\"sp_trigger_scene\":\"nativebff.get_homepage\",\"sp_extra_data\":\"{\\\"supported_ui_types\\\":[\\\"text_icon_v1.0\\\"]}\"}",
    },
};

function buildByteArray(text) {
    var StringCls = Java.use("java.lang.String");
    return StringCls.$new(text).getBytes("UTF-8");
}

function dumpOverloads(targetClass, methodName) {
    var method = targetClass[methodName];
    if (!method || !method.overloads) {
        console.log("[-] method not found: " + methodName);
        return;
    }
    console.log("[*] overload count for " + methodName + ": " + method.overloads.length);
    method.overloads.forEach(function (ov, idx) {
        var args = ov.argumentTypes.map(function (t) { return t.className; }).join(", ");
        var ret = ov.returnType ? ov.returnType.className : "void";
        console.log("    [" + idx + "] (" + args + ") -> " + ret);
    });
}

function dumpResult(result) {
    if (result === null || result === undefined) {
        console.log("[+] invoke result: <null>");
        send({ type: "invoke_result", is_null: true });
        return;
    }

    var textValue = "";
    var className = "<unknown>";
    var lengthValue = null;

    try {
        className = result.$className || result.getClass().getName().toString();
    } catch (e) {}

    try {
        textValue = result.toString();
    } catch (e) {
        textValue = "<toString failed: " + e + ">";
    }

    try {
        if (className === "java.lang.String") {
            lengthValue = result.length();
        }
    } catch (e) {}

    console.log("[+] invoke result class: " + className);
    if (lengthValue !== null) {
        console.log("[+] invoke result length: " + lengthValue);
    }
    console.log("[+] invoke result text: " + textValue);
    send({
        type: "invoke_result",
        is_null: false,
        class_name: className,
        length: lengthValue,
        text: textValue,
    });
}

function invokeOnce() {
    Java.perform(function () {
        try {
            var Target = Java.use(CONFIG.trigger.class_name);
            dumpOverloads(Target, CONFIG.trigger.method_name);

            var overload = Target[CONFIG.trigger.method_name]
                .overload.apply(Target[CONFIG.trigger.method_name], CONFIG.trigger.arg_types);

            var urlBytes = buildByteArray(CONFIG.trigger.url);
            var payloadBytes = buildByteArray(CONFIG.trigger.payload);

            console.log("[*] invoking " + CONFIG.trigger.class_name + "." + CONFIG.trigger.method_name + "([B,[B)");
            console.log("[*] url bytes length: " + urlBytes.length);
            console.log("[*] payload bytes length: " + payloadBytes.length);

            var result = overload.call(Target, urlBytes, payloadBytes);
            dumpResult(result);
        } catch (e) {
            console.log("[-] invoke failed: " + e);
            try {
                var Log = Java.use("android.util.Log");
                var Throwable = Java.use("java.lang.Throwable");
                console.log(Log.getStackTraceString(Throwable.$new()));
            } catch (ignored) {}
            send({ type: "invoke_error", error: String(e) });
        }
    });
}

setTimeout(invokeOnce, CONFIG.trigger.delay_ms);
console.log("[*] direct invoke verifier loaded for " + CONFIG.package);

rpc.exports = {
    run: function () {
        invokeOnce();
    }
};
