#!/bin/bash
# 16.2.1 (旧 make 构建) 打包脚本
# 旧 make 构建只对「内嵌 agent」跑了 topatch（embed-agent.sh），standalone 的
# server/inject/gadget 本体并未处理，导致其 .rodata/.data.rel.ro 仍残留
# FridaScriptEngine/GumScript/gum-js-loop 等特征。本脚本在打包前对每个产物再跑一遍
# topatch.py，并校验 ELF 架构，避免 #9 类错误。
#
# 前置：已 `make core-android-{arm,arm64,x86,x86_64}`，产物在 build/frida-android-<arch>/
# 用法：./tools/package-android.sh
set -e

SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOPATCH="${SRC_ROOT}/frida-core/src/topatch.py"
OUT="${SRC_ROOT}/dist-android"
VERSION="16.2.1"
WORK="${OUT}/.work"
rm -rf "$OUT"; mkdir -p "$OUT" "$WORK"

bits_for(){ case "$1" in arm|x86) echo 32;; arm64|x86_64) echo 64;; esac; }
machine_for(){ case "$1" in arm) echo "ARM";; arm64) echo "AArch64";; x86) echo "Intel 80386";; x86_64) echo "X86-64";; esac; }

assert_arch(){
    local f=$1 a=$2 m
    m="$(readelf -h "$f" 2>/dev/null | sed -n 's/.*Machine:[[:space:]]*//p')"
    case "$m" in *"$(machine_for "$a")"*) : ;; *) echo "  [ERR] $(basename "$f") arch '$m' != $a"; exit 1;; esac
}

for arch in arm arm64 x86 x86_64; do
    bdir="${SRC_ROOT}/build/frida-android-${arch}"
    bits="$(bits_for "$arch")"
    declare -A src=(
        [server]="$bdir/bin/frida-server"
        [inject]="$bdir/bin/frida-inject"
        [gadget]="$bdir/lib/frida/${bits}/frida-gadget.so"
    )
    for kind in server inject gadget; do
        s="${src[$kind]}"
        [ -f "$s" ] || { echo "  [warn] $arch/$kind 缺失: $s"; continue; }
        w="$WORK/${kind}.${arch}"
        cp "$s" "$w"
        python3 "$TOPATCH" "$w" >/dev/null
        readelf -d "$w" >/dev/null 2>&1 || { echo "  [ERR] $arch/$kind topatch 后 ELF 损坏"; exit 1; }
        assert_arch "$w" "$arch"
        ext=$([ "$kind" = gadget ] && echo ".so.xz" || echo ".xz")
        xz -c -T0 "$w" > "${OUT}/rusda-${kind}-${VERSION}-android-${arch}${ext}"
        echo "  rusda-${kind}-${VERSION}-android-${arch}${ext}"
    done
done

rm -rf "$WORK"
echo "=== 完成，产物在 $OUT；可用 ../17.6.2/tools/verify-patch.py 自检 ==="
ls -lh "$OUT"/*.xz | awk '{printf "%s  %s\n",$5,$9}'
