# r2mcp for WASI

Builds `r2mcp.wasm`: the r2mcp stdio MCP server with a full radare2
statically linked inside, targeting WASI. The resulting single-file binary
runs under any wasm runtime (wasmtime, wasmer, wazero, ...) and speaks the
MCP JSON-RPC protocol over stdin/stdout, so it can be used directly as an
MCP server by agents without installing radare2 on the host.

## Building

```sh
make                     # build against the pinned radare2 release
make R2_VERSION=6.1.8    # build against a specific radare2 tag
make R2_VERSION=git      # build against radare2 master
```

The Makefile orchestrates everything inside `./tmp`, so a plain
`rm -rf tmp` (or `make mrproper`) leaves a pristine tree:

1. Clones the radare2 repository at the requested tag into
   `tmp/radare2-<version>`.
2. Downloads the wasi-sdk into `tmp/wasi` using radare2's own scripts.
3. Builds radare2 statically for WASI with the same configure flags as the
   upstream `sys/wasi.sh` of the version being built.
4. Compiles the r2mcp sources with the wasi-sdk and links all the static
   radare2 archives into `r2mcp.wasm`.

Tunables: `R2_VERSION`, `R2_GITURL`, `R2_SRCDIR` (point to an existing
radare2 checkout instead of cloning), `WASI_ROOT` (set it to
`~/Downloads/wasi` to share the sdk cache with radare2's `sys/wasi.sh`),
`WASMTIME`.

## Running

```sh
wasmtime run r2mcp.wasm -- -h            # help; all r2mcp CLI flags work
wasmtime run --dir=/ r2mcp.wasm          # stdio MCP server, full fs access
wasmtime run --dir=. r2mcp.wasm -- -m    # minimal toolset, cwd only
make run                                 # shortcut for the second line
make check                               # smoke test (version, tools, JSON-RPC)
```

Filesystem access is controlled by the wasm runtime: only directories
preopened with `--dir` are visible to the server, which composes nicely with
r2mcp's own `-s <dir>` sandbox flag. Tool selection flags (`-e`, `-E`, `-m`,
`-R`, `-p`, ...) behave the same as in the native build.

Notes and limitations under WASI:

* The HTTP server mode (`-H`), the HTTP client mode (`-u`) and the
  supervisor connection (`-S`) require sockets/subprocesses and are not
  functional; stdio mode is the supported transport.
* `run_*` tools (`-r`) cannot spawn processes.
* Interrupt signals are handled by the host runtime, not by r2mcp.

## Example MCP configuration

```json
{
  "mcpServers": {
    "radare2": {
      "command": "wasmtime",
      "args": ["run", "--dir=/", "/path/to/r2mcp.wasm"]
    }
  }
}
```
