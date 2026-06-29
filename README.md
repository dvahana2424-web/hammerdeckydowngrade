# Hammer Free 3.8 — One-paste installer

Open **Windows PowerShell** (a UAC admin prompt will appear automatically) and paste:

```powershell
irm https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/hammer-free/install.ps1 | iex
```

## What it does

1. Requests Administrator rights (UAC).
2. Downloads the payload (`HammerFree.zip.001`, `HammerFree.zip.002`) with live progress + ETA, then reassembles it.
3. Installs the files to `C:\Program Files (x86)\Hammer Free Version ` (the trailing space is preserved via extended-length paths).
4. Creates a Desktop shortcut **"Hammer Free 3.8"** using `hammer.ico` (the shortcut uses the 8.3 short path so it works despite the trailing space).
5. Registers an entry in **Control Panel > Programs and Features** that uninstalls via `Uninstall.exe`.

> Note: This is a Windows installer, so it uses PowerShell (`irm … | iex`) instead of `curl … | bash`.
