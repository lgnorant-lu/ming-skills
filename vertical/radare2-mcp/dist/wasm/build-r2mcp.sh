#!/bin/sh
# Compile the r2mcp sources with the wasi-sdk and link the static radare2
# libraries from the given checkout into a single r2mcp.wasm binary.
set -e

R2DIR="$1"
BUILDDIR="$2"
OUT="$3"
if [ -z "$R2DIR" ] || [ -z "$BUILDDIR" ] || [ -z "$OUT" ]; then
	echo "usage: build-r2mcp.sh <radare2-checkout> <builddir> <output.wasm>" >&2
	exit 1
fi

SCRIPTDIR=`cd "\`dirname "$0"\`" && pwd`
SRCDIR=`cd "$SCRIPTDIR/../../src" && pwd`

# Resolve WASI_SDK / WASI_SYSROOT using radare2's own scripts, downloading
# the sdk if it is not cached yet (e.g. after a rm -rf tmp/wasi)
cd "$R2DIR"
. ./sys/wasi-env.sh
. ./sys/wasi-common.sh
wasi_setup_sdk
cd "$SCRIPTDIR"

if [ ! -x "$WASI_SDK/bin/clang" ]; then
	echo "ERROR: wasi-sdk clang not found in $WASI_SDK/bin" >&2
	exit 1
fi

CC="$WASI_SDK/bin/clang --sysroot=$WASI_SYSROOT"

R2MCP_VERSION=`awk '/^VERSION[ \t]/ { print $2; exit }' "$SCRIPTDIR/../../configure.acr"`

mkdir -p "$BUILDDIR"

# Generate config.h; it is preincluded so its include guard shadows any stale
# config.h generated in src/ by a native ./configure run
sed -e "s,@R2MCP_VERSION@,$R2MCP_VERSION,g" "$SRCDIR/config.h.acr" > "$BUILDDIR/config.h"

CFLAGS="-Os -flto -MD"
CFLAGS="$CFLAGS -DR2__UNIX__=1 -DHAVE_PTHREAD=0 -DR2_NO_LONG_DOUBLE=1"
CFLAGS="$CFLAGS -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_PROCESS_CLOCKS=1"
CFLAGS="$CFLAGS -include $BUILDDIR/config.h -I$BUILDDIR"
CFLAGS="$CFLAGS -I$R2DIR/libr/include -I$R2DIR/subprojects/sdb/include"

LDFLAGS="-flto -Wl,-z,stack-size=8388608 -lm"
LDFLAGS="$LDFLAGS -lwasi-emulated-signal -lwasi-emulated-process-clocks -lwasi-emulated-mman"

SRCS="main.c r2mcp.c readbuffer.c tools.c dsltest.c prompts.c jsonrpc.c validation.c sessions.c"

OBJS=""
for s in $SRCS; do
	o="$BUILDDIR/`basename "$s" .c`.o"
	if [ ! -f "$o" ] || [ "$SRCDIR/$s" -nt "$o" ]; then
		echo "CC $s"
		$CC $CFLAGS -c -o "$o" "$SRCDIR/$s"
	fi
	OBJS="$OBJS $o"
done

# Collect the static archives from the radare2 build tree. wasm-ld (lld)
# resolves archive members iteratively, so the order does not matter.
ARCHIVES=`find "$R2DIR/libr" -name 'libr_*.a' | sort`
EXTRA=`find "$R2DIR/shlr" "$R2DIR/subprojects" -name '*.a' 2>/dev/null | sort`
if [ -z "$ARCHIVES" ]; then
	echo "ERROR: no static libr_*.a archives found in $R2DIR/libr (did the radare2 build fail?)" >&2
	exit 1
fi

echo "LD `basename "$OUT"`"
$CC $CFLAGS $OBJS $ARCHIVES $EXTRA $LDFLAGS -o "$OUT"
echo "OK: $OUT"
