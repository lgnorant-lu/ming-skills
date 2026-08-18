# Step 1: Decompile the Mini Program

Run this step only when the user asks for package decryption/decompilation or
has not already supplied decompiled output.

If the user has not provided a directory containing `.wxapkg` files, ask for
its path.

## 1a. Check if the package is encrypted

Read the first 6 bytes of the `.wxapkg` file:

```powershell
[System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes("path\to\file.wxapkg")[0..5])
```

If the header is `V1MMWX`, the package is encrypted and must be decrypted
before wedecode can process it. If the header is anything else, skip to step
1c.

## 1b. Decrypt with UnpackMiniApp.exe

The skill bundles a CLI decryption tool at `.claude/skills/wxminidec/UnpackMiniApp.exe`.
Copy it along with its `.config` file to a working directory if needed.

```powershell
& ".claude\\skills\\wxminidec\\UnpackMiniApp.exe" <input.wxapkg> [output.wxapkg]
```

- `<input.wxapkg>` — path to the encrypted `.wxapkg` file (required)
- `[output.wxapkg]` — output path (optional, defaults to `wxpack\{wxid}.wxapkg`
  next to the exe, where `{wxid}` is extracted from the path)

The tool extracts the Mini Program ID (`wx*`) from the input file's parent
directory path, derives the decryption key via PBKDF2, then AES-decrypts the
first 1024 bytes after the header and XOR-decrypts the remainder.

If package decryption fails, check the wxapkg path contains the correct wxid
directory (for example `wx43************a8`) and that the output directory is
writable. This skill does not perform a separate .NET Framework check; on the
target Windows environment the bundled executable is expected to run when the
normal Windows runtime is available.

## 1c. Install wedecode if needed

仅对本次 npm 调用指定镜像，不修改用户的全局 npm registry：

```powershell
npm install -g wedecode --registry https://registry.npmmirror.com
```

如果已经可以通过 `npx` 使用，先确认命令可执行，再使用：

```powershell
npx --yes --registry https://registry.npmmirror.com wedecode --help
```

## 1d. Run wedecode

**先把解密后的 wxapkg 输出到独立目录**（不要和 wedecode 的 `--out` 目录
放在一起）。`wedecode --clear` 会先删除整个输出目录再反编译，如果解密文件也
在里面就会被一起删掉。

```powershell
# 1. 解密输出到独立目录
& ".claude\\skills\\wxminidec\\UnpackMiniApp.exe" target/<wxid>/.../__APP__.wxapkg decrypted_pkgs/<wxid>__APP__.wxapkg

# 2. 反编译
wedecode decrypted_pkgs/<wxid>__APP__.wxapkg --out ./wx_reverse_output/<wxid>
```

如果 wedecode 提示"输出目录中存在上次旧的编译产物"交互式提问，加 `--clear`
跳过：

```powershell
wedecode decrypted_pkgs/<wxid>__APP__.wxapkg --out ./wx_reverse_output/<wxid> --clear
```

The input to wedecode must be a **decrypted** `.wxapkg` file or a directory
containing decrypted `.wxapkg` files. Do not point wedecode at the encrypted
originals.

This is the package decompilation step. Keep its output as the project root
for the subsequent analysis, typically `./wx_reverse_output`. Do not assume
that every package has the same JavaScript filenames; use the files produced
by wedecode as the source of truth.
