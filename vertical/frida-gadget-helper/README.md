# Frida Gadget Helper

>  感觉以前的gadget注入还有使用方式很不方便的感觉，加上最近为了适配trace工具还有魔改rom改了个注入工具，所以写了这个项目

一个很小的 Frida Gadget 注入辅助仓库：用 `xfinjectd` 把 Gadget 注入目标 App，然后用 `frida -H` 连接并加载 `hook.js`。

## 默认包含

```text
libgadget-rusda.so
libgadget-rusda.config.so
xfinjectd
inject_frida_gadget.py
hook.js
```

rusda 是开源项目，链接：<https://github.com/taisuii/rusda>

xfinject 是开源项目，fork 自 gozinject：

- xfinject: <https://github.com/LunFengChen/xfinject>
- gozinject: <https://github.com/Arsylk/gozinject>

## 快速使用

```bash
git clone https://github.com/LunFengChen/frida-gadget-helper.git
cd frida-gadget-helper
```

```bash
python inject_frida_gadget.py \
  -p <package> \
  -l hook.js
```

只注入 Gadget，后面手动连接：

```bash
python inject_frida_gadget.py -p <package>
frida -H 127.0.0.1:14725 -n Gadget -l hook.js
```

如果希望 `frida` 命令退出后脚本继续留在目标进程：

```bash
python inject_frida_gadget.py \
  -p <package> \
  -l hook.js \
  --eternalize
```

指定别的 Gadget so：

```bash
python inject_frida_gadget.py \
  -p <package> \
  --gadget /path/to/libgadget.so \
  -l hook.js
```

指定自定义配置：

```bash
python inject_frida_gadget.py \
  -p <package> \
  --config /path/to/libgadget.config.so \
  -l hook.js
```

`--serial` 不是必须的，多设备时再加：

```bash
python inject_frida_gadget.py \
  --serial <serial> \
  -p <package> \
  -l hook.js
```

## 配置文件规则

脚本找 Gadget config 的顺序：

```text
1. 显式 --config <path>
2. Gadget so 同目录、同 basename 的 config
   例如 libgadget-rusda.so -> libgadget-rusda.config.so
3. Gadget so 同目录的 libgadget.config.so
4. 都没有就自动生成 listen + wait 配置
```

最终推到设备时统一命名为：

```text
/data/local/tmp/libgadget.config.so
```

## 科普文档

如果想看 Gadget 的设计、配置项和注入方式说明：[`frida-gadget.md`](./frida-gadget.md)。
