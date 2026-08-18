require("./env")
require("./source")


function get_a_bogus(p) {
    arguments = [
    0,
    1,
    14,
    p,
    "",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
]
    var r = window.yuan._v;
    return (0,
        window.yuan._u)(r[0], arguments, r[1], r[2], this)
}

// 测试
// p = "device_platform=webapp&aid=6383&channel=channel_pc_web&publish_video_strategy_type=2&source=channel_pc_web&personal_center_strategy=1&update_version_code=170400&pc_client_type=1&version_code=170400&version_name=17.4.0&cookie_enabled=true&screen_width=1496&screen_height=967&browser_language=zh-CN&browser_platform=MacIntel&browser_name=Chrome&browser_version=124.0.0.0&browser_online=true&engine_name=Blink&engine_version=124.0.0.0&os_name=Mac+OS&os_version=10.15.7&cpu_core_num=10&device_memory=8&platform=PC&downlink=10&effective_type=4g&round_trip_time=50&webid=7371422219199055371&msToken=xbT-knmOtL2HBfyCo9vvm_089fnqF5qFy397oePwqjnHuCshrGSlzwqXii1Nkd0URTZ8EewvmOwuEaCrlD0UYkayFqvlsoA-o-DuxnkLM1NuW6JqxUK2tAWXbKKFgAk%3D&msToken=xbT-knmOtL2HBfyCo9vvm_089fnqF5qFy397oePwqjnHuCshrGSlzwqXii1Nkd0URTZ8EewvmOwuEaCrlD0UYkayFqvlsoA-o-DuxnkLM1NuW6JqxUK2tAWXbKKFgAk%3D"
//
// console.log(get_a_bogus(p))