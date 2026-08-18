#!/bin/sh
# Exercise the stdio JSON-RPC loop of r2mcp.wasm with a real MCP session:
# initialize, list tools, open a binary and run a couple of tools on it.
set -e

WASM="${1:-r2mcp.wasm}"
WASMTIME="${WASMTIME:-wasmtime}"
BIN="${2:-/bin/ls}"

if [ ! -f "$WASM" ]; then
	echo "ERROR: $WASM not found (run make first)" >&2
	exit 1
fi

TMPDIR="${TMPDIR:-/tmp}"
OUT="$TMPDIR/r2mcp-wasi-test.$$"
trap 'rm -f "$OUT"' EXIT

run_session() {
	"$WASMTIME" run --dir=/ "$WASM" "$@"
}

echo "=== CLI flags ==="
run_session -v
run_session -t | head -5
echo "--- tool filtering (-e) lists only open_file ---"
run_session -e open_file -t
echo "--- tool exclusion (-E) ---"
run_session -E open_file -t | grep -c '^open_file ' && exit 1 || true

echo "=== JSON-RPC stdio session ==="
{
	printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n'
	printf '{"jsonrpc":"2.0","method":"notifications/initialized"}\n'
	printf '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n'
	printf '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"open_file","arguments":{"file_path":"%s"}}}\n' "$BIN"
	printf '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_entrypoints","arguments":{}}}\n'
} | run_session -n > "$OUT"

echo "--- responses ---"
cat "$OUT"
echo "--- assertions ---"
grep -q '"id":1' "$OUT" || { echo "FAIL: no initialize response"; exit 1; }
grep -q 'protocolVersion' "$OUT" || { echo "FAIL: bad initialize response"; exit 1; }
grep -q '"tools"' "$OUT" || { echo "FAIL: no tools/list response"; exit 1; }
grep -q '"id":3' "$OUT" || { echo "FAIL: no openFile response"; exit 1; }
grep -q '"id":4' "$OUT" || { echo "FAIL: no listEntrypoints response"; exit 1; }
echo "OK: stdio JSON-RPC session works"
