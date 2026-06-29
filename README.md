# Hammer 3.8 — One-paste installer

Open **Windows PowerShell** (a UAC admin prompt will appear automatically) and paste:

```powershell
irm https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/installer/install.ps1 | iex
```

## What it does

1. Requests Administrator rights (UAC).
2. Downloads the Hammer 3.8 payload (`Hammer-3.8.zip.001`, `Hammer-3.8.zip.002`) and reassembles it.
3. Installs the files to `C:\Program Files (x86)\Hammer`.
4. Creates a Desktop shortcut **"Hammer 3.8"** using `hammer.ico`.
5. Registers an entry in **Control Panel > Programs and Features** that uninstalls via `Uninstall.exe`.

> Note: This is a Windows installer, so it uses PowerShell (`irm … | iex`) instead of `curl … | bash`.
