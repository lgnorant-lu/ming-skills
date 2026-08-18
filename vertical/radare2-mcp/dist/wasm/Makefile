# Build r2mcp.wasm: the r2mcp stdio MCP server with radare2 statically
# linked inside, targeting WASI (runs under wasmtime, wasmer, wazero, ...).
#
# Usage:
#   make                     build r2mcp.wasm against the pinned radare2 release
#   make R2_VERSION=6.1.8    build against a specific radare2 tag (or branch)
#   make R2_VERSION=git      build against radare2 master
#   make run                 run the stdio JSON-RPC server under wasmtime
#   make clean               remove the r2mcp objects and binary
#   make mrproper            also remove the radare2 checkouts and build trees
#
# Tunables (environment or make arguments):
#   R2_VERSION   radare2 tag/branch to clone and build (default: 6.1.8)
#   R2_GITURL    git url of the radare2 repository
#   R2_SRCDIR    use an existing radare2 checkout instead of cloning
#   WASI_ROOT    where the wasi-sdk is cached (default: ./tmp/wasi; point it
#                to ~/Downloads/wasi to share radare2's own sys/wasi.sh cache)
#   WASMTIME     wasm runtime used by the run/check targets
#
# Everything is downloaded and built inside ./tmp, so `rm -rf tmp` (or
# `make mrproper`) leaves a pristine tree.

R2_VERSION?=6.1.8
R2_GITURL?=https://github.com/radareorg/radare2.git
WASMTIME?=wasmtime

ROOT:=$(shell pwd)
TMP:=$(ROOT)/tmp
WASI_ROOT?=$(TMP)/wasi
export WASI_ROOT
R2_SRCDIR?=$(TMP)/radare2-$(R2_VERSION)
BUILDDIR:=$(TMP)/build-$(R2_VERSION)
TARGET:=$(ROOT)/r2mcp.wasm

R2MCP_SRCS:=$(wildcard $(ROOT)/../../src/*.c) $(wildcard $(ROOT)/../../src/*.h) $(wildcard $(ROOT)/../../src/*.inc.c)

all: $(TARGET)

$(R2_SRCDIR)/.r2mcp_cloned:
	mkdir -p "$(TMP)"
	rm -rf "$(R2_SRCDIR).tmp"
ifeq ($(R2_VERSION),git)
	git clone --depth 1 "$(R2_GITURL)" "$(R2_SRCDIR).tmp"
else
	git clone --depth 1 --branch "$(R2_VERSION)" "$(R2_GITURL)" "$(R2_SRCDIR).tmp"
endif
	mv "$(R2_SRCDIR).tmp" "$(R2_SRCDIR)"
	touch "$@"

clone: $(R2_SRCDIR)/.r2mcp_cloned

$(R2_SRCDIR)/.r2mcp_r2_built: $(R2_SRCDIR)/.r2mcp_cloned
	sh "$(ROOT)/build-r2.sh" "$(R2_SRCDIR)"
	touch "$@"

r2: $(R2_SRCDIR)/.r2mcp_r2_built

$(TARGET): $(R2_SRCDIR)/.r2mcp_r2_built $(R2MCP_SRCS)
	sh "$(ROOT)/build-r2mcp.sh" "$(R2_SRCDIR)" "$(BUILDDIR)" "$(TARGET)"

run: $(TARGET)
	$(WASMTIME) run --dir=/ "$(TARGET)"

# Smoke test: version, tool listing and a scripted initialize + tools/list
check: $(TARGET)
	$(WASMTIME) run "$(TARGET)" -v
	$(WASMTIME) run "$(TARGET)" -t | head -20
	printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' | $(WASMTIME) run "$(TARGET)" -n

clean:
	rm -rf "$(BUILDDIR)" "$(TARGET)"

mrproper:
	rm -rf "$(TMP)" "$(TARGET)"

.PHONY: all clone r2 run check clean mrproper
