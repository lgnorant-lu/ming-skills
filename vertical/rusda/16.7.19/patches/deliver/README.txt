patches/deliver/ — 16.7.19 交付补丁（相对官方 Frida tag 16.7.19）

16.7.x 与 17.6.2 同属「新构建系统」(configure/make + compat/build.py + embed-agent.py +
post-process.py)，故补丁基本沿用 17.6.2 线，仅个别文件因版本漂移做了适配：
  - memfd 改名(jit-cache)：17.6.2 在 lib/base/linux.vala；16.7.19 在
    src/linux/frida-helper-backend.vala 的 memfd_create 包装里。
  - gum/gum.c 的 g_set_prgname 行号不同（直接替换字符串）。
  - 16.7.19 的 linux-host-session.vala 已无 app_process --nice-name=re.frida.helper
    启动块（17.6.2 有），该改动在 16.7.19 不适用。
  - re.frida.Helper 等 D-Bus 接口名按协议兼容保留。

应用顺序
--------
  1) git clone --recurse-submodules -b 16.7.19 https://github.com/frida/frida frida16.7.19
  2) cd frida16.7.19 && git submodule update --init --recursive
  3) git apply --exclude=releng patches/deliver/superrepo.patch
  4) cd subprojects/frida-core && git apply ../../patches/deliver/frida-core.patch && cd ../..
  5) cd subprojects/frida-gum  && git apply ../../patches/deliver/frida-gum.patch  && cd ../..
  6) 编译（NDK r25、node22、lief）：
       export ANDROID_NDK_ROOT=<NDK r25 路径>
       ./tools/build-android-all.sh
     post-process 会对 server/inject/gadget/agent 自动跑 topatch；
     用 python tools/verify-patch.py dist-android 自检。
