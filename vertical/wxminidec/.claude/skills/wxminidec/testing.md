# Step 6b: Write requirements.txt and test mitmproxy script loading

After writing `sign_core.py` and the mitmproxy adapter, do the following in
order:

## 6b-1. Write `requirements.txt` and install dependencies

Create `./output/requirements.txt`:

```
mitmproxy>=10
pycryptodome
```

Then immediately install dependencies into the current Windows Python environment
(no virtual environment) using the Tsinghua mirror:

```powershell
python -m pip install -r ./output/requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

Always pass `-i https://pypi.tuna.tsinghua.edu.cn/simple` for faster downloads in
China. Do not create a virtual environment for this skill. The pip-installed
mitmproxy and pycryptodome are used by the current `python`/`mitmdump` toolchain.

## 6b-2. Test that sign_core.py imports cleanly

```powershell
python -c "import sys; sys.path.insert(0,'output'); from sign_core import get_config; print('OK')"
```

This must succeed without importing Crypto. If it fails, the lazy-import
pattern in `sign_core.py` is broken.

## 6b-3. Run verify_sign.py to check automatic offline comparison

```powershell
python ./output/verify_sign.py
```

A return code of `0` means all applicable checks passed or the metadata
explicitly marked signing as N/A. Return code `2` means `PENDING`: the script
needs the minimum missing baseline fields listed in its output. Any other
nonzero return code means a verification failure.

## 6b-4. Test mitmproxy script loading (upstream)

Start mitmdump, verify the process remains alive and the port is listening,
then stop only the process started by this test:

```powershell
$p = $null
try {
    $p = Start-Process -FilePath "mitmdump" -ArgumentList "-s", "./output/mitm_upstream.py", "-p", "8083" -NoNewWindow -PassThru
    Start-Sleep 3
    if ($p.HasExited) { throw "mitm_upstream exited with code $($p.ExitCode)" }
    if (-not (Get-NetTCPConnection -LocalPort 8083 -State Listen -ErrorAction SilentlyContinue)) { throw "port 8083 is not listening" }
    Write-Host "mitm_upstream started OK (PID $($p.Id))"
} finally {
    if ($null -ne $p) {
        & taskkill /PID $p.Id /T /F 2>$null | Out-Null
    }
}
```

## 6b-5. Test mitmproxy script loading (downstream)

Use all three required downstream flags and stop only the process started by
the test:

```powershell
$p = $null
try {
    $args = @("-s", "./output/mitm_downstream.py", "-p", "8082", "--mode", "upstream:http://127.0.0.1:8080", "--set", "upstream_cert=false", "--ssl-insecure")
    $p = Start-Process -FilePath "mitmdump" -ArgumentList $args -NoNewWindow -PassThru
    Start-Sleep 3
    if ($p.HasExited) { throw "mitm_downstream exited with code $($p.ExitCode)" }
    if (-not (Get-NetTCPConnection -LocalPort 8082 -State Listen -ErrorAction SilentlyContinue)) { throw "port 8082 is not listening" }
    Write-Host "mitm_downstream started OK (PID $($p.Id))"
} finally {
    if ($null -ne $p) {
        & taskkill /PID $p.Id /T /F 2>$null | Out-Null
    }
}
```

## 6b-6. Check and repair the Windows mitmproxy CA

The client and Burp must trust the mitmproxy CA before HTTPS hooks can be
observed. Run the dependency checker first. If it reports that the standard
CA is not trusted, install it with the requested Windows command and rerun the
checker:

PowerShell:

```powershell
certutil -addstore root "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.cer"
python .claude/skills/wxminidec/check_env.py
```

如果从 `cmd.exe` 执行，等价写法是：

```cmd
certutil -addstore root "%USERPROFILE%\.mitmproxy\mitmproxy-ca-cert.cer"
```

The checker does not inspect or install .NET Framework. It checks the standard
mitmproxy certificate path and both the Windows Current User and Local Machine
Root stores.

## 6b-7. Standalone vs pip-installed mitmproxy

The standalone binary includes its own Python interpreter and may not expose
pycryptodome to adapter code. The preferred Windows setup is the pip-installed
mitmproxy in the current Python environment:

```powershell
python -m pip install mitmproxy pycryptodome -i https://pypi.tuna.tsinghua.edu.cn/simple
(Get-Command mitmdump).Source
```

If the standalone binary must be used, signature-only operation may still work
because it uses the standard library, while AES requires a mitmproxy runtime
that can import pycryptodome.

## 6b-8. Clean up

The test commands terminate only the process tree rooted at the PID returned
for that test. Do not run a blanket `Stop-Process -Name mitmdump` because it
can terminate a user's existing proxy. If a port remains occupied, inspect it:

```powershell
Get-NetTCPConnection -LocalPort 8082,8083 -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalAddress,LocalPort,OwningProcess
```
