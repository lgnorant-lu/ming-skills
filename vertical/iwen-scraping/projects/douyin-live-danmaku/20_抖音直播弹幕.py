from DrissionPage import Chromium,ChromiumOptions
from loguru import logger


def main():

    # 配置日志输出到文件
    logger.add('抖音弹幕.txt', rotation='100 MB', encoding='utf-8')

    web = Chromium(8345)
    url = 'https://live.douyin.com/964182675490'

    tab = web.new_tab(url)

    tab.console.start()     # 开始监听控制台输出
    logger.warning(f'开始监听记录{tab.url}弹幕评论')

    tab.wait.eles_loaded('.S3vewJ9R Ij9il8sm webcast-chatroom___list')
    tab.wait(2)

    observer_code = """
    // 选择要监控的目标节点
    const targetNode = document.querySelector('.webcast-chatroom___list');      // 1.先定义要监听的DOM元素
    // 创建一个配置对象，指定要观察的变化类型                                          
    const config = { childList: true, subtree: true };                          // 2.childList：监听目标节点的子节点变化（新增/删除）    subtree ：同时监听目标节点的所有后代节点
    // 创建一个回调函数，当目标节点发生变化时执行
    const callback = (mutationsList) => {                                       // mutationsList ：里面的东西是浏览器自动给填充的变化的东西
    for (const mutation of mutationsList) {                                     // 遍历 mutationsList 数组，依次取出每个 mutation 对象
            if (mutation.type !== 'childList') continue;                        // 判断mutation类型是否字符串   如果不是跳过  如果是继续
            mutation.addedNodes.forEach(node => {                               // 遍历新增节点列表，对列表中的每一个节点执行后面的处理逻辑
                if (
                    node.nodeType === Node.ELEMENT_NODE &&                      // 检查每个新增节点类型是否为元素节点并且是div
                    node.tagName === 'DIV'
                ) {
                    const text = node.innerText?.trim();                        // 获取div内的文字  ？-> 如果innerText不存在不会报错  trim()-> 去掉空格
                    // 过滤空内容
                    if (!text) return;
                    // 过滤太短内容
                    if (text.length < 2) return;
                    // 过滤系统消息
                    if (text.includes('进入直播间')) return;
                    // 获取当前时间
                    const currentTime = new Date().toLocaleTimeString();
                    // 打印当前时间和新增 div 的 innerText
                    console.log('[DM]', currentTime + ' ' + text);
                }
            });
        }
    };
    // 创建一个 MutationObserver 实例
    const observer = new MutationObserver(callback);    // 3. 检测DOM内如果有元素变化 就执行回调函数
    // 开始观察目标节点
    observer.observe(targetNode, config);               // 4. targetNode：要监听的 DOM 元素    config：监听配置（监听什么类型的变化）
    """
    tab.run_js(observer_code)

    while True:
        msg = tab.console.wait().text
        # 只接收自己的弹幕日志
        if msg.startswith('[DM]'):
            logger.info(msg)


if __name__ == '__main__':
    main()