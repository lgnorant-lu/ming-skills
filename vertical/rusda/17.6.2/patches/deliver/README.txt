patches/deliver/ — 交付用补丁（相对官方 Frida 提交 1ce4396d6e43d93c8604c4cd4578ff84871bcfa1）

文件
----
  superrepo.patch     顶层：.gitignore、releng 指针、tools/build-android-all.sh（串行四架构）
  frida-core.patch    子模块 frida-core：8c62357… → d0e66ae…（与父仓库开发线一致）
  frida-gum.patch     子模块 frida-gum：在官方 5f047e54… 上的本地改动

应用顺序（给对方）
----------------
  1) 克隆与你相同版本的 Frida，检出：
       git checkout 1ce4396d6e43d93c8604c4cd4578ff84871bcfa1
  2) git submodule update --init --recursive
  3) git apply superrepo.patch
  4) releng：若无法从网络解析到补丁中的 commit，需从你提供的 releng 副本拉取：
       cd releng && git fetch <你的 releng 仓库/镜像 URL> <补丁中的 commit> && git checkout <该 commit> && cd ..
  5) 再次子模块（按需）：
       git submodule update --init --recursive
  6) cd subprojects/frida-core
     git apply ../../patches/deliver/frida-core.patch
     cd ../frida-gum
     git apply ../../patches/deliver/frida-gum.patch
     cd ../..
  7) Android 编译：
       export ANDROID_NDK_ROOT=<本机 NDK r25 路径>
       pip install lief    # post-process 会调用 topatch.py，需 Python 能 import lief
       ./tools/build-android-all.sh

build-android-all.sh 说明
-------------------------
  已改为「串行」编译 x86 / x86_64 / arm / arm64，避免多个 configure 同时写 deps 导致 SDK 不完整。
  产物在 dist-android/，为 rusda-* 单文件 .xz。

test-compile 自检
-----------------
  与 frida17.6.2 同级的 test-compile/：见其中 README.txt 与 build-verify.log。
