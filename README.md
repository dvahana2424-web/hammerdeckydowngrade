# Hammer 3.8 — One-paste installer

Open **Windows PowerShell** (a UAC admin prompt will appear automatically) and paste:

```powershell
irm https://cdn.jsdelivr.net/gh/dvahana2424-web/hammerdeckydowngrade@installer/install.ps1 | iex
```

Direct GitHub raw (alternate):

```powershell
irm https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/installer/install.ps1 | iex
```

Repository branch: [installer](https://github.com/dvahana2424-web/hammerdeckydowngrade/tree/installer)

> Do **not** use `tinyurl.com/installhammer38` — it only redirects to GitHub raw and can still hit GitHub's 429 rate limit. Use the commands above instead.

## What it does

1. Requests Administrator rights (UAC).
2. Downloads the Hammer 3.8 payload (`Hammer-3.8.zip.001`, `Hammer-3.8.zip.002`) and reassembles it.
3. Installs the files to `C:\Program Files (x86)\Hammer`.
4. Creates a Desktop shortcut **"Hammer 3.8"** using `hammer.ico`.
5. Registers an entry in **Control Panel > Programs and Features** that uninstalls via `Uninstall.exe`.

> Note: This is a Windows installer, so it uses PowerShell (`irm … | iex`) instead of `curl … | bash`.

## If you get HTTP 429

GitHub may temporarily rate-limit unauthenticated downloads. Wait a few minutes and run the command again. The installer retries automatically with backoff.

Manual fallback: download `Hammer-3.8.zip.001` and `Hammer-3.8.zip.002` from the [installer branch](https://github.com/dvahana2424-web/hammerdeckydowngrade/tree/installer), concatenate them into `Hammer-3.8.zip`, then extract to `C:\Program Files (x86)\Hammer`.
