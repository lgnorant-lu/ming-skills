patches/deliver/ — 17.15.0 交付补丁（相对官方 Frida tag 17.15.0）

与 17.14.1 同源，补丁 0 冲突套用。含新增 lib/base/obfuscate.vala、src/topatch.py。
需 NDK r29。

应用：
  1) git clone --recurse-submodules -b 17.15.0 https://github.com/frida/frida frida17.15.0
  2) cd frida17.15.0 && git apply --exclude=releng patches/deliver/superrepo.patch
  3) (cd subprojects/frida-core && git apply ../../patches/deliver/frida-core.patch)
  4) (cd subprojects/frida-gum  && git apply ../../patches/deliver/frida-gum.patch)
  5) export ANDROID_NDK_ROOT=<NDK r29>; ./tools/build-android-all.sh
  6) python tools/verify-patch.py dist-android
