# ValveOFF — One-paste installer

Open **Windows PowerShell** (a UAC admin prompt will appear automatically) and paste:

```powershell
irm https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/valveoff/install.ps1 | iex
```

## What it does

1. Requests Administrator rights (UAC).
2. Downloads the ValveOFF payload (`ValveOFF.zip.001`, `ValveOFF.zip.002`) and reassembles it.
3. Installs the files to `C:\Program Files (x86)\ValveOFF`.
4. Creates a Desktop shortcut **"ValveOFF"** using `valveoff.ico`.
5. Registers an entry in **Control Panel > Programs and Features** that uninstalls via `Uninstall.exe`.

> Note: This is a Windows installer, so it uses PowerShell (`irm … | iex`) instead of `curl … | bash`.
> The payload contains only the core ValveOFF program (~189 MB); runtime game cache/backups are not included.
