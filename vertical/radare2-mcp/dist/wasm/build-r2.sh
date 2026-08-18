#!/bin/sh
# Configure and build radare2 statically for WASI inside the given checkout.
# The wasi-sdk is downloaded into $WASI_ROOT by radare2's own scripts if needed.
set -e

R2DIR="$1"
if [ -z "$R2DIR" ] || [ ! -d "$R2DIR" ]; then
	echo "usage: build-r2.sh <radare2-checkout>" >&2
	exit 1
fi
cd "$R2DIR"

if [ ! -f sys/wasi-env.sh ] || [ ! -f sys/wasi-common.sh ]; then
	echo "ERROR: this radare2 version lacks sys/wasi-env.sh; use a newer tag" >&2
	exit 1
fi

. ./sys/wasi-env.sh
. ./sys/wasi-common.sh

wasi_setup_sdk
wasi_setup_plugins

# Reuse the configure flags from this radare2 version's own sys/wasi.sh so
# the flags always match the checkout being built
CFGFLAGS=`grep '^\./configure' sys/wasi.sh | head -n1 | sed -e 's,^\./configure ,,' -e 's, *|| exit 1.*,,'`
if [ -z "$CFGFLAGS" ]; then
	CFGFLAGS="--with-static-themes --without-gperf --with-compiler=wasi --disable-debugger --without-fork --with-ostype=wasi --with-checks-level=0 --disable-threads --without-dylink --with-libr --without-gpl"
fi
echo "./configure $CFGFLAGS"
./configure $CFGFLAGS

if [ -z "$MAKE_JOBS" ]; then
	MAKE_JOBS=`nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4`
fi
make -s -j"$MAKE_JOBS"
echo "radare2 for WASI built in $R2DIR"
